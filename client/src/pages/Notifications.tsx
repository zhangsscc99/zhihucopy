import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { get } from "../api";
import { useAuth } from "../auth";
import { useNotifications } from "../notifications";
import { useToast } from "../toast";
import { Empty, ErrorBox } from "../components/Layout";
import { FeedSkeleton } from "../components/Skeleton";
import { formatTime } from "../lib/time";

interface NotificationActor {
  id: number;
  nickname: string;
  avatar_url: string;
}

interface NotificationItem {
  id: number;
  type: string;
  event?: string | null;
  event_label?: string | null;
  excerpt?: string | null;
  actor: NotificationActor | null;
  target: { type: string; id: number } | null;
  payload: {
    question_id?: number;
    question_title?: string;
    answer_id?: number;
    answer_excerpt?: string;
    anchor?: string;
    excerpt?: string;
  } | null;
  is_read: boolean;
  created_at: string;
}

interface NotificationList {
  items?: NotificationItem[];
  total?: number;
  unread?: number;
  counts?: Record<string, number>;
}

const LIMIT = 50;

// 分类 tab：评论/赞同按服务端 TYPE_GROUPS 口径聚合（评论含回复、赞同含 vote）。
const TABS: { key: string; label: string; type?: string }[] = [
  { key: "all", label: "全部" },
  { key: "comment", label: "评论", type: "comment,reply" },
  { key: "agree", label: "赞同", type: "agree,vote" },
  { key: "follow", label: "关注", type: "follow" },
];

const ACTION_TEXT: Record<string, string> = {
  agree: "赞同了你的回答",
  vote: "赞同了你的回答",
  comment: "评论了你的回答",
  reply: "回复了你的评论",
  follow: "关注了你",
  answer: "回答了你的问题",
  moderation: "处理了你的回答",
};


// #answer-N 锚点：优先取服务端 payload.anchor，缺失时按 answer_id/target 兜底拼，
// 保证 answer 类事件的行 href 始终落到具体回答上。
function answerAnchor(n: NotificationItem): string | null {
  const p = n.payload?.anchor;
  if (typeof p === "string" && /^#answer-\d+$/.test(p)) return p;
  const aid =
    n.payload?.answer_id ??
    (n.target?.type === "answer" ? n.target.id : null);
  return aid ? `#answer-${aid}` : null;
}

function questionLinkFor(n: NotificationItem): string | null {
  const qid =
    n.payload?.question_id ??
    (n.target?.type === "question" ? n.target.id : null);
  if (!qid) return null;
  return `/question/${qid}${answerAnchor(n) ?? ""}`;
}

// 通知的落点：问题/回答类跳问题页（回答类带 #answer- 锚点），
// 关注类跳用户主页，其余不可点。
function linkFor(n: NotificationItem): string | null {
  if (n.type === "follow") return n.actor ? `/u/${n.actor.id}` : null;
  return questionLinkFor(n);
}

// 事件类型图标：内联 SVG、stroke=currentColor，颜色由 .ntf__icon 控制。
function TypeIcon({ kind }: { kind: string }) {
  const paths: Record<string, ReactNode> = {
    // 回答：铅笔
    answer_my_question: (
      <>
        <path d="M4 20h16" />
        <path d="M14.5 4.5l4 4L8 19l-4.5.8L4.3 15 14.5 4.5z" />
      </>
    ),
    // 评论：气泡
    commented: (
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H9l-4.4 3.6A.5.5 0 0 1 4 19.2V5.5z" />
    ),
    // 回复：回弯箭头
    replied: (
      <>
        <path d="M9 14l-5-5 5-5" />
        <path d="M4 9h8a6 6 0 0 1 6 6v4" />
      </>
    ),
    // 赞同：拇指
    agreed: (
      <>
        <path d="M7 10.5v9" />
        <path d="M7 11l3.6-7.2c1.4-.2 2.7.8 2.7 2.3 0 .9-.3 2.2-.8 3.4h5.6a2 2 0 0 1 2 2.4l-1.1 6a2 2 0 0 1-2 1.6H7" />
      </>
    ),
    // 关注：人形 + 加号
    followed_you: (
      <>
        <circle cx="10" cy="8" r="3.5" />
        <path d="M4.5 20v-1a5.5 5.5 0 0 1 5.5-5.5h1" />
        <path d="M19 14v6M16 17h6" />
      </>
    ),
    // 处理：盾牌
    moderated: (
      <path d="M12 3.5l7 2.8v5.2c0 4.7-3.1 7.7-7 9.5-3.9-1.8-7-4.8-7-9.5V6.3l7-2.8z" />
    ),
    // 兜底：铃铛
    other: (
      <>
        <path d="M18 9.5a6 6 0 1 0-12 0c0 5.5-2 6.5-2 6.5h16s-2-1-2-6.5" />
        <path d="M10.3 19a2 2 0 0 0 3.4 0" />
      </>
    ),
  };
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[kind] || paths.other}
    </svg>
  );
}

