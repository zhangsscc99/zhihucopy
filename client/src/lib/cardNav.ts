import type { KeyboardEvent, MouseEvent } from "react";
import type { NavigateFunction } from "react-router-dom";

// 整卡可点（Z1090）：返回的 props 摊到卡片 <li> 上，点卡片任意空白区跳转。
// - 命中卡内真实 <a>/<button>（标题/作者/话题链接）时不抢跳转，交给链接自己；
// - 拖选文字（getSelection 非空）不误跳；
// - 键盘：卡片自身聚焦时 Enter 触发；焦点在卡内子元素上时放行给子元素。
// 卡片本体靠 role="link" + tabIndex 获得可访问语义，不嵌套 <a>。
// 用法：<li className="feed__item" aria-label={title} {...cardNav(navigate, `/question/${id}`)}>
export function cardNav(navigate: NavigateFunction, to: string) {
  return {
    role: "link",
    tabIndex: 0,
    onClick: (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest("a,button")) return;
      if (window.getSelection()?.toString()) return;
      navigate(to);
    },
    onKeyDown: (e: KeyboardEvent) => {
      if (e.target !== e.currentTarget || e.key !== "Enter") return;
      e.preventDefault();
      navigate(to);
    },
  };
}
