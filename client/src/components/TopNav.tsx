import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth";
import { useNotifications } from "../notifications";
import { Button } from "./ui";

export function TopNav() {
  const { user, logout } = useAuth();
  const { unread } = useNotifications();
  const [menuOpen, setMenuOpen] = useState(false);
  const [params] = useSearchParams();
  const qParam = params.get("q") || "";
  const [query, setQuery] = useState(qParam);
  const menuRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // 结果页回填关键词；URL 上的 q 变化时同步输入框（取消搜索也会清空）。
  useEffect(() => {
    setQuery(qParam);
  }, [qParam]);

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) navigate(`/?q=${encodeURIComponent(query.trim())}`);
  };

  const clearSearch = () => {
    setQuery("");
    if (qParam) navigate("/");
  };

  return (
    <header className="topnav">
      <div className="topnav__inner">
        <Link to="/" className="brand" aria-label="知乎（仿）首页">
          <span className="brand__name">知乎（仿）</span>
        </Link>

        <nav className="topnav__links">
          <NavLink to="/" end className="topnav__link">
            首页
          </NavLink>
          <NavLink to="/topics" className="topnav__link">
            发现
          </NavLink>
          <NavLink to="/unanswered" className="topnav__link">
            等你来答
          </NavLink>
        </nav>

        <form className="topnav__search" onSubmit={submitSearch} role="search">
          <button
            type="submit"
            className="topnav__search-submit"
            aria-label="提交搜索"
            disabled={!query.trim()}
          >
            <svg
              className="topnav__search-icon"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
              <path
                d="m20 20-3.8-3.8"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <input
            className="field field--search"
            placeholder="搜索问题、回答、用户"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="搜索"
          />
          {query && (
            <button
              type="button"
              className="topnav__search-clear"
              aria-label="清除搜索"
              onClick={clearSearch}
            >
              ×
            </button>
          )}
        </form>

        <div className="topnav__actions">
          {user && (
            <Link
              to="/notifications"
              className="topnav__bell"
              aria-label={unread > 0 ? `通知，${unread} 条未读` : "通知"}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 0 0-4-5.7V5a2 2 0 1 0-4 0v.3A6 6 0 0 0 6 11v3.2c0 .5-.2 1-.6 1.4L4 17h5"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M9.5 17a2.5 2.5 0 0 0 5 0"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
              {unread > 0 && (
                <span className="badge">{unread > 99 ? "99+" : unread}</span>
              )}
            </Link>
          )}
          <Button className="topnav__ask" onClick={() => navigate("/ask")}>
            提问
          </Button>
          {user ? (
            <div className="usermenu" ref={menuRef}>
              <button
                className="usermenu__trigger"
                onClick={() => setMenuOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
              >
                <span className="avatar">
                  {user.avatar_url ? (
                    <img src={user.avatar_url} alt="" />
                  ) : (
                    user.nickname.slice(0, 1)
                  )}
                </span>
                <span className="usermenu__name">{user.nickname}</span>
              </button>
              {menuOpen && (
                <div className="usermenu__drop" role="menu">
                  <Link to={`/u/${user.id}`} role="menuitem" onClick={() => setMenuOpen(false)}>
                    个人主页
                  </Link>
                  <Link to="/collections" role="menuitem" onClick={() => setMenuOpen(false)}>
                    我的收藏
                  </Link>
                  <button role="menuitem" onClick={logout}>
                    退出登录
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
              <Link to="/login" className="btn btn--ghost">
                登录
              </Link>
              <Link to="/register" className="btn btn--outline">
                注册
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