function NotificationRow({
  n,
  onRead,
}: {
  n: NotificationItem;
  onRead: (n: NotificationItem) => void;
}) {
  const actor = n.actor;
  const action = n.event_label || ACTION_TEXT[n.type] || "与你互动了";
  const to = linkFor(n);
  const title = n.payload?.question_title;
  const excerpt = n.excerpt || n.payload?.excerpt || n.payload?.answer_excerpt;
  const kind = n.event || "other";

  return (
    <li className={`ntf__item${n.is_read ? "" : " ntf__item--unread"}`}>
      <span className="ntf__icon" aria-hidden="true">
        <TypeIcon kind={kind} />
      </span>
      <div className="ntf__main">
        <p className="ntf__line">
          <span className="ntf__name">{actor?.nickname || "用户"}</span>
          <span className="ntf__action">{` · ${action}`}</span>
        </p>
        {title && <span className="ntf__title">{title}</span>}
        <div className="ntf__foot">
          {excerpt ? <p className="ntf__excerpt">{excerpt}</p> : null}
          <time className="ntf__time" dateTime={n.created_at}>
            {formatTime(n.created_at)}
          </time>
        </div>
      </div>
      {to && (
        <Link
          to={to}
          className="ntf__hit"
          aria-label={`${actor?.nickname || "用户"}${action}`}
          onClick={() => onRead(n)}
        />
      )}
    </li>
  );
}

