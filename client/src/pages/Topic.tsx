import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { del, get, post } from "../api";
import { useAuth } from "../auth";
import { useToast } from "../toast";
import { Empty } from "../components/Layout";
import { isContentMissing, NotFound } from "./NotFound";
import { FeedSkeleton } from "../components/Skeleton";
import type { Author, Topic as TopicType } from "../types";

const PAGE_SIZE = 20;

// /topics/:key 内容流里的问题行比 Question 少 topics 字段，单独建模。
interface TopicQuestion {
  id: number;
  title: string;
  detail_md: string;
  answer_count: number;
  view_count: number;
  author: Author;
}

interface TopicPage {
  topic: TopicType;
  items: TopicQuestion[];
  total: number;
  has_more: boolean;
}

function excerpt(md: string, n = 90) {
  const text = md.replace(/[#>*`\-[\]()!]/g, "").replace(/\s+/g, " ").trim();
  return text.length > n ? text.slice(0, n) + "…" : text;
}

const topicHref = (t: TopicType) => `/topic/${t.slug || t.id}`;

export function Topic() {
  const { key } = useParams<{ key: string }>();
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [topic, setTopic] = useState<TopicType | null>(null);
  const [items, setItems] = useState<TopicQuestion[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [initialLoading, setInitialLoading] = useState(true);
  const [moreLoading, setMoreLoading] = useState(false);
  const [error, setError] = useState("");
  const [notFound, setNotFound] = useState(false);
  const [moreError, setMoreError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);

  const [following, setFollowing] = useState(false);
  const [followPending, setFollowPending] = useState(false);

  const [related, setRelated] = useState<TopicType[]>([]);

  const requestSeq = useRef(0);

  useEffect(() => {
    const seq = ++requestSeq.current;
    setInitialLoading(true);
    setError("");
    setNotFound(false);
    setMoreError("");
    setMoreLoading(false);
    setItems([]);
    setHasMore(false);
    setPage(1);
    setTopic(null);
    get<TopicPage>(`/topics/${encodeURIComponent(key ?? "")}?page=1&limit=${PAGE_SIZE}`)
      .then((res) => {
        if (seq !== requestSeq.current) return;
        setTopic(res.topic);
        setFollowing(Boolean(res.topic.is_following));
        setItems(res.items);
        setHasMore(res.has_more && res.items.length > 0);
      })
      .catch((e: Error) => {
        if (seq !== requestSeq.current) return;
        if (isContentMissing(e)) setNotFound(true);
        else setError(e.message || "话题加载失败");
      })
      .finally(() => {
        if (seq !== requestSeq.current) return;
        setInitialLoading(false);
      });
  }, [key, reloadToken]);

  // 相关话题：按关注数取前 8，剔除当前话题后展示前 6。
  useEffect(() => {
    if (!topic) return;
    let alive = true;
    get<{ items: TopicType[] }>("/topics?sort=followers&limit=8")
      .then((res) => {
        if (!alive) return;
        setRelated(res.items.filter((t) => t.id !== topic.id).slice(0, 6));
      })
      .catch(() => {
        if (alive) setRelated([]);
      });
    return () => {
      alive = false;
    };
  }, [topic]);

  const loadMore = useCallback(() => {
    if (moreLoading || initialLoading) return;
    const seq = requestSeq.current;
    const next = page + 1;
    setMoreLoading(true);
    setMoreError("");
    get<TopicPage>(`/topics/${encodeURIComponent(key ?? "")}?page=${next}&limit=${PAGE_SIZE}`)
      .then((res) => {
        if (seq !== requestSeq.current) return;
        setItems((prev) => {
          const seen = new Set(prev.map((q) => q.id));
          return [...prev, ...res.items.filter((q) => !seen.has(q.id))];
        });
        setHasMore(res.has_more && res.items.length > 0);
        setPage(next);
      })
      .catch((e: Error) => {
        if (seq !== requestSeq.current) return;
        setMoreError(e.message || "加载更多失败");
      })
      .finally(() => {
        if (seq !== requestSeq.current) return;
        setMoreLoading(false);
      });
  }, [initialLoading, moreLoading, page, key]);

  const toggleFollow = async () => {
    if (!topic) return;
    if (!user) {
      toast("请先登录", "error");
      navigate("/login");
      return;
    }
    if (followPending) return;
    setFollowPending(true);
    const was = following;
    setFollowing(!was);
    try {
      const d = was
        ? await del<{ topic: TopicType }>(`/topics/${encodeURIComponent(key ?? "")}/follow`)
        : await post<{ topic: TopicType }>(`/topics/${encodeURIComponent(key ?? "")}/follow`, {});
      setFollowing(Boolean(d.topic.is_following));
      setTopic((t) =>
        t ? { ...t, follower_count: d.topic.follower_count ?? t.follower_count } : t
      );
      toast(d.topic.is_following ? "已关注话题" : "已取消关注");
    } catch (e) {
      setFollowing(was);
      toast((e as Error).message, "error");
    } finally {
      setFollowPending(false);
    }
  };

  const retry = () => setReloadToken((n) => n + 1);

  if (notFound) return <NotFound />;

  return (
    <>
      <section className="topic-head">
        <div className="topic-head__main">
          <div className="topic-head__info">
            {topic ? (
              <>
                <h1 className="topic-head__name">{topic.name}</h1>
                {topic.description && (
                  <p className="topic-head__desc">{topic.description}</p>
                )}
                <div className="topic-head__meta">
                  <span>{topic.follower_count ?? 0} 关注</span>
                  <span>{topic.question_count ?? 0} 讨论</span>
                </div>
              </>
            ) : (
              <span className="sk-bar" style={{ width: "40%", height: 26 }} aria-hidden="true" />
            )}
          </div>
          {topic && (
            <button
              type="button"
              className={`btn topic-head__follow${following ? " topic-head__follow--on" : ""}`}
              onClick={toggleFollow}
              disabled={followPending}
              title={following ? "取消关注" : undefined}
            >
              {following ? "已关注" : "关注"}
            </button>
          )}
        </div>
      </section>

      {initialLoading ? (
        <FeedSkeleton count={5} />
      ) : error ? (
        <NotFound kind="error" detail={error} onRetry={retry} />
      ) : items.length === 0 ? (
        <Empty
          title="还没有问题"
          hint="来提第一个问题，让这个话题开始积累讨论"
          action={
            <Link to={`/ask?topic=${topic?.id ?? ""}`} className="btn btn--primary">
              去提问
            </Link>
          }
        />
      ) : (
        <>
          <ul className="feed">
            {items.map((q) => (
              <li key={q.id} className="feed__item">
                <Link to={`/question/${q.id}`} className="feed__title">
                  {q.title}
                </Link>
                {q.detail_md && <p className="feed__excerpt">{excerpt(q.detail_md)}</p>}
                <div className="feed__meta">
                  <Link to={`/u/${q.author.id}`} className="feed__author">
                    {q.author.nickname}
                  </Link>
                  <span>{q.answer_count} 个回答</span>
                  <span>{q.view_count} 次浏览</span>
                </div>
              </li>
            ))}
          </ul>

          {moreLoading ? (
            <FeedSkeleton count={2} />
          ) : moreError ? (
            <div className="feed-foot feed-foot--error" role="alert">
              <p className="feed-foot__text">加载更多失败：{moreError}</p>
              <button type="button" className="btn btn--ghost" onClick={loadMore}>
                重试
              </button>
            </div>
          ) : hasMore ? (
            <div className="feed-foot">
              <button type="button" className="btn btn--outline" onClick={loadMore}>
                加载更多
              </button>
            </div>
          ) : (
            <p className="feed-end" role="status">
              已经到底了
            </p>
          )}
        </>
      )}

      {related.length > 0 && (
        <div className="rail-block topic-related">
          <h2 className="rail-block__title">相关话题</h2>
          <div className="topic-related__tags">
            {related.map((t) => (
              <Link key={t.id} to={topicHref(t)} className="tag">
                {t.name}
              </Link>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
