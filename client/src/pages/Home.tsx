import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { get } from "../api";
import { useAuth } from "../auth";
import { Empty, ErrorBox } from "../components/Layout";
import { FeedSkeleton } from "../components/Skeleton";
import type { Page, Question } from "../types";

type Tab = "following" | "recommended" | "hot";

const TABS: { key: Tab; label: string }[] = [
  { key: "following", label: "关注" },
  { key: "recommended", label: "推荐" },
  { key: "hot", label: "热榜" },
];

const PAGE_SIZE = 20;

function excerpt(md: string, n = 90) {
  const text = md.replace(/[#>*`\-[\]()!]/g, "").replace(/\s+/g, " ").trim();
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

const searchQuery = (q: string, page: number) =>
  `/search?q=${encodeURIComponent(q)}&page=${page}&limit=${PAGE_SIZE}`;

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
  if (!kw) return <>{text}</>;
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
      {q.detail_md && (
        <p className="feed__excerpt">
          <Highlight text={excerpt(q.detail_md)} kw={kw} />
        </p>
      )}
      <div className="feed__meta">
        <Link to={`/u/${q.author.id}`} className="feed__author">
          {q.author.nickname}
        </Link>
        <span>{q.answer_count} 个回答</span>
        <span>{q.view_count} 次浏览</span>
      </div>
    </li>
  );
}

// 热榜卡：与推荐卡明确区分 —— 左侧排名色块、16px 单行标题、单行摘要、
// 元信息行带热度分；rank_delta>0 时热度旁跟上升级标记。
function HotFeedCard({ q, rank }: { q: Question; rank: number }) {
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
          {q.detail_md && (
            <p className="feed__excerpt feed__excerpt--hot">
              {excerpt(q.detail_md)}
            </p>
          )}
          <div className="feed__meta">
            <Link to={`/u/${q.author.id}`} className="feed__author">
              {q.author.nickname}
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

function SearchResults({ q }: { q: string }) {
  const navigate = useNavigate();

  const [items, setItems] = useState<Question[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [initialLoading, setInitialLoading] = useState(true);
  const [moreLoading, setMoreLoading] = useState(false);
  const [error, setError] = useState("");
  const [moreError, setMoreError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);

  const requestSeq = useRef(0);

  useEffect(() => {
    const seq = ++requestSeq.current;
    setInitialLoading(true);
    setError("");
    setMoreError("");
    setMoreLoading(false);
    setItems([]);
    setTotal(0);
    setHasMore(false);
    setPage(1);
    get<Page<Question>>(searchQuery(q, 1))
      .then((res) => {
        if (seq !== requestSeq.current) return;
        setItems(res.items);
        setTotal(res.total);
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
  }, [q, reloadToken]);

  const loadMore = useCallback(() => {
    if (moreLoading || initialLoading) return;
    const seq = requestSeq.current;
    const next = page + 1;
    setMoreLoading(true);
    setMoreError("");
    get<Page<Question>>(searchQuery(q, next))
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
  }, [initialLoading, moreLoading, page, q]);

  const exitSearch = () => navigate("/");
  const retry = () => setReloadToken((n) => n + 1);

  return (
    <>
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

      {/* TODO: type=answer|user|topic 分类 tab；本期只渲染「问题」结果 */}
      {initialLoading ? (
        <FeedSkeleton count={5} />
      ) : error ? (
        <ErrorBox message={error} onRetry={retry} />
      ) : items.length === 0 ? (
        <Empty
          title={`没有找到与“${q}”相关的内容`}
          hint="换个关键词试试，或直接向大家提问"
          action={
            <div className="empty__actions">
              <button type="button" className="btn btn--ghost" onClick={exitSearch}>
                换个关键词
              </button>
              <Link to="/ask" className="btn btn--outline">
                去提问
              </Link>
            </div>
          }
        />
      ) : (
        <>
          <ul className="feed">
            {items.map((item) => (
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
  const tab = (params.get("tab") as Tab) || "recommended";

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
            hint="登录后可关注用户、话题与问题"
            action={
              <Link to="/login" className="btn btn--outline">
                去登录
              </Link>
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
                title: "你关注的内容会出现在这里",
                hint: "去推荐页关注感兴趣的问题",
              }
            : EMPTY_COPY[tab === "hot" ? "hot" : "recommended"])}
          action={
            tab === "following" ? (
              <Link to="/" className="btn btn--outline">
                去看推荐
              </Link>
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
  if (q) return <SearchResults q={q} />;
  return <Feed />;
}
