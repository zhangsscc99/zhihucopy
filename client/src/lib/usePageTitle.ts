import { useEffect } from "react";

export const SITE_TITLE = "知乎（仿） · 有问题，就会有答案";

// Z1160 — 全站 document.title：主体 +「 · 知乎（仿）」，空值回落默认站点标题。
// 主体 >30 字截断补「…」；undefined/null/空串一律走默认，绝不让 title 出现
// "undefined"，也不把上一页标题残留给无数据/加载中的页面。卸载不恢复——
// 下一页路由会用同样的钩子覆盖。
export function usePageTitle(title?: string | null) {
  const clean = typeof title === "string" ? title.trim() : "";
  useEffect(() => {
    if (!clean) {
      document.title = SITE_TITLE;
      return;
    }
    const chars = Array.from(clean);
    const body = chars.length > 30 ? chars.slice(0, 30).join("") + "…" : clean;
    document.title = `${body} · 知乎（仿）`;
  }, [clean]);
}
