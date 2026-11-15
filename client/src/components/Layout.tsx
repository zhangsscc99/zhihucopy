import type { ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import { TopNav } from "./TopNav";

export function Layout({ children, rail }: { children: ReactNode; rail?: ReactNode }) {
  return (
    <div className="shell">
      <TopNav />
      <div className="container">
        <main className="main-col">{children}</main>
        {rail && <aside className="rail">{rail}</aside>}
      </div>
      <nav className="bottomnav" aria-label="底部导航">
        <NavLink to="/" end>
          首页
        </NavLink>
        <NavLink to="/?tab=hot">热榜</NavLink>
        <NavLink to="/ask">发布</NavLink>
        <NavLink to="/notifications">通知</NavLink>
        <NavLink to="/me">我</NavLink>
      </nav>
    </div>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="empty">
      <p className="empty__title">{title}</p>
      {hint && <p className="empty__hint">{hint}</p>}
    </div>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <div className="errorbox" role="alert">
      {message}
      <div className="errorbox__hint">
        请稍后重试；若持续失败，请检查网络后刷新页面。
      </div>
    </div>
  );
}

export function Spinner() {
  return (
    <div className="spinner" aria-label="加载中">
      <span />
      <span />
      <span />
    </div>
  );
}

export { Link };
