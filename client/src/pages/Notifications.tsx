import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { get } from "../api";
import { useAuth } from "../auth";
import { useNotifications } from "../notifications";
import { useToast } from "../toast";
import { Empty, ErrorBox } from "../components/Layout";
import { FeedSkeleton } from "../components/Skeleton";

interface NotificationActor {
  id: number;
  nickname: string;
  avatar_url: string;
}

interface NotificationItem {
  id: number;
  type: string;
  actor: NotificationActor | null;
  target: { type: string; id: number } | null;
  payload: {
    question_id?: number;
    question_title?: string;
    answer_id?: number;
    answer_excerpt?: string;
  } | null;
  is_read: boolean;
  created_at: string;
}

interface NotificationList {
  items?: NotificationItem[];
  total?: number;
  unread?: number;
}

const LIMIT = 50;

const ACTION_TEXT: Record<string, string> = {
  agree: "赞同了你的回答",
  vote: "赞同了你的回答",
  comment: "评论了你的回答",
  follow: "关注了你",
  answer: "回答了你的问题",
};

const relTime = (s: string) => {
  const mins = Math.floor((Date.now() - new Date(s + "Z").getTime()) / 60000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return new Date(s + "Z").toLocaleDateString("zh-CN");
};

// 通知的落点：问题/回答类跳问题页，关注类跳用户主页，其余不可点。
function linkFor(n: NotificationItem): string | null {
  if (n.type === "follow") return n.actor ? `/u/${n.actor.id}` : null;
  const qid =
    n.payload?.question_id ??
    (n.target?.type === "question" ? n.target.id : null);
  return qid ? `/question/${qid}` : null;
}

function NotificationRow({
  n,
  onRead,
}: {
  n: NotificationItem;
  onRead: (n: NotificationItem) => void;
}) {
  const actor = n.actor;
  const action = ACTION_TEXT[n.type] ?? "与你互动了";
  const to = linkFor(n);
  const title = n.payload?.question_title;

  const body = (
    <p className="ntf__line">
      <span className="ntf__name">{actor?.nickname || "用户"}</span>
      {" " + action}
      {title ? `《${title}》` : ""}
    </p>
  );

  return (
    <li className={`ntf__item${n.is_read ? "" : " ntf__item--unread"}`}>
      {actor ? (
        <Link
          to={`/u/${actor.id}`}
          className="avatar ntf__avatar"
          aria-label={`${actor.nickname} 的主页`}
        >
          {actor.avatar_url ? (
            <img src={actor.avatar_url} alt="" />
          ) : (
            actor.nickname.slice(0, 1) || "·"
          )}
        </Link>
      ) : (
        <span className="avatar ntf__avatar">·</span>
      )}
      {to ? (
        <Link to={to} className="ntf__body" onClick={() => onRead(n)}>
          {body}
        </Link>
      ) : (
        <div className="ntf__body">{body}</div>
      )}
      <time className="ntf__time" dateTime={n.created_at}>
        {relTime(n.created_at)}
      </time>
    </li>
  );
}

export function Notifications() {
  const { user, loading: authLoading } = useAuth();
  const { unread, markAllRead, markRead, syncUnread } = useNotifications();
  const toast = useToast();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [marking, setMarking] = useState(false);
  const [error, setError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const requestSeq = useRef(0);

  useEffect(() => {
    if (authLoading || !user) {
      setLoading(false);
      return;
    }
    const seq = ++requestSeq.current;
    setLoading(true);
    setError("");
    get<NotificationList>(`/notifications?limit=${LIMIT}`)
      .then((res) => {
        if (seq !== requestSeq.current) return;
        const list = res?.items ?? [];
        setItems(list);
        setTotal(res?.total ?? list.length);
        // 列表响应里的 unread 是全局未读数，同步给角标保证页内计数与角标一致。
        if (typeof res?.unread === "number") syncUnread(res.unread);
      })
      .catch((e: Error) => {
        if (seq !== requestSeq.current) return;
        setError(e.message || "通知加载失败");
      })
      .finally(() => {
        if (seq !== requestSeq.current) return;
        setLoading(false);
      });
  }, [authLoading, user, syncUnread, reloadToken]);

  const loadMore = () => {
    if (loadingMore) return;
    setLoadingMore(true);
    get<NotificationList>(`/notifications?limit=${LIMIT}&offset=${items.length}`)
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
        {!loading && !error && items.length > 0 && (
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

      {loading ? (
        <FeedSkeleton count={4} />
      ) : error ? (
        <ErrorBox message={error} onRetry={() => setReloadToken((n) => n + 1)} />
      ) : items.length === 0 ? (
        <Empty
          title="暂时没有新通知"
          hint="赞同、评论与关注会出现在这里"
          action={
            <Link to="/" className="btn btn--outline">
              去首页看看热门讨论
            </Link>
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
