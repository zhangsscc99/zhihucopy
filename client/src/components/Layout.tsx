import type { ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import { TopNav } from "./TopNav";
import { useAuth } from "../auth";
import { useNotifications } from "../notifications";

export function Layout({ children, rail }: { children: ReactNode; rail?: ReactNode }) {
  const { user } = useAuth();
  const { unread } = useNotifications();
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
        <NavLink to="/notifications">
          通知
          {user && unread > 0 && (
            <span className="badge">{unread > 99 ? "99+" : unread}</span>
          )}
        </NavLink>
        <NavLink to="/me">我</NavLink>
      </nav>
    </div>
  );
}

export function Empty({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <p className="empty__title">{title}</p>
      {hint && <p className="empty__hint">{hint}</p>}
      {action && <div className="empty__action">{action}</div>}
    </div>
  );
}

export function ErrorBox({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="errorbox" role="alert">
      <p className="errorbox__msg">{message}</p>
      <div className="errorbox__hint">
        请稍后重试；若持续失败，请检查网络后刷新页面。
      </div>
      {onRetry && (
        <div className="errorbox__actions">
          <button type="button" className="btn btn--outline" onClick={onRetry}>
            重试
          </button>
        </div>
      )}
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