export function Notifications() {
  const { user, loading: authLoading } = useAuth();
  const { unread, markAllRead, markRead, markReadMany, syncUnread } =
    useNotifications();
  const toast = useToast();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [marking, setMarking] = useState(false);
  const [error, setError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [searchParams, setSearchParams] = useSearchParams();
  const requestSeq = useRef(0);
  // 进入页面自动已读只做一次（StrictMode 双跑与 reloadToken 重试都靠它挡住重复写）。
  const autoReadRef = useRef(false);

  // tab 以 ?type= 为唯一事实源，浏览器前进/后退可还原选中态。
  const tabParam = searchParams.get("type") || "all";
  const tab = TABS.some((t) => t.key === tabParam) ? tabParam : "all";
  const activeTab = TABS.find((t) => t.key === tab) || TABS[0];
  const typeQuery = activeTab.type ? `&type=${activeTab.type}` : "";
  // 全部分类下的总条数：counts 缺失时仅「全部」tab 能用 total 兜底。
  const allTotal = counts?.all ?? (tab === "all" ? total : null);

  const switchTab = (key: string) => {
    if (key === tab) return;
    setSearchParams(key === "all" ? {} : { type: key });
  };

  useEffect(() => {
    if (authLoading || !user) {
      setLoading(false);
      return;
    }
    const seq = ++requestSeq.current;
    setLoading(true);
    setError("");
    get<NotificationList>(`/notifications?limit=${LIMIT}${typeQuery}`)
      .then((res) => {
        if (seq !== requestSeq.current) return;
        const list = res?.items ?? [];
        setItems(list);
        setTotal(res?.total ?? list.length);
        if (res?.counts && typeof res.counts === "object") setCounts(res.counts);
        // 列表响应里的 unread 是全局未读数，同步给角标保证页内计数与角标一致。
        if (typeof res?.unread === "number") syncUnread(res.unread);
        // 列表成功加载即视为已读：把本页返回的未读项批量落库，角标随之归零。
        // 加载失败走 catch，不会到这里；标记失败时放开守卫允许重试时补标。
        if (!autoReadRef.current) {
          autoReadRef.current = true;
          const ids = list.filter((n) => !n.is_read).map((n) => n.id);
          if (ids.length) {
            const idSet = new Set(ids);
            markReadMany(ids)
              .then(() => {
                setItems((prev) =>
                  prev.map((x) =>
                    idSet.has(x.id) ? { ...x, is_read: true } : x
                  )
                );
              })
              .catch(() => {
                autoReadRef.current = false;
              });
          }
        }
      })
      .catch((e: Error) => {
        if (seq !== requestSeq.current) return;
        setError(e.message || "通知加载失败");
      })
      .finally(() => {
        if (seq !== requestSeq.current) return;
        setLoading(false);
      });
  }, [authLoading, user, syncUnread, markReadMany, reloadToken, typeQuery]);

  const loadMore = () => {
    if (loadingMore) return;
    setLoadingMore(true);
    get<NotificationList>(
      `/notifications?limit=${LIMIT}&offset=${items.length}${typeQuery}`
    )
      .then((res) => {
        const more = res?.items ?? [];
        setItems((prev) => [
          ...prev,
          ...more.filter((m) => !prev.some((x) => x.id === m.id)),
        ]);
        if (typeof res?.total === "number") setTotal(res.total);
        if (typeof res?.unread === "number") syncUnread(res.unread);
      })
      .catch(() => toast("加载失败，请稍后重试", "error"))
      .finally(() => setLoadingMore(false));
  };

  const onMarkAll = () => {
    if (marking) return;
    setMarking(true);
    markAllRead()
      .then(() => {
        setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
      })
      .catch(() => toast("标记失败，请稍后重试", "error"))
      .finally(() => setMarking(false));
  };

  const onRead = (n: NotificationItem) => {
    if (n.is_read) return;
    setItems((prev) =>
      prev.map((x) => (x.id === n.id ? { ...x, is_read: true } : x))
    );
    markRead(n.id).catch(() => {
      setItems((prev) =>
        prev.map((x) => (x.id === n.id ? { ...x, is_read: false } : x))
      );
    });
  };

  if (authLoading) return <FeedSkeleton count={4} />;
  if (!user) {
    return (
      <Empty
        title="登录后查看通知"
        hint="登录后即可看到赞同、评论与关注动态"
        action={
          <Link to="/login" className="btn btn--outline">
            去登录
          </Link>
        }
      />
    );
  }

  return (
    <>
      <header className="ntf-head">
        <h1 className="ntf-head__title">通知</h1>
        {!loading && !error && (allTotal ?? 0) > 0 && (
          <div className="ntf-head__side">
            <span className="ntf-head__meta">
              {unread > 0 ? `${unread} 条未读` : "全部已读"} · 共 {total} 条
            </span>
            {unread > 0 && (
              <button
                type="button"
                className="ntf-head__read-all"
                onClick={onMarkAll}
                disabled={marking}
              >
                {marking ? "标记中…" : "全部标为已读"}
              </button>
            )}
          </div>
        )}
      </header>

      {!error && (
        <div className="notify__tabs" role="tablist" aria-label="通知分类">
          {TABS.map((t) => {
            const n = counts?.[t.key];
            const hasCount = typeof n === "number" && n > 0;
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                aria-label={hasCount ? `${t.label}，${n} 条` : `${t.label}，暂无`}
                className={`notify__tab${tab === t.key ? " is-active" : ""}`}
                onClick={() => switchTab(t.key)}
              >
                {t.label}
                {hasCount && (
                  <span className="notify__tab-count"> {n}</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {loading ? (
        <FeedSkeleton count={4} />
      ) : error ? (
        <ErrorBox message={error} onRetry={() => setReloadToken((n) => n + 1)} />
      ) : items.length === 0 && tab !== "all" ? (
        <Empty
          title="暂无该类型通知"
          hint={`「${activeTab.label}」分类下还没有通知`}
          action={
            <button
              type="button"
              className="btn btn--outline"
              onClick={() => switchTab("all")}
            >
              看全部通知
            </button>
          }
        />
      ) : items.length === 0 ? (
        <Empty
          title="暂时没有新消息"
          hint="有人赞同或评论你的回答、关注你时，会出现在这里"
          action={
            <>
              <div className="empty__actions">
                <Link to="/" className="btn btn--outline">
                  去首页看看热门讨论
                </Link>
                <Link to="/topics" className="btn btn--outline">
                  去发现值得关注的话题
                </Link>
              </div>
              <p className="empty__guide">关注作者后，他们的新回答会出现在关注流</p>
            </>
          }
        />
      ) : (
        <>
          <ul className="ntf">
            {items.map((n) => (
              <NotificationRow key={n.id} n={n} onRead={onRead} />
            ))}
          </ul>
          {total > items.length && (
            <div className="feed-end">
              <p className="ntf-more__hint">
                共 {total} 条，仅显示最近 {items.length} 条
              </p>
              <button
                type="button"
                className="btn btn--outline"
                onClick={loadMore}
                disabled={loadingMore}
              >
                {loadingMore ? "加载中…" : "加载更多"}
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}
