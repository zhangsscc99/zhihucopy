import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useNavigate, useSearchParams } from "react-router-dom";
import { get } from "../api";
import { useAuth } from "../auth";
import { useNotifications } from "../notifications";
import { loadRecentSearches, saveRecentSearch } from "../lib/searchHistory";
import { searchHref } from "../lib/searchHref";
import type { Page, Question, Topic } from "../types";
import { Button } from "./ui";

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
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
  );
}

// 移动端全屏搜索层：白面板、输入框 + 取消，下方给最近搜索/热门话题可点项。
function MobileSearch({ initial, onClose }: { initial: string; onClose: () => void }) {
  const navigate = useNavigate();
  const [term, setTerm] = useState(initial);
  const [recent, setRecent] = useState<string[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [hot, setHot] = useState<Question[]>([]);
  const [loaded, setLoaded] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // 话题接口无数据时补热榜，保证层内总有可点项；全部落盘后 loaded=true 才允许渲染空态。
  useEffect(() => {
    setRecent(loadRecentSearches());
    const topicsReq = get<Page<Topic>>("/topics?sort=questions&limit=8")
      .then((p) => setTopics(p.items))
      .catch(() => setTopics([]));
    const hotReq = get<Page<Question>>("/questions?tab=hot&limit=8")
      .then((p) => setHot(p.items))
      .catch(() => setHot([]));
    Promise.allSettled([topicsReq, hotReq]).then(() => setLoaded(true));
  }, []);

  // Escape 关闭 + Tab 在弹层内首尾循环；锁背景滚动。onClose 走 ref，避免父组件重渲染重置效果。
  useEffect(() => {
    const root = rootRef.current;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !root) return;
      const items = Array.from(
        root.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      );
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const atEdge = document.activeElement === (e.shiftKey ? first : last);
      const outside = !root.contains(document.activeElement);
      if (atEdge || outside) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, []);

  const submit = (raw: string) => {
    const t = raw.trim();
    if (!t) return;
    saveRecentSearch(t);
    onClose();
    navigate(searchHref(t));
  };

  return (
    <div
      className="msearch"
      role="dialog"
      aria-modal="true"
      aria-label="搜索"
      ref={rootRef}
    >
      <div className="msearch__bar">
        <form
          className="msearch__form"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            submit(term);
          }}
        >
          <button
            type="submit"
            className="msearch__icon"
            aria-label="提交搜索"
            disabled={!term.trim()}
          >
            <SearchIcon />
          </button>
          <input
            type="search"
            className="msearch__input"
            placeholder="搜索问题、回答、用户"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            aria-label="搜索"
            autoFocus
          />
        </form>
        <button
          type="button"
          className="btn btn--ghost msearch__cancel"
          onClick={onClose}
        >
          取消
        </button>
      </div>
      <div className="msearch__body">
        {recent.length > 0 && (
          <section className="msearch__sect">
            <h2 className="msearch__label">最近搜索</h2>
            <div className="msearch__chips">
              {recent.map((w) => (
                <button
                  key={w}
                  type="button"
                  className="msearch__chip"
                  onClick={() => submit(w)}
                >
                  {w}
                </button>
              ))}
            </div>
          </section>
        )}
        {topics.length > 0 ? (
          <section className="msearch__sect">
            <h2 className="msearch__label">热门话题</h2>
            <div className="msearch__chips">
              {topics.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className="msearch__chip"
                  onClick={() => submit(t.name)}
                >
                  {t.name}
                </button>
              ))}
            </div>
          </section>
        ) : hot.length > 0 ? (
          <section className="msearch__sect">
            <h2 className="msearch__label">热榜</h2>
            <ul className="msearch__hot">
              {hot.map((q) => (
                <li key={q.id} className="msearch__hotitem">
                  <Link
                    to={`/question/${q.id}`}
                    className="msearch__hotlink"
                    onClick={onClose}
                  >
                    {q.title}
                  </Link>
                  <span className="msearch__hotmeta">
                    {q.answer_count} 个回答 · {q.view_count} 次浏览
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {loaded &&
          recent.length === 0 &&
          topics.length === 0 &&
          hot.length === 0 && (
            <p className="msearch__empty">暂无推荐内容，输入关键词开始搜索</p>
          )}
      </div>
    </div>
  );
}

export function TopNav() {
  const { user, logout } = useAuth();
  const { unread } = useNotifications();
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [params] = useSearchParams();
  const qParam = params.get("q") || "";
  const [query, setQuery] = useState(qParam);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchBtnRef = useRef<HTMLButtonElement>(null);
  const wasSearchOpen = useRef(false);
  const navigate = useNavigate();

  // 移动搜索层关闭后，焦点归还到放大镜按钮（Escape/取消/提交跳转各路径统一在此处理）。
  useEffect(() => {
    if (wasSearchOpen.current && !searchOpen) searchBtnRef.current?.focus();
    wasSearchOpen.current = searchOpen;
  }, [searchOpen]);

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
    if (query.trim()) navigate(searchHref(query));
  };

  const clearSearch = () => {
    setQuery("");
    if (qParam) navigate("/");
  };

  return (
    <>
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
            <SearchIcon className="topnav__search-icon" />
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
          <button
            type="button"
            ref={searchBtnRef}
            className="topnav__search-btn"
            aria-label="打开搜索"
            onClick={() => setSearchOpen(true)}
          >
            <SearchIcon />
          </button>
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
    {searchOpen && (
      <MobileSearch initial={qParam} onClose={() => setSearchOpen(false)} />
    )}
    </>
  );
}
