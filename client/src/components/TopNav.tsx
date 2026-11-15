import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { Button } from "./ui";

export function TopNav() {
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState("");
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

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    // 搜索页在 M3 里程碑上线；先保留入口。
    if (query.trim()) navigate(`/?q=${encodeURIComponent(query.trim())}`);
  };

  return (
    <header className="topnav">
      <div className="topnav__inner">
        <Link to="/" className="brand" aria-label="知海首页">
          <span className="brand__seal">知</span>
          <span className="brand__name">知海</span>
        </Link>

        <form className="topnav__search" onSubmit={submitSearch} role="search">
          <input
            className="field field--search"
            placeholder="搜索问题、回答、用户"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="搜索"
          />
        </form>

        <nav className="topnav__links">
          <NavLink to="/" end className="topnav__link">
            首页
          </NavLink>
        </nav>

        <div className="topnav__actions">
          <Button onClick={() => navigate("/ask")}>提问</Button>
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
