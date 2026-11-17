import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError, del, get } from "../api";
import { useAuth } from "../auth";
import { useToast } from "../toast";
import { Empty, ErrorBox } from "../components/Layout";
import { FeedSkeleton } from "../components/Skeleton";
import { formatTime } from "../lib/time";

interface Collection {
  id: number;
  owner_id: number;
  name: string;
  is_public: number;
  created_at: string;
  item_count: number;
  last_collected_at?: string | null;
}

interface CollectionAnswer {
  id: number;
  answer_id: number;
  question_id: number;
  question_title: string;
  content_md: string;
  vote_up: number;
  comment_count: number;
  created_at: string;
  collected_at: string;
  author: { id: number; nickname: string; avatar_url: string };
}

function excerpt(md: string, n = 120) {
  const text = md.replace(/[#>*`\-[\]()!]/g, "").replace(/\s+/g, " ").trim();
  return text.length > n ? text.slice(0, n) + "…" : text;
}

function CollectionLoginGate() {
  return (
    <Empty
      title="登录后查看你的收藏"
      hint="收藏的回答会按收藏夹整理在这里"
      action={
        <Link
          to="/login?next=/collections"
          state={{ returnTo: "/collections", pushed: true }}
          className="btn btn--outline"
        >
          去登录
        </Link>
      }
    />
  );
}

export function Collections() {
  const { user, loading: authLoading } = useAuth();
  const [items, setItems] = useState<Collection[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setError("");
    get<{ collections: Collection[] }>("/collections")
      .then((d) => {
        if (alive) setItems(d.collections);
      })
      .catch((e: Error) => {
        if (alive) setError(e.message || "加载失败");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [authLoading, user, reloadToken]);

  if (authLoading) return <FeedSkeleton count={3} />;
  if (!user) return <CollectionLoginGate />;

  return (
    <>
      <header className="page-head">
        <h1 className="page-head__title">我的收藏</h1>
        <p className="page-head__desc">
          {items && items.length > 0
            ? `共 ${items.length} 个收藏夹，点进去查看内容`
            : "收藏的回答会按收藏夹整理在这里"}
        </p>
      </header>
      {loading ? (
        <FeedSkeleton count={3} />
      ) : error ? (
        <ErrorBox message={error} onRetry={() => setReloadToken((n) => n + 1)} />
      ) : !items || items.length === 0 ? (
        <Empty
          title="还没有收藏夹"
          hint="在回答下方点「收藏」，把喜欢的内容收进来"
          action={
            <Link to="/" className="btn btn--outline">
              去首页逛逛
            </Link>
          }
        />
      ) : (
        <ul className="col-list">
          {items.map((c) => (
            <li key={c.id}>
              <Link to={`/collections/${c.id}`} className="col-card">
                <span className="col-card__name">{c.name}</span>
                <span className="col-card__meta">
                  <span>{c.item_count} 条内容</span>
                  <span>
                    更新于 {formatTime(c.last_collected_at || c.created_at)}
                  </span>
                  {!c.is_public && <span>仅自己可见</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function CollectionDetail() {
  const { id } = useParams<{ id: string }>();
  const { user, loading: authLoading } = useAuth();
  const toast = useToast();
  const [col, setCol] = useState<Collection | null>(null);
  const [items, setItems] = useState<CollectionAnswer[] | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);
  const [removing, setRemoving] = useState<Record<number, boolean>>({});
  const reqSeq = useRef(0);

  useEffect(() => {
    if (authLoading) return;
    const seq = ++reqSeq.current;
    setLoading(true);
    setError("");
    setStatus(null);
    Promise.all([
      get<{ collection: Collection }>(`/collections/${id}`),
      get<{ items: CollectionAnswer[] }>(`/collections/${id}/items`),
    ])
      .then(([c, it]) => {
        if (seq !== reqSeq.current) return;
        setCol(c.collection);
        setItems(it.items);
      })
      .catch((e: Error) => {
        if (seq !== reqSeq.current) return;
        setError(e.message || "加载失败");
        setStatus(e instanceof ApiError ? e.status : null);
      })
      .finally(() => {
        if (seq === reqSeq.current) setLoading(false);
      });
  }, [authLoading, id, reloadToken]);

  const uncollect = async (answerId: number) => {
    if (!col || removing[answerId]) return;
    setRemoving((r) => ({ ...r, [answerId]: true }));
    try {
      await del(`/collections/${col.id}/items/${answerId}`);
      setItems((xs) => (xs ?? []).filter((x) => x.answer_id !== answerId));
      setCol((c) =>
        c ? { ...c, item_count: Math.max(0, c.item_count - 1) } : c
      );
      toast("已取消收藏");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setRemoving((r) => ({ ...r, [answerId]: false }));
    }
  };

  if (authLoading || loading) return <FeedSkeleton count={3} />;
  if (error) {
    if (status === 403) {
      return (
        <Empty
          title="该收藏夹不可见"
          hint="这是一个私密收藏夹，只有创建者可以查看"
          action={
            <Link to="/" className="btn btn--outline">
              去首页逛逛
            </Link>
          }
        />
      );
    }
    if (status === 404) {
      return (
        <Empty
          title="收藏夹不存在"
          hint="它可能已被删除"
          action={
            <Link to="/collections" className="btn btn--outline">
              返回我的收藏
            </Link>
          }
        />
      );
    }
    return (
      <ErrorBox message={error} onRetry={() => setReloadToken((n) => n + 1)} />
    );
  }
  if (!col) return <Empty title="收藏夹不存在" />;

  const isOwner = Boolean(user && user.id === col.owner_id);
  const list = items ?? [];

  return (
    <>
      <header className="page-head col-head">
        <Link to="/collections" className="col-head__back">
          ‹ 我的收藏
        </Link>
        <h1 className="page-head__title">{col.name}</h1>
        <p className="page-head__desc">
          {col.item_count} 条内容
          {" · 更新于 "}
          {formatTime(col.last_collected_at || col.created_at)}
          {!col.is_public && " · 仅自己可见"}
        </p>
      </header>

      {list.length === 0 ? (
        <Empty
          title="收藏夹还是空的"
          hint="在回答下方点「收藏」，把喜欢的内容收进来"
          action={
            <Link to="/" className="btn btn--outline">
              去首页逛逛
            </Link>
          }
        />
      ) : (
        <ul className="col-list">
          {list.map((it) => (
            <li key={it.answer_id} className="colfav">
              <div className="colfav__author">
                <Link
                  to={`/u/${it.author.id}`}
                  className="avatar"
                  aria-label={`${it.author.nickname} 的主页`}
                >
                  {it.author.avatar_url ? (
                    <img src={it.author.avatar_url} alt="" />
                  ) : (
                    it.author.nickname.slice(0, 1)
                  )}
                </Link>
                <Link to={`/u/${it.author.id}`} className="answer__name">
                  {it.author.nickname}
                </Link>
              </div>
              <Link
                to={`/question/${it.question_id}#answer-${it.answer_id}`}
                className="colfav__body"
              >
                <p className="feed__excerpt">{excerpt(it.content_md)}</p>
              </Link>
              <div className="colfav__meta">
                <Link
                  to={`/question/${it.question_id}`}
                  className="colfav__question"
                >
                  回答了《{it.question_title}》
                </Link>
                <span>{it.vote_up} 赞同</span>
                <span>{it.comment_count} 条评论</span>
                <span>收藏于 {formatTime(it.collected_at)}</span>
                {isOwner && (
                  <button
                    type="button"
                    className="answer__action colfav__remove"
                    disabled={removing[it.answer_id]}
                    onClick={() => void uncollect(it.answer_id)}
                  >
                    {removing[it.answer_id] ? "取消中…" : "取消收藏"}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
