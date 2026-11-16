import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { get } from "../api";
import { useAuth } from "../auth";
import { Empty, ErrorBox } from "../components/Layout";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { FeedSkeleton } from "../components/Skeleton";
import { saveRecentSearch } from "../lib/searchHistory";
import { searchHref } from "../lib/searchHref";
import { formatTime } from "../lib/time";
import type {
  AnswerResult,
  Page,
  Question,
  SearchCounts,
  UserResult,
} from "../types";

type Tab = "following" | "recommended" | "hot";

const TABS: { key: Tab; label: string }[] = [
  { key: "following", label: "关注" },
  { key: "recommended", label: "推荐" },
  { key: "hot", label: "热榜" },
];

const PAGE_SIZE = 20;

function excerpt(md: string, n = 90) {
  const text = (md || "")
    .replace(/[#>*`\-[\]()!]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > n ? text.slice(0, n) + "…" : text;
}

// 热度展示：>=10000 记「N.N 万热度」（整数万去小数点），否则「N 热度」。
function heatLabel(score: number) {
  if (score >= 10000) {
    const w = score / 10000;
    return `${Number.isInteger(w) ? w : w.toFixed(1)} 万热度`;
  }
  return `${Math.round(score)} 热度`;
}

const feedQuery = (tab: Tab, page: number) =>
  tab === "following"
    ? `/feed/following?page=${page}&limit=${PAGE_SIZE}`
    : `/questions?tab=${tab === "hot" ? "hot" : "new"}&page=${page}&limit=${PAGE_SIZE}`;

// 搜索结果分类 scope：URL ?type= 决定，未知/缺失一律落回「问题」。
type SearchScope = "question" | "answer" | "user";

const SEARCH_TABS: { key: SearchScope; label: string }[] = [
  { key: "question", label: "问题" },
  { key: "answer", label: "回答" },
  { key: "user", label: "用户" },
];

const searchQuery = (q: string, scope: SearchScope, page: number) =>
  `/search?q=${encodeURIComponent(q)}&page=${page}&limit=${PAGE_SIZE}` +
  (scope === "question" ? "" : `&type=${scope}`);

const EMPTY_COPY: Record<Exclude<Tab, "following">, { title: string; hint: string }> = {
  recommended: {
    title: "这里还没有问题",
    hint: "第一个问题会出现在这里，也决定了这里的起点。",
  },
  hot: {
    title: "热榜上还没有问题",
    hint: "还没有人发问，暂时没有可排行的内容。",
  },
};

// 命中词高亮：标题/摘要中的关键词片段包 <mark class="hl">，大小写不敏感。
function Highlight({ text, kw }: { text: string; kw: string }) {
  if (!kw || !text) return <>{text}</>;
  const hay = text.toLowerCase();
  const needle = kw.toLowerCase();
  const parts: ReactNode[] = [];
  let i = 0;
  for (;;) {
    const j = hay.indexOf(needle, i);
    if (j === -1) {
      parts.push(text.slice(i));
      break;
    }
    if (j > i) parts.push(text.slice(i, j));
    parts.push(
      <mark key={parts.length} className="hl">
        {text.slice(j, j + kw.length)}
      </mark>
    );
    i = j + kw.length;
  }
  return <>{parts}</>;
}

function FeedCard({ q, kw }: { q: Question; kw: string }) {
  const ex = excerpt(q.detail_md);
  return (
    <li className="feed__item">
      {/* 搜索接口返回 topics；仅话题命中（matched==="topic"）时在话题名上高亮，不冒充标题命中 */}
      {q.topics?.length ? (
        <div className="feed__topics">
          {q.topics.map((t) => (
            <Link key={t.id} to={`/topic/${t.slug || t.id}`} className="tag">
              <Highlight text={t.name} kw={q.matched === "topic" ? kw : ""} />
            </Link>
          ))}
        </div>
      ) : null}
      <Link to={`/question/${q.id}`} className="feed__title">
        <Highlight text={q.title} kw={kw} />
      </Link>
      {ex ? (
        <p className="feed__excerpt">
          <Highlight text={ex} kw={kw} />
        </p>
      ) : (
        <p className="feed__excerpt feed__excerpt--empty">暂无补充说明</p>
      )}
      <div className="feed__meta">
        <Link to={`/u/${q.author?.id}`} className="feed__author">
          {q.author?.nickname}
        </Link>
        <span>{q.answer_count} 个回答</span>
        <span>{q.view_count} 次浏览</span>
      </div>
    </li>
  );
}

// 回答结果卡（type=answer）：所属问题标题链到 #answer-:id 锚点，两行命中摘要高亮。
function AnswerResultCard({ a, kw }: { a: AnswerResult; kw: string }) {
  return (
    <li className="feed__item">
      <Link
        to={`/question/${a.question_id}#answer-${a.id}`}
        className="feed__title"
      >
        {a.question_title}
      </Link>
      {a.snippet && (
        <p className="feed__excerpt">
          <Highlight text={a.snippet} kw={kw} />
        </p>
      )}
      <div className="feed__meta">
        <Link to={`/u/${a.author?.id}`} className="feed__author">
          {a.author?.nickname}
        </Link>
        <span>赞同 {a.vote_up}</span>
        <span>{formatTime(a.created_at || "")}</span>
      </div>
      {a.topics?.length ? (
        <div className="feed__topics feed__topics--tail">
          {a.topics.map((t) => (
            <Link key={t.id} to={`/topic/${t.slug || t.id}`} className="tag">
              {t.name}
            </Link>
          ))}
        </div>
      ) : null}
    </li>
  );
}

// 用户结果行（type=user）：头像 + 昵称 + 一行 bio + 回答/关注者元信息，整行可点。
function UserResultRow({ u, kw }: { u: UserResult; kw: string }) {
  return (
    <li className="feed__item urow">
      <Link to={`/u/${u.id}`} className="urow__link">
        <span className="avatar urow__avatar">
          {u.avatar_url ? (
            <img src={u.avatar_url} alt="" />
          ) : (
            u.nickname?.slice(0, 1)
          )}
        </span>
        <span className="urow__main">
          <span className="urow__name">
            <Highlight text={u.nickname || ""} kw={kw} />
          </span>
          {u.bio && (
            <span className="urow__bio">
              <Highlight text={u.bio} kw={kw} />
            </span>
          )}
          <span className="urow__meta">
            回答 {u.answer_count} · 关注者 {u.follower_count}
          </span>
        </span>
      </Link>
    </li>
  );
}

// 热榜卡：与推荐卡明确区分 —— 左侧排名色块、16px 单行标题、单行摘要、
// 元信息行带热度分；rank_delta>0 时热度旁跟上升级标记。
function HotFeedCard({ q, rank }: { q: Question; rank: number }) {
  const ex = excerpt(q.detail_md);
  const rankCls =
    rank === 1
      ? "feed__rank feed__rank--top1"
      : rank <= 3
        ? "feed__rank feed__rank--top23"
        : rank <= 10
          ? "feed__rank feed__rank--top10"
          : "feed__rank";
  return (
    <li className="feed__item">
      {q.topics?.length ? (
        <div className="feed__topics">
          {q.topics.map((t) => (
            <Link key={t.id} to={`/topic/${t.slug || t.id}`} className="tag">
              {t.name}
            </Link>
          ))}
        </div>
      ) : null}
      <div className="feed__hotline">
        <span className={rankCls} aria-label={`热榜第 ${rank} 名`}>
          {rank}
        </span>
        <div className="feed__hotmain">
          <Link
            to={`/question/${q.id}`}
            className="feed__title feed__title--hot"
          >
            {q.title}
          </Link>
          {ex ? (
            <p className="feed__excerpt feed__excerpt--hot">
              {ex}
            </p>
          ) : (
            <p className="feed__excerpt feed__excerpt--hot feed__excerpt--empty">
              暂无补充说明
            </p>
          )}
          <div className="feed__meta">
            <Link to={`/u/${q.author?.id}`} className="feed__author">
              {q.author?.nickname}
            </Link>
            {typeof q.hot_score === "number" && (
              <span className="feed__heat">
                {heatLabel(q.hot_score)}
                {q.rank_delta !== undefined && q.rank_delta > 0 && (
                  <span className="feed__rise" title="排名上升">
                    ↑{q.rank_delta}
                  </span>
                )}
              </span>
            )}
            <span>{q.answer_count} 个回答</span>
            <span>{q.view_count} 次浏览</span>
          </div>
        </div>
      </div>
    </li>
  );
}

function FeedFoot({
  hasMore,
  moreLoading,
  moreError,
  onLoadMore,
}: {
  hasMore: boolean;
  moreLoading: boolean;
  moreError: string;
  onLoadMore: () => void;
}) {
  if (moreLoading) return <FeedSkeleton count={2} />;
  if (moreError) {
    return (
      <div className="feed-foot feed-foot--error" role="alert">
        <p className="feed-foot__text">加载更多失败：{moreError}</p>
        <button type="button" className="btn btn--ghost" onClick={onLoadMore}>
          重试
        </button>
      </div>
    );
  }
  if (hasMore) {
    return (
      <div className="feed-foot">
        <button type="button" className="btn btn--outline" onClick={onLoadMore}>
          加载更多
        </button>
      </div>
    );
  }
  return (
    <p className="feed-end" role="status">
      已经到底了
    </p>
  );
}

// Z1044 — 搜索分类 tab：scope 由 URL ?type= 决定（question/answer/user），
// 三个 tab 共用同一份 counts；切 tab 走 navigate 写 URL，刷新/分享/后退都有效。
function SearchResults({ q }: { q: string }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const typeParam = params.get("type");
  const scope: SearchScope = SEARCH_TABS.some((t) => t.key === typeParam)
    ? (typeParam as SearchScope)
    : "question";

  // Z1041 — 结果页内嵌可编辑搜索框（桌面+移动同一份 DOM）：预填当前 q，改词原地续搜。
  const [qInput, setQInput] = useState(q);
  const inlineSearchRef = useRef<HTMLInputElement>(null);

  const [items, setItems] = useState<(Question | AnswerResult | UserResult)[]>([]);
  // items 属于哪个 scope：切 tab 后 URL/scope 先变，items 还是旧 scope 的对象，
  // 必须等本次请求回来（items 与 itemsScope 同批更新）才允许渲染列表，
  // 否则新 scope 的行组件拿旧 shape 渲染会抛 undefined.slice → 整树卸载白屏。
  const [itemsScope, setItemsScope] = useState<SearchScope | null>(null);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<SearchCounts | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [initialLoading, setInitialLoading] = useState(true);
  const [moreLoading, setMoreLoading] = useState(false);
  const [error, setError] = useState("");
  const [moreError, setMoreError] = useState("");
  const [reason, setReason] = useState("");
  const [reloadToken, setReloadToken] = useState(0);

  const requestSeq = useRef(0);

  useEffect(() => {
    const seq = ++requestSeq.current;
    setInitialLoading(true);
    setError("");
    setMoreError("");
    setMoreLoading(false);
    setItems([]);
    setItemsScope(null);
    setTotal(0);
    setHasMore(false);
    setReason("");
    setPage(1);
    setQInput(q);
    get<
      Page<Question | AnswerResult | UserResult> & {
        reason?: string;
        counts?: SearchCounts;
      }
    >(searchQuery(q, scope, 1))
      .then((res) => {
        if (seq !== requestSeq.current) return;
        setItems(res.items);
        setItemsScope(scope);
        setTotal(res.total);
        setCounts(res.counts || null);
        setReason(res.reason || "");
        setHasMore(res.has_more && res.items.length > 0);
      })
      .catch((e: Error) => {
        if (seq !== requestSeq.current) return;
        setError(e.message || "搜索失败");
      })
      .finally(() => {
        if (seq !== requestSeq.current) return;
        setInitialLoading(false);
      });
  }, [q, scope, reloadToken]);

  const loadMore = useCallback(() => {
    if (moreLoading || initialLoading) return;
    const seq = requestSeq.current;
    const next = page + 1;
    setMoreLoading(true);
    setMoreError("");
    get<Page<Question | AnswerResult | UserResult>>(searchQuery(q, scope, next))
      .then((res) => {
        if (seq !== requestSeq.current) return;
        setItems((prev) => {
          const seen = new Set(prev.map((x) => x.id));
          return [...prev, ...res.items.filter((x) => !seen.has(x.id))];
        });
        setTotal(res.total);
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
  }, [initialLoading, moreLoading, page, q, scope]);

  // Z1041 — 退出搜索仍回首页，但落地焦点交给顶栏搜索框（TopNav 读 state.focusSearch）。
  const exitSearch = () => navigate("/", { state: { focusSearch: true } });
  // Z1041 — 「换个关键词」不再跳首页：原地聚焦并全选内嵌输入框，URL 与关键词都保留。
  const refocusInline = () => {
    const el = inlineSearchRef.current;
    if (!el) return;
    el.focus();
    el.select();
  };
  const retry = () => setReloadToken((n) => n + 1);
  // 切 tab：写 URL ?type=（问题 tab 不带参数），分页自然回到第 1 页。
  const setScope = (t: SearchScope) =>
    navigate(`${searchHref(q)}${t === "question" ? "" : `&type=${t}`}`);
  const submitMobile = (e: React.FormEvent) => {
    e.preventDefault();
    const t = qInput.trim();
    if (!t) return;
    saveRecentSearch(t);
    // 换词保留当前分类 tab（question 不带 type 参数）。
    navigate(`${searchHref(t)}${scope === "question" ? "" : `&type=${scope}`}`);
  };

  return (
    <>
      <form className="msearchbar" role="search" onSubmit={submitMobile}>
        <input
          ref={inlineSearchRef}
          type="search"
          className="field msearchbar__input"
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          aria-label="在结果中搜索"
          placeholder="在结果中搜索"
        />
        <button type="submit" className="btn msearchbar__go" disabled={!qInput.trim()}>
          搜索
        </button>
      </form>
      <section className="search-head" aria-label="搜索结果">
        <h1 className="search-head__title">
          <span className="search-head__q">“{q}”</span>
          {" 的相关结果"}
          {!initialLoading && !error && (
            <span className="search-head__total"> · {total} 条</span>
          )}
        </h1>
        <button
          type="button"
          className="btn btn--ghost search-head__exit"
          onClick={exitSearch}
        >
          取消搜索
        </button>
      </section>

      <div className="stabs" role="tablist" aria-label="搜索结果分类">
        {SEARCH_TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={scope === t.key}
            className={`stabs__tab ${scope === t.key ? "stabs__tab--active" : ""}`}
            onClick={() => setScope(t.key)}
          >
            {t.label} {counts ? counts[t.key] : total}
          </button>
        ))}
      </div>

      {initialLoading ? (
        <FeedSkeleton count={5} />
      ) : error ? (
        <ErrorBox message={error} onRetry={retry} />
      ) : itemsScope !== scope ? (
        // scope 已切、本 scope 数据未回：骨架过渡，绝不拿旧 scope 数据配新渲染器。
        <FeedSkeleton count={5} />
      ) : items.length === 0 ? (
        reason === "too_short" ? (
          <Empty
            title="请至少输入 2 个字符的关键词（如：代码、职场）"
            action={
              <button
                type="button"
                className="btn btn--ghost"
                onClick={refocusInline}
              >
                换个关键词
              </button>
            }
          />
        ) : scope === "answer" ? (
          <Empty
            title="没有找到包含该关键词的回答"
            action={
              <Link to="/ask" className="btn btn--outline">
                去提问
              </Link>
            }
          />
        ) : scope === "user" ? (
          <Empty
            title="没有找到匹配的用户"
            action={
              <Link to="/" className="btn btn--outline">
                去首页
              </Link>
            }
          />
        ) : (
        <Empty
          title={`没有找到与“${q}”相关的内容`}
          hint="换个关键词试试，或直接向大家提问"
          action={
            <div className="empty__actions">
              <button type="button" className="btn btn--ghost" onClick={refocusInline}>
                换个关键词
              </button>
              <Link to="/ask" className="btn btn--outline">
                去提问
              </Link>
            </div>
          }
        />
        )
      ) : (
        <>
          <ul className="feed">
            {scope === "answer"
              ? (items as AnswerResult[]).map((a) => (
                  <AnswerResultCard key={a.id} a={a} kw={q} />
                ))
              : scope === "user"
                ? (items as UserResult[]).map((u) => (
                    <UserResultRow key={u.id} u={u} kw={q} />
                  ))
                : (items as Question[]).map((item) => (
                    <FeedCard key={item.id} q={item} kw={q} />
                  ))}
          </ul>
          <FeedFoot
            hasMore={hasMore}
            moreLoading={moreLoading}
            moreError={moreError}
            onLoadMore={loadMore}
          />
        </>
      )}
    </>
  );
}

function Feed() {
  const { user, loading: authLoading } = useAuth();
  const [params, setParams] = useSearchParams();
  // 未识别（含缺失）的 tab 参数一律落回推荐，保证 aria-selected 永远唯一。
  const tabParam = params.get("tab");
  const tab: Tab = TABS.some((t) => t.key === tabParam)
    ? (tabParam as Tab)
    : "recommended";

  const [items, setItems] = useState<Question[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [initialLoading, setInitialLoading] = useState(true);
  const [moreLoading, setMoreLoading] = useState(false);
  const [error, setError] = useState("");
  const [moreError, setMoreError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);

  // 切 tab 时递增，旧请求返回后直接丢弃，避免串数据。
  const requestSeq = useRef(0);

  useEffect(() => {
    // 登录态未就绪先不发请求，避免已登录用户闪「去登录」空态。
    if (tab === "following" && authLoading) return;
    const seq = ++requestSeq.current;
    setInitialLoading(true);
    setError("");
    setMoreError("");
    setMoreLoading(false);
    setItems([]);
    setHasMore(false);
    setPage(1);
    // 关注流需登录：未登录直接渲染空态，不发请求。
    if (tab === "following" && !user) {
      setInitialLoading(false);
      return;
    }
    get<Page<Question>>(feedQuery(tab, 1))
      .then((res) => {
        if (seq !== requestSeq.current) return;
        setItems(res.items);
        setHasMore(res.has_more && res.items.length > 0);
      })
      .catch((e: Error) => {
        if (seq !== requestSeq.current) return;
        setError(e.message || "问题列表加载失败");
      })
      .finally(() => {
        if (seq !== requestSeq.current) return;
        setInitialLoading(false);
      });
  }, [tab, user, authLoading, reloadToken]);

  const loadMore = useCallback(() => {
    if (moreLoading || initialLoading) return;
    const seq = requestSeq.current;
    const next = page + 1;
    setMoreLoading(true);
    setMoreError("");
    get<Page<Question>>(feedQuery(tab, next))
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
  }, [initialLoading, moreLoading, page, tab]);

  const setTab = (t: Tab) => setParams(t === "recommended" ? {} : { tab: t });

  const retry = () => setReloadToken((n) => n + 1);

  return (
    <>
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            aria-current={tab === t.key ? "page" : undefined}
            className={`tabs__tab ${tab === t.key ? "tabs__tab--active" : ""}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "following" && !user ? (
        authLoading ? (
          <FeedSkeleton count={5} />
        ) : (
          <Empty
            title="登录后查看你关注的内容"
            hint="登录后可关注话题、问题与作者，他们的新动态会出现在这里"
            action={
              <div className="empty__actions">
                <Link to="/login" className="btn btn--outline">
                  去登录
                </Link>
                <Link to="/" className="btn btn--ghost">
                  先看看推荐
                </Link>
              </div>
            }
          />
        )
      ) : initialLoading ? (
        <FeedSkeleton count={5} />
      ) : error ? (
        <ErrorBox message={error} onRetry={retry} />
      ) : items.length === 0 ? (
        <Empty
          {...(tab === "following"
            ? {
                title: "你还没有关注任何内容",
                hint: "关注话题、问题或作者后，他们的新动态会出现在这里",
              }
            : EMPTY_COPY[tab === "hot" ? "hot" : "recommended"])}
          action={
            tab === "following" ? (
              <div className="empty__actions">
                <Link to="/topics" className="btn btn--outline">
                  去关注话题
                </Link>
                <Link to="/" className="btn btn--ghost">
                  逛逛推荐问题
                </Link>
              </div>
            ) : (
              <Link to="/ask" className="btn btn--outline">
                去提问
              </Link>
            )
          }
        />
      ) : (
        <>
          <ul className="feed">
            {items.map((q, i) =>
              tab === "hot" ? (
                <HotFeedCard key={q.id} q={q} rank={i + 1} />
              ) : (
                <FeedCard key={q.id} q={q} kw="" />
              )
            )}
          </ul>
          <FeedFoot
            hasMore={hasMore}
            moreLoading={moreLoading}
            moreError={moreError}
            onLoadMore={loadMore}
          />
        </>
      )}
    </>
  );
}

export function Home() {
  const [params] = useSearchParams();
  const q = (params.get("q") || "").trim();
  // 搜索结果区整体套错误边界：任何行组件渲染异常 → 错误卡 + 重试，不整站白屏。
  if (q)
    return (
      <ErrorBoundary>
        <SearchResults q={q} />
      </ErrorBoundary>
    );
  return <Feed />;
}
