// review-journey.mjs — 产品巡检：以真实登录用户身份走主流程，只记录事实，不中断。
// 用法: E2E_SHOT_DIR=/www/hermes-home/cache/scratch/review-shots \
//       env -u NODE_CHANNEL_FD -u NODE_CHANNEL_SERIALIZATION_MODE node scripts/e2e/review-journey.mjs
import fs from "node:fs";
import path from "node:path";
import {
  BASE, SHOT_DIR, register, authedPage, launch, newPage, apiOk, api, uniq,
} from "./lib.mjs";

const obs = { base: BASE, started: new Date().toISOString(), steps: [], console: [], pageerrors: [], http: [] };
const notes = [];
const log = (k, v) => { obs.steps.push({ step: k, ...v }); notes.push(`[${k}] ${JSON.stringify(v)}`); };

let shotSeq = 0;
async function shot(page, name) {
  const p = path.join(SHOT_DIR, `${String(++shotSeq).padStart(2, "0")}-${name}.png`);
  try { await page.screenshot({ path: p, fullPage: true }); return p; } catch { return null; }
}
function wire(page, tag) {
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning")
      obs.console.push({ page: tag, type: m.type(), text: m.text().slice(0, 300) });
  });
  page.on("pageerror", (e) => obs.pageerrors.push({ page: tag, text: String(e.message).slice(0, 300) }));
  page.on("response", (r) => {
    if (r.status() >= 400) obs.http.push({ page: tag, url: r.url().replace(BASE, ""), status: r.status() });
  });
}
const txt = async (loc) => ((await loc.first().textContent()) || "").replace(/\s+/g, " ").trim();
const cnt = (page, sel) => page.locator(sel).count();
const mainText = async (page) => (await page.locator("main").innerText()).replace(/\s+/g, " ");

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const { token, user } = await register("巡检用户");
  obs.user = { id: user.id, nickname: user.nickname };
  const browser = await launch();

  // ================= 匿名访客视角 =================
  const anon = await newPage(browser);
  wire(anon, "anon");
  await anon.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await anon.waitForTimeout(400);
  log("anon.home", {
    cards: await cnt(anon, ".feed__item"),
    metaRaw: await anon.locator(".feed__item .feed__meta").first().innerText().then((s) => s.replace(/\n/g, "|")),
    metaSpans: await anon.locator(".feed__item .feed__meta").first().evaluate((el) => [...el.children].map((c) => c.textContent)),
    firstTitle: await txt(anon.locator(".feed__title")),
  });
  await anon.goto(`${BASE}/question/127`, { waitUntil: "networkidle" });
  await anon.waitForTimeout(800);
  log("anon.question", { hasEditor: await cnt(anon, "textarea"), text: (await mainText(anon)).slice(-120) });
  const anonShot = await shot(anon, "anon-question");

  // ================= 登录用户视角 =================
  const page = await authedPage(browser, token);
  wire(page, "user");

  // ---- 1. 首页 ----
  const t0 = Date.now();
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  log("home.load", {
    ms: Date.now() - t0, cards: await cnt(page, ".feed__item"),
    skeletonStuck: (await cnt(page, ".skeleton, .feed-skeleton")) > 0,
    tabs: await page.locator("[role=tab]").allTextContents(),
    header: (await page.locator("header").innerText()).replace(/\s+/g, " ").slice(0, 90),
  });
  // 列表 vs 详情 answer_count 是否一致（数值回写）
  const feedJson = await apiOk("GET", "/questions?tab=new&page=1&limit=20");
  const detailFirst = await apiOk("GET", `/questions/${feedJson.items[0].id}`);
  log("home.countConsistency", {
    firstId: feedJson.items[0].id,
    listAnswerCount: feedJson.items[0].answer_count,
    detailAnswerCount: detailFirst.question.answer_count,
    listViewCount: feedJson.items[0].view_count, detailViewCount: detailFirst.question.view_count,
    listFollowCount: feedJson.items[0].follower_count, detailFollowCount: detailFirst.question.follower_count,
  });

  // tab 切换
  for (const label of ["热榜", "关注", "推荐"]) {
    await page.getByRole("tab", { name: label }).click();
    await page.waitForTimeout(1300);
    log(`home.tab.${label}`, {
      url: page.url().replace(BASE, ""), cards: await cnt(page, ".feed__item"),
      ariaSelected: await page.getByRole("tab", { name: label }).getAttribute("aria-selected"),
      body: (await mainText(page)).slice(0, 120),
    });
  }
  const tabShot = await shot(page, "home-following");

  // 加载更多
  await page.getByRole("tab", { name: "推荐" }).click();
  await page.waitForTimeout(1000);
  const beforeMore = await cnt(page, ".feed__item");
  let more = "no-button";
  if (await page.getByRole("button", { name: "加载更多" }).count()) {
    await page.getByRole("button", { name: "加载更多" }).click();
    await page.waitForTimeout(1600);
    more = `${beforeMore} -> ${await cnt(page, ".feed__item")}`;
  }
  log("home.loadmore", { result: more, endText: await txt(page.locator(".feed-end")).catch(() => null) });
  const homeShot = await shot(page, "home");

  // ---- 2. 搜索 ----
  const sbox = page.getByPlaceholder(/搜索问题/);
  await sbox.fill("编程");
  await sbox.press("Enter");
  await page.waitForTimeout(1500);
  log("search", {
    url: page.url().replace(BASE, ""), cards: await cnt(page, ".feed__item"),
    mentionsSearch: /没有找到|无结果|搜索结果/.test(await mainText(page)),
    inputValue: await sbox.inputValue(),
    firstTitle: await txt(page.locator(".feed__title")),
    body: (await mainText(page)).slice(0, 100),
  });
  const searchShot = await shot(page, "search");

  // ---- 3. 详情页 ----
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  const titleLoc = page.locator(".feed__item .feed__title").first();
  const openedTitle = await txt(titleLoc);
  await titleLoc.click();
  await page.waitForTimeout(1500);
  const qUrl = page.url();
  const qid = qUrl.split("/question/")[1];
  log("question.open", {
    url: qUrl.replace(BASE, ""), title: await txt(page.locator("h1")), sameAsClicked: (await txt(page.locator("h1"))) === openedTitle,
    answers: await cnt(page, ".answer"), answersCountText: await txt(page.locator(".answers__count")),
    hasSortControl: (await page.getByRole("button", { name: /默认|最新|最热|排序|按时间/ }).count()) > 0,
    hasVoteBtn: (await page.getByRole("button", { name: /赞同|赞成|▲/ }).count()) > 0,
    hasCommentBox: await cnt(page, "textarea"),
    hasFollowBtn: (await page.getByRole("button", { name: /关注|已关注|收藏/ }).count()) > 0,
    body: (await mainText(page)).slice(0, 260),
  });
  const qShot = await shot(page, "question-detail");

  // 「N 人赞同」是否可交互
  const voteLabel = page.locator(".answer__votes").first();
  if (await voteLabel.count()) {
    const b = await txt(voteLabel);
    await voteLabel.click().catch(() => {});
    await page.waitForTimeout(900);
    log("vote.labelClick", { before: b, after: await txt(voteLabel), urlChanged: page.url() !== qUrl, tag: await voteLabel.evaluate((e) => e.tagName) });
  }

  // ---- 4. 写回答 ----
  const answerText = `巡检回答 ${uniq("r")}：先说结论，再给依据。`;
  const ta = page.locator(".answer-editor textarea").first();
  const nBefore = await cnt(page, ".answer");
  const countBefore = await txt(page.locator(".answers__count"));
  let sub = { hasEditor: (await ta.count()) > 0 };
  if (sub.hasEditor) {
    const btn = page.getByRole("button", { name: /发布回答/ }).first();
    sub.initialDisabled = await btn.isDisabled();
    await ta.fill(answerText);
    sub.enabledAfterTyping = !(await btn.isDisabled());
    await btn.evaluate((el) => el.click());
    await page.waitForTimeout(2000);
    sub.answersAfter = await cnt(page, ".answer");
    sub.countTextAfter = await txt(page.locator(".answers__count"));
    sub.countBefore = countBefore;
    sub.newAnswerOnTop = (await txt(page.locator(".answer").first())).includes(answerText.slice(0, 10));
    sub.answersDelta = sub.answersAfter - nBefore;
    sub.editorCleared = (await ta.inputValue()) === "";
    sub.toastText = await txt(page.locator(".toast, [role=status]")).catch(() => "");
    sub.btnDisabledAfter = await btn.isDisabled().catch(() => null);
    sub.shot = await shot(page, "answer-submitted");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
    sub.afterReload = {
      answers: await cnt(page, ".answer"), countText: await txt(page.locator(".answers__count")),
      present: (await mainText(page)).includes(answerText.slice(0, 10)),
    };
    // 列表页 answer_count 是否回写
    const listNow = await apiOk("GET", `/questions?tab=new&page=1&limit=50`);
    const row = listNow.items.find((x) => x.id === Number(qid));
    sub.listAnswerCount = row?.answer_count;
  }
  log("answer.submit", sub);

  // ---- 5. 点赞 / 反对（前端有无入口） ----
  log("vote.ui", {
    voteButtons: await page.getByRole("button", { name: /赞同|反对|▲|▼/ }).count(),
    clickableVoteNodes: await page.locator("[class*=vote], [data-testid*=vote]").count(),
    voteCountNodes: await page.locator(".answer__votes").count(),
    voteCountIsText: await page.locator(".answer__votes").first().evaluate((e) => e.tagName + "/" + e.parentElement.tagName).catch(() => null),
  });
  // 后端投票确实可用（证明是前端缺口）
  const detailNow = await apiOk("GET", `/questions/${qid}`);
  const ansId = detailNow.answers[0]?.id;
  let voteApi = {};
  if (ansId) {
    const r1 = await api("POST", "/votes", { token, body: { target_type: "answer", target_id: ansId, value: 1 } });
    const d1 = await apiOk("GET", `/questions/${qid}`);
    const c1 = d1.answers.find((a) => a.id === ansId)?.vote_up;
    const r2 = await api("POST", "/votes", { token, body: { target_type: "answer", target_id: ansId, value: 0 } });
    const d2 = await apiOk("GET", `/questions/${qid}`);
    voteApi = { up: r1.status, afterUp: c1, cancel: r2.status, afterCancel: d2.answers.find((a) => a.id === ansId)?.vote_up };
  }
  log("vote.backend", voteApi);

  // ---- 6. 评论 ----
  log("comment.ui", { inputs: await page.getByPlaceholder(/评论/).count(), commentNodes: await cnt(page, ".comment, .comments"), mentionsComment: /评论/.test(await mainText(page)) });
  let cmtApi = {};
  if (ansId) {
    const r = await api("POST", "/comments", { token, body: { target_type: "answer", target_id: ansId, body: "巡检评论：写得很清楚。" } });
    cmtApi.create = r.status;
    const l = await api("GET", `/comments?target_type=answer&target_id=${ansId}`);
    cmtApi.listStatus = l.status;
    cmtApi.listTotal = l.data?.total;
    // 页面上评论数是否体现
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
    cmtApi.visibleOnPage = (await mainText(page)).includes("巡检评论");
    cmtApi.pageHasCommentCount = /\d+\s*条?评论/.test(await mainText(page));
  }
  log("comment.backend", cmtApi);

  // ---- 7. 通知 ----
  await page.goto(`${BASE}/notifications`, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  log("notifications", {
    url: page.url().replace(BASE, ""), body: await mainText(page),
    hasBadge: await cnt(page, "[class*=badge], [class*=unread], [class*=dot]") > 0,
    bottomNav: await page.locator("nav[aria-label=底部导航] a").allTextContents(),
  });
  const notifShot = await shot(page, "notifications");
  const unread = await api("GET", "/notifications/unread-count", { token });
  log("notifications.backend", { status: unread.status, body: JSON.stringify(unread.data).slice(0, 120) });

  // ---- 8. 个人主页 ----
  await page.goto(`${BASE}/u/${user.id}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  log("profile", {
    body: (await mainText(page)).slice(0, 200),
    hasFollowBtn: (await page.getByRole("button", { name: /关注|已关注/ }).count()) > 0,
    contentList: await cnt(page, ".answer, .feed__item"),
    clickableStats: await cnt(page, "dl a, .profile__stats a"),
  });
  const profShot = await shot(page, "profile");

  // ---- 9. 提问 ----
  await page.goto(`${BASE}/ask`, { waitUntil: "networkidle" });
  const aTitle = `巡检：${uniq("一个关于前端性能的问题")}？`;
  await page.getByPlaceholder(/一句话说清你的问题/).fill(aTitle);
  await page.getByRole("button", { name: "发布问题" }).click();
  await page.waitForTimeout(2000);
  log("ask.submit", {
    url: page.url().replace(BASE, ""), title: await txt(page.locator("h1")),
    emptyAnswers: /还没有回答/.test(await mainText(page)), countText: await txt(page.locator(".answers__count")),
  });
  const askShot = await shot(page, "ask-published");
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  log("ask.inFeed", { present: (await mainText(page)).includes(aTitle), cards: await cnt(page, ".feed__item") });

  // ---- 10. 异常路由 ----
  await page.goto(`${BASE}/question/999999`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  log("question.404", { body: (await mainText(page)).slice(0, 140), errorBox: await cnt(page, ".errorbox") > 0 });
  const q404 = await shot(page, "question-404");
  await page.goto(`${BASE}/u/999999`, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  log("user.404", { body: (await mainText(page)).slice(0, 120) });
  await page.goto(`${BASE}/no-such-page`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  log("route.404", { body: (await mainText(page)).slice(0, 120) });

  obs.shots = { anonQuestion: anonShot, home: homeShot, tabFollowing: tabShot, search: searchShot, question: qShot, notifications: notifShot, profile: profShot, ask: askShot, q404 };
  obs.notes = notes;
  fs.writeFileSync(path.join(SHOT_DIR, "observations.json"), JSON.stringify(obs, null, 2));
  console.log(notes.join("\n"));
  console.log("\nconsole:", JSON.stringify(obs.console.slice(0, 15), null, 1));
  console.log("pageerrors:", JSON.stringify(obs.pageerrors.slice(0, 8), null, 1));
  console.log("http>=400:", JSON.stringify(obs.http.slice(0, 15), null, 1));
  await browser.close();
}
main().catch((e) => {
  console.error("FATAL", e.stack || e);
  fs.writeFileSync(path.join(SHOT_DIR, "observations.json"), JSON.stringify({ ...obs, fatal: String(e.stack || e) }, null, 2));
  process.exit(1);
});
