import { useEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

// 每个历史条目（以 location.key 标识）最近一次记录的 scrollY。
// 用内存 Map 而非只依赖 history.state：POP 落地前旧 listener 仍可能把
// scroll 事件写进 state，Map 按 key 隔离互不污染。
const positions = new Map<string, number>();

// Z1201 — 全局滚动策略：
//   · pathname 变化且非浏览器后退/前进（PUSH/REPLACE）→ window.scrollTo(0, 0)；
//   · POP（后退/前进）→ 读回离开该历史条目时记录的滚动位置并恢复；
//   · 滚动位置在 scroll 事件里以 rAF 节流记录（内存 Map + history.state.zhScroll
//     双写），配合入口处的 history.scrollRestoration = "manual" 由我们全权接管。
export function useScrollReset() {
  const { pathname, key } = useLocation();
  const navType = useNavigationType();
  // POP 恢复期间 scrollTo 触发的 scroll 事件不应回写记录（钳制值会污染）。
  const restoring = useRef(false);

  // 持续把当前 scrollY 记进当前历史条目，供 POP 时读回。
  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (restoring.current) return;
        const st = window.history.state;
        const base = typeof st === "object" && st !== null ? st : {};
        // 导航间隙的 scroll 事件仍以旧 key 送达（被动 effect 尚未换 key），
        // 但 history.state 已指向新条目——key 不匹配说明是陈旧事件，丢弃。
        const stKey = typeof base.key === "string" ? base.key : "default";
        if (stKey !== key) return;
        // 落地页更矮时浏览器把 scrollY 钳到该页最大值并派发 scroll——
        // 特征：scrollY == 当前文档最大滚动 且 最大值低于本条目已记录位置，丢弃。
        const docMax = document.documentElement.scrollHeight - window.innerHeight;
        const prev = positions.get(key) ?? 0;
        if (window.scrollY >= docMax - 1 && docMax < prev) return;
        positions.set(key, window.scrollY);
        window.history.replaceState({ ...base, zhScroll: window.scrollY }, "");
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      // 已排队未执行的 save 若放行，会把落地后的钳制 scrollY 误记到本条目。
      if (raf) cancelAnimationFrame(raf);
    };
  }, [key]);

  useEffect(() => {
    if (navType !== "POP") {
      window.scrollTo(0, 0);
      return;
    }
    const st = window.history.state;
    const fromState = typeof st === "object" && st !== null ? st.zhScroll : undefined;
    const y = positions.get(key) ?? (typeof fromState === "number" ? fromState : 0);
    if (typeof y !== "number" || y <= 0) return;
    // 目标页数据/图片未回流完时 scrollTo 会被钳制，间歇重试直到到位；
    // 约 7s 上限兜底（页面确实没有 y 那么高时收敛到可滚最大值）。
    let tries = 0;
    restoring.current = true;
    const timer = window.setInterval(() => {
      window.scrollTo(0, y);
      if (window.scrollY >= y - 1 || ++tries >= 60) stop();
    }, 120);
    const stop = () => {
      window.clearInterval(timer);
      restoring.current = false;
    };
    return stop;
  }, [pathname, key, navType]);
}
