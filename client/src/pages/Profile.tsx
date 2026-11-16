import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { followUser, get, unfollowUser } from "../api";
import { useAuth } from "../auth";
import { useToast } from "../toast";
import { Card } from "../components/ui";
import { Empty, ErrorBox, Spinner } from "../components/Layout";
import type { Answer, Page, ProfileData, Question } from "../types";
import { formatTime } from "../lib/time";

type TabKey = "answers" | "questions";

const TABS: { key: TabKey; label: string }[] = [
  { key: "answers", label: "回答" },
  { key: "questions", label: "提问" },
];

const PAGE_SIZE = 10;

function excerpt(md: string, n = 90) {
  const text = md.replace(/[#>*`\-[\]()!]/g, "").replace(/\s+/g, " ").trim();
  return text.length > n ? text.slice(0, n) + "…" : text;
}

// 个人页内容列表：首屏一页 + 「加载更多」，与 stats 数字同口径互证。
function useAuthorList<T extends { id: number }>(endpoint: string) {
  const [items, setItems] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [moreLoading, setMoreLoading] = useState(false);
  const [error, setError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const seq = useRef(0);

  useEffect(() => {
    const s = ++seq.current;
    setLoading(true);
    setError("");
    setItems([]);
    setTotal(0);
    setHasMore(false);
    setPage(1);
    get<Page<T>>(`${endpoint}&page=1&limit=${PAGE_SIZE}`)
      .then((res) => {
        if (s !== seq.current) return;
        setItems(res.items);
        setTotal(res.total);
        setHasMore(res.has_more && res.items.length > 0);
      })
      .catch((e: Error) => {
        if (s === seq.current) setError(e.message || "加载失败");
      })
      .finally(() => {
        if (s === seq.current) setLoading(false);
      });
  }, [endpoint, reloadToken]);

  const loadMore = useCallback(() => {
    if (moreLoading || loading) return;
    const s = seq.current;
    const next = page + 1;
    setMoreLoading(true);
    setError("");
    get<Page<T>>(`${endpoint}&page=${next}&limit=${PAGE_SIZE}`)
      .then((res) => {
        if (s !== seq.current) return;
        setItems((prev) => {
          const seen = new Set(prev.map((x) => x.id));
          return [...prev, ...res.items.filter((x) => !seen.has(x.id))];
        });
        setTotal(res.total);
        setHasMore(res.has_more && res.items.length > 0);
        setPage(next);
      })
      .catch((e: Error) => {
        if (s === seq.current) setError(e.message || "加载更多失败");
      })
      .finally(() => {
        if (s === seq.current) setMoreLoading(false);
      });
  }, [endpoint, loading, moreLoading, page]);

  const retry = useCallback(() => setReloadToken((n) => n + 1), []);

  return { items, total, hasMore, loading, moreLoading, error, loadMore, retry };
}

function AnswerItem({ a }: { a: Answer }) {
  return (
    <li className="plist__item">
      <Link to={`/question/${a.question_id}`} className="plist__link">
        <span className="feed__title">{a.question_title}</span>
        <p className="feed__excerpt">{excerpt(a.content_md)}</p>
        <span className="feed__meta">
          <span>{a.vote_up} 赞同</span>
          <span>{a.comment_count} 条评论</span>
          <span>{formatTime(a.created_at)}</span>
        </span>
      </Link>
    </li>
  );
}

function QuestionItem({ q }: { q: Question }) {
  return (
    <li className="plist__item">
      <Link to={`/question/${q.id}`} className="plist__link">
        <span className="feed__title">{q.title}</span>
        {q.detail_md && <p className="feed__excerpt">{excerpt(q.detail_md)}</p>}
        <span className="feed__meta">
          <span className="feed__author">{q.author.nickname}</span>
          <span>{q.answer_count} 个回答</span>
          <span>{q.view_count} 次浏览</span>
        </span>
      </Link>
    </li>
  );
}

function ProfileAnswers({ userId, isMe }: { userId: number; isMe: boolean }) {
  const list = useAuthorList<Answer>(`/answers?author=${userId}`);
  if (list.loading) return <Spinner />;
  if (list.error && list.items.length === 0)
    return <ErrorBox message={list.error} onRetry={list.retry} />;
  if (list.items.length === 0)
    return isMe ? (
      <Empty
        title="还没有回答"
        hint="挑一个你感兴趣的问题，写下第一条回答。"
        action={
          <div className="empty__actions">
            <Link to="/unanswered" className="btn btn--primary">
              写回答
            </Link>
            <Link to="/ask" className="btn btn--outline">
              去提问
            </Link>
          </div>
        }
      />
    ) : (
      <Empty
        title="还没有回答"
        hint="TA 还没有写过回答，先去别处逛逛。"
        action={
          <div className="empty__actions">
            <Link to="?tab=questions" className="btn btn--primary">
              浏览 TA 的提问
            </Link>
            <Link to="/" className="btn btn--outline">
              去逛逛推荐
            </Link>
          </div>
        }
      />
    );
  return (
    <>
      <ul className="plist">
        {list.items.map((a) => (
          <AnswerItem key={a.id} a={a} />
        ))}
      </ul>
      <ListFoot {...list} />
    </>
  );
}

function ProfileQuestions({ userId, isMe }: { userId: number; isMe: boolean }) {
  const list = useAuthorList<Question>(`/questions?author=${userId}`);
  if (list.loading) return <Spinner />;
  if (list.error && list.items.length === 0)
    return <ErrorBox message={list.error} onRetry={list.retry} />;
  if (list.items.length === 0)
    return isMe ? (
      <Empty
        title="还没有提问"
        hint="好奇什么就问出来，第一条提问只需要一句话。"
        action={
          <div className="empty__actions">
            <Link to="/ask" className="btn btn--primary">
              去提问
            </Link>
            <Link to="/unanswered" className="btn btn--outline">
              写回答
            </Link>
          </div>
        }
      />
    ) : (
      <Empty
        title="还没有提问"
        hint="TA 还没有提过问题，先去别处逛逛。"
        action={
          <div className="empty__actions">
            <Link to="?tab=answers" className="btn btn--primary">
              看看 TA 的回答
            </Link>
            <Link to="/" className="btn btn--outline">
              去逛逛推荐
            </Link>
          </div>
        }
      />
    );
  return (
    <>
      <ul className="plist">
        {list.items.map((q) => (
          <QuestionItem key={q.id} q={q} />
        ))}
      </ul>
      <ListFoot {...list} />
    </>
  );
}

function ListFoot({
  hasMore,
  moreLoading,
  error,
  loadMore,
}: {
  hasMore: boolean;
  moreLoading: boolean;
  error: string;
  loadMore: () => void;
}) {
  if (moreLoading) return <Spinner />;
  if (error) {
    return (
      <div className="plist__foot plist__foot--error" role="alert">
        <span>{error}</span>
        <button type="button" className="btn btn--ghost" onClick={loadMore}>
          重试
        </button>
      </div>
    );
  }
  if (hasMore) {
    return (
      <div className="plist__foot">
        <button type="button" className="btn btn--outline" onClick={loadMore}>
          加载更多
        </button>
      </div>
    );
  }
  return <p className="plist__end">已经到底了</p>;
}

export function Profile() {
  const { id } = useParams<{ id: string }>();
  const { user: me, loading: authLoading } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [data, setData] = useState<ProfileData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: TabKey =
    searchParams.get("tab") === "questions" ? "questions" : "answers";
  const [colCount, setColCount] = useState<number | null>(null);
  const [following, setFollowing] = useState(false);
  const [followPending, setFollowPending] = useState(false);
  const profileSeq = useRef(0);

  // 初始关注态由 /users/:id 的 is_following 一次带回（仅登录请求返回该字段）。
  // seq 守卫：切用户时在途响应直接丢弃，不落到新主页。
  useEffect(() => {
    const seq = ++profileSeq.current;
    setLoading(true);
    setError("");
    setFollowing(false);
    get<ProfileData>(`/users/${id}`)
      .then((res) => {
        if (seq !== profileSeq.current) return;
        setData(res);
        setFollowing(Boolean(res.is_following));
      })
      .catch((e) => {
        if (seq === profileSeq.current) setError(e.message);
      })
      .finally(() => {
        if (seq === profileSeq.current) setLoading(false);
      });
  }, [id]);

  // tab 以 URL 为唯一真源：tab 按钮与空态 CTA 都只写 ?tab=，展示由此派生，
  // 避免「URL 已是目标值 → 点击无效」的同 URL 死链。
  const isMe = Boolean(me && data && me.id === data.user.id);

  const toggleFollow = async () => {
    if (!data || followPending) return;
    if (!me) {
      navigate(`/login?next=${encodeURIComponent(`/u/${id ?? data.user.id}`)}`);
      return;
    }
    if (me.id === data.user.id) return;
    const seq = profileSeq.current; // 切用户后 seq 变化 → 丢弃本请求的过期结果
    setFollowPending(true);
    const was = following;
    setFollowing(!was);
    setData((d) =>
      d
        ? {
            ...d,
            stats: {
              ...d.stats,
              followers: Math.max(0, d.stats.followers + (was ? -1 : 1)),
            },
          }
        : d
    );
    try {
      const r = was
        ? await unfollowUser(data.user.id)
        : await followUser(data.user.id);
      if (seq === profileSeq.current) {
        setFollowing(r.following);
        setData((d) =>
          d ? { ...d, stats: { ...d.stats, followers: r.follower_count } } : d
        );
        toast(r.following ? "已关注" : "已取消关注");
      }
    } catch (e) {
      if (seq === profileSeq.current) {
        setFollowing(was);
        setData((d) =>
          d
            ? {
                ...d,
                stats: {
                  ...d.stats,
                  followers: Math.max(0, d.stats.followers + (was ? 1 : -1)),
                },
              }
            : d
        );
        toast((e as Error).message, "error");
      }
    } finally {
      setFollowPending(false);
    }
  };

  useEffect(() => {
    if (!isMe) return;
    get<{ collections: { id: number }[] }>("/collections")
      .then((d) => setColCount(d.collections.length))
      .catch(() => setColCount(null));
  }, [isMe]);

  if (loading) return <Spinner />;
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Empty title="用户不存在" />;

  const { user, stats, badges = [] } = data;
  const counts: Record<TabKey, number> = {
    answers: stats.answers,
    questions: stats.questions,
  };
  return (
    <>
      <Card className="profile">
        <div className="profile__head">
          <span className="avatar avatar--lg">
            {user.avatar_url ? <img src={user.avatar_url} alt="" /> : user.nickname.slice(0, 1)}
          </span>
          <div className="profile__info">
            <h1 className="profile__name">{user.nickname}</h1>
            <p className="profile__bio">{user.bio || "这个人还没有写简介。"}</p>
            <p className="profile__joined">
              {formatTime(user.created_at)} 加入
            </p>
            {badges.length > 0 && (
              <ul className="medals" aria-label="勋章">
                {badges.map((b) => (
                  <li key={b.code} className="medals__pill" title={b.description}>
                    <span
                      className="medals__icon"
                      aria-hidden="true"
                      dangerouslySetInnerHTML={{ __html: b.icon_svg }}
                    />
                    <span className="medals__name">{b.name}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {!authLoading && !isMe && (
            <button
              type="button"
              className={`btn profile__follow${following ? " profile__follow--on" : ""}`}
              onClick={toggleFollow}
              disabled={followPending}
              aria-pressed={following}
              title={following ? "取消关注" : undefined}
            >
              {following ? "已关注" : "关注"}
            </button>
          )}
        </div>
        <dl className="profile__stats">
          <div>
            <dt>回答</dt>
            <dd>{stats.answers}</dd>
          </div>
          <div>
            <dt>提问</dt>
            <dd>{stats.questions}</dd>
          </div>
          <div>
            <dt>获赞</dt>
            <dd>{stats.vote_up}</dd>
          </div>
          <div>
            <dt>关注</dt>
            <dd>{stats.following}</dd>
          </div>
          <div>
            <dt>粉丝</dt>
            <dd>{stats.followers}</dd>
          </div>
        </dl>
      </Card>

      <Card className="profile__content">
        <div className="tabs profile__tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              className={`tabs__tab ${tab === t.key ? "tabs__tab--active" : ""}`}
              onClick={() => setSearchParams({ tab: t.key })}
            >
              {t.label} {counts[t.key]}
            </button>
          ))}
          {isMe && (
            <Link to="/collections" className="tabs__tab">
              收藏{colCount !== null ? ` ${colCount}` : ""}
            </Link>
          )}
        </div>
        {tab === "answers" ? (
          <ProfileAnswers userId={user.id} isMe={isMe} />
        ) : (
          <ProfileQuestions userId={user.id} isMe={isMe} />
        )}
      </Card>
    </>
  );
}
