// Z970 — 测试内容过滤：assert-*/搜索验收-* 产物不进任何公共读取路径，详情仍可直达。
// 跑法: API_BASE=http://127.0.0.1:3142/zhihucopy/api node scripts/assert/test-content-filter.mjs
import { ok, req, register, expect, main, uniq } from "./lib.mjs";

// 响应 JSON 任意位置出现该串即算泄漏（不依赖具体返回结构）。
const leaks = (data, frag) => JSON.stringify(data).includes(frag);

main("test-content-filter", async () => {
  // 测试账号（assert- 昵称命中 nick 模式）发一个 搜索验收- 标题的问题，挂到真实话题下。
  const { token } = await register(`assert-${uniq("u")}`);
  const frag = uniq("srch");
  const title = `搜索验收-${frag} 关于前端性能`;

  const topics = await ok("GET", "/topics?limit=1&sort=followers");
  const topicId = topics.items[0].id;
  const { question } = await ok("POST", "/questions", {
    token,
    body: { title, detail_md: "过滤验收", topic_ids: [topicId] },
  });
  expect(question.id > 0, "question not created");

  // 1) 公共列表不含：tab=new / tab=hot
  for (const tab of ["new", "hot"]) {
    const list = await ok("GET", `/questions?tab=${tab}&limit=50`);
    expect(!leaks(list, frag), `GET /questions?tab=${tab} leaked test question`);
  }

  // 2) feed 流不含（feed.js 由另一条车道建设；未上线时 404 视为天然不含）。
  for (const p of ["/feed/recommended?limit=50", "/feed/hot"]) {
    const r = await req("GET", p);
    if (r.status === 404) {
      console.log(`  note: ${p} -> 404 (feed 路由尚未上线，视为通过)`);
      continue;
    }
    expect(r.status >= 200 && r.status < 300, `${p} -> ${r.status}`);
    expect(!leaks(r.data, frag), `${p} leaked test question`);
  }

  // 3) 搜索不含：搜「前端性能」（测试标题里含的词）与精确碎片都不得命中它。
  const s1 = await ok("GET", `/search?q=${encodeURIComponent("前端性能")}&limit=50`);
  expect(!leaks(s1, frag), "search「前端性能」leaked test question");
  const s2 = await ok("GET", `/search?q=${encodeURIComponent(frag)}`);
  expect((s2.items || []).length === 0, "search by unique frag returned the test question");

  // 4) 话题流不含：问题挂在该话题下，过滤失效就一定会出现。
  const t = await ok("GET", `/topics/${topicId}?limit=50`);
  expect(!leaks(t, frag), `GET /topics/${topicId} leaked test question`);
  expect(t.topic && t.topic.question_count >= 0, "topic payload missing question_count");

  // 5) 详情不过滤：老链接仍可打开。
  const detail = await ok("GET", `/questions/${question.id}`);
  expect(detail.question.title === title, "detail title mismatch");

  // 6) 真实内容不受误伤：种子标题「代码质量」必须还能搜到、还在列表里。
  const s3 = await ok("GET", `/search?q=${encodeURIComponent("代码质量")}&limit=10`);
  expect((s3.items || []).length > 0, "search「代码质量」returned no real hits — over-filtering?");
  const list = await ok("GET", "/questions?tab=new&limit=50");
  expect(
    (list.items || []).some((q) => (q.title || "").includes("代码质量")),
    "real question missing from tab=new — over-filtering?"
  );
});
