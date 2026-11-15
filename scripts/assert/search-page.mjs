// Z953 — 顶部搜索真正生效：/?q= 参与检索、命中高亮、结果计数与空态。
// 静态：Home.tsx 读取 q、渲染「搜索结果」与 <mark class="hl">；TopNav 有提交/清除入口。
// 动态：注册用户 + 创建标题带唯一后缀的问题 → GET /search?q=<后缀> 命中且 total>=1；
//      随机串 → total===0 且 items 为空。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ok, expect, main, uniq, register } from "./lib.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

main("search-page", async () => {
  // ---------- 静态断言 ----------
  const home = readFileSync(join(root, "client/src/pages/Home.tsx"), "utf8");
  const topNav = readFileSync(join(root, "client/src/components/TopNav.tsx"), "utf8");
  expect(home.includes("搜索结果"), "Home.tsx 缺少「搜索结果」结果态文案");
  expect(/params\.get\("q"\)|params\.get\('q'\)/.test(home), "Home.tsx 未读取 ?q= 参数");
  expect(/<mark[^>]*className="hl"|className="hl"/.test(home), "Home.tsx 缺少 <mark class=\"hl\"> 命中高亮");
  expect(
    /topnav__search-clear|清除搜索/.test(topNav) && /type="submit"/.test(topNav),
    "TopNav.tsx 缺少清除（×）或提交入口",
  );

  // ---------- 动态断言 ----------
  const { token } = await register();
  const tag = uniq("srch");
  const title = `搜索验收-${tag} 关于前端性能`;
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

  const none = await ok("GET", `/search?q=${encodeURIComponent(uniq("nohit"))}`);
  expect(none.total === 0, `随机串搜索 total=${none.total}，期望 0`);
  expect(Array.isArray(none.items) && none.items.length === 0, "随机串搜索 items 应为空数组");
});
