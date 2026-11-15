// Z953 — 顶部搜索真正生效：/?q= 参与检索、命中高亮、结果计数与空态。
// Z962 — 搜索同时命中问题所属话题名：结果带 matched（title|detail|topic）与 topics。
// 静态：Home.tsx 读取 q、渲染「搜索结果」与 <mark class="hl">、按 matched 高亮话题；TopNav 有提交/清除入口。
// 动态：注册用户 + 创建标题带唯一后缀的问题 → GET /search?q=<后缀> 命中且 total>=1、matched==="title"；
//      GET /search?q=编程 → 话题名下确有问题时 total>=1 且有 matched==="topic"、topics 含「编程」；
//      随机串 → total===0 且 items 为空。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ok, req, expect, main, uniq, db } from "./lib.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

main("search-page", async () => {
  // ---------- 静态断言 ----------
  const home = readFileSync(join(root, "client/src/pages/Home.tsx"), "utf8");
  const topNav = readFileSync(join(root, "client/src/components/TopNav.tsx"), "utf8");
  expect(home.includes("搜索结果"), "Home.tsx 缺少「搜索结果」结果态文案");
  expect(/params\.get\("q"\)|params\.get\('q'\)/.test(home), "Home.tsx 未读取 ?q= 参数");
  expect(/<mark[^>]*className="hl"|className="hl"/.test(home), "Home.tsx 缺少 <mark class=\"hl\"> 命中高亮");
  expect(/matched\s*===\s*"topic"/.test(home), "Home.tsx 未按 matched===\"topic\" 高亮话题命中");
  expect(
    /topnav__search-clear|清除搜索/.test(topNav) && /type="submit"/.test(topNav),
    "TopNav.tsx 缺少清除（×）或提交入口",
  );

  // ---------- 动态断言 ----------
  // 注意：搜索结果会过滤测试产物（content-filter），
  // 因此用「真实形态」账号与标题验证「新发问题可被搜到」。
  const nickname = `用户${uniq("n").replace(/-/g, "")}`.slice(0, 24);
  const reg = await req("POST", "/auth/register", {
    body: { email: `${uniq("real")}@zhihucopy.dev`, password: "assert-pass-123", nickname },
  });
  expect(reg.status === 201, `register -> ${reg.status}`);
  const token = reg.data.token;
  const tag = uniq("srch").replace(/-/g, "");
  const title = `前端性能排查记录${tag}`;
  const created = await ok("POST", "/questions", {
    token,
    body: { title, detail_md: "首屏加载慢、包体积大，应该从哪些指标入手排查？" },
  });
  const qid = created.question && created.question.id;
  expect(Number.isInteger(qid), `POST /questions 未返回问题 id：${JSON.stringify(created).slice(0, 160)}`);

  const hit = await ok("GET", `/search?q=${encodeURIComponent(tag)}&type=question`);
  expect(Array.isArray(hit.items), "GET /search 未返回 items 数组");
  expect(hit.total >= 1, `GET /search?q=${tag} total=${hit.total}，期望 >=1`);
  const found = hit.items.find((it) => it.id === qid && it.title === title);
  expect(!!found, `搜索结果中未命中刚创建的问题 #${qid}「${title}」`);
  expect(found.matched === "title", `标题命中结果 matched=${found.matched}，期望 "title"`);
  expect(Array.isArray(found.topics), `搜索结果 items[].topics 应为数组`);

  // ---------- Z962：话题名命中 ----------
  // 真实库里话题「编程」名下确有问题时，搜话题名必须返回且至少一条 matched==="topic"。
  let topicQuestionCount = 0;
  try {
    const d = db();
    topicQuestionCount = d
      .prepare(
        `SELECT COUNT(*) c FROM question_topics qt JOIN topics t ON t.id = qt.topic_id WHERE t.name = '编程'`
      )
      .get().c;
    d.close();
  } catch {
    // DB 不可读时退化为只校验接口形状。
  }
  const prog = await ok("GET", `/search?q=${encodeURIComponent("编程")}`);
  expect(Array.isArray(prog.items), "GET /search?q=编程 未返回 items 数组");
  if (topicQuestionCount > 0) {
    expect(prog.total >= 1, `GET /search?q=编程 total=${prog.total}，话题名下有 ${topicQuestionCount} 个问题，期望 >=1`);
    const topicHit = prog.items.find((it) => it.matched === "topic");
    expect(!!topicHit, `GET /search?q=编程 结果中没有 matched==="topic" 的条目`);
    expect(
      Array.isArray(topicHit.topics) && topicHit.topics.some((t) => String(t.name).includes("编程")),
      "话题命中的 items[].topics 应包含「编程」话题",
    );
  }

  const none = await ok("GET", `/search?q=${encodeURIComponent(uniq("nohit"))}`);
  expect(none.total === 0, `随机串搜索 total=${none.total}，期望 0`);
  expect(Array.isArray(none.items) && none.items.length === 0, "随机串搜索 items 应为空数组");
});
