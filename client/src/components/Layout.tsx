import type { ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import { TopNav } from "./TopNav";
import { useAuth } from "../auth";
import { useNotifications } from "../notifications";

function TabIcon({ kind }: { kind: "home" | "explore" | "post" | "bell" | "me" }) {
  const paths = {
    home: (
      <>
        <path d="M4.5 10.5 12 4l7.5 6.5" />
        <path d="M6 9.8V19a1 1 0 0 0 1 1h3.4v-5.2h3.2V20H17a1 1 0 0 0 1-1V9.8" />
      </>
    ),
    explore: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="m15.5 8.5-1.8 5.2-5.2 1.8 1.8-5.2z" />
      </>
    ),
    post: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 8.5v7M8.5 12h7" />
      </>
    ),
    bell: (
      <>
        <path d="M18 9.5a6 6 0 1 0-12 0c0 5.5-2 6.5-2 6.5h16s-2-1-2-6.5" />
        <path d="M10.3 19a2 2 0 0 0 3.4 0" />
      </>
    ),
    me: (
      <>
        <circle cx="12" cy="8" r="3.8" />
        <path d="M4.8 20a7.4 7.4 0 0 1 14.4 0" />
      </>
    ),
  };
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[kind]}
    </svg>
  );
}

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
          <TabIcon kind="home" />
          <span>首页</span>
        </NavLink>
        <NavLink to="/topics">
          <TabIcon kind="explore" />
          <span>发现</span>
        </NavLink>
        <NavLink to="/ask">
          <TabIcon kind="post" />
          <span>发布</span>
        </NavLink>
        <NavLink to="/notifications">
          <TabIcon kind="bell" />
          <span>通知</span>
          {user && unread > 0 && (
            <span className="badge">{unread > 99 ? "99+" : unread}</span>
          )}
        </NavLink>
        <NavLink to="/me">
          <TabIcon kind="me" />
          <span>我</span>
        </NavLink>
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
