import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
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

const feedQuery = (tab: Tab, page: number) =>
  `/questions?tab=${tab === "hot" ? "hot" : "new"}&page=${page}&limit=${PAGE_SIZE}`;

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

export function Home() {
  const { user } = useAuth();
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
    if (tab === "following") {
      setInitialLoading(false);
      return;
    }
    const seq = ++requestSeq.current;
    setInitialLoading(true);
    setError("");
    setMoreError("");
    setMoreLoading(false);
    setItems([]);
    setHasMore(false);
    setPage(1);
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
  }, [tab, reloadToken]);

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

      {tab === "following" ? (
        <Empty
          title={user ? "你关注的内容会出现在这里" : "登录后查看你关注的内容"}
          hint={user ? "去推荐页找些感兴趣的问题吧" : "登录后可关注用户、话题与问题"}
          action={
            user ? (
              <Link to="/" className="btn btn--outline">
                去看推荐
              </Link>
            ) : (
              <Link to="/login" className="btn btn--outline">
                去登录
              </Link>
            )
          }
        />
      ) : initialLoading ? (
        <FeedSkeleton count={5} />
      ) : error ? (
        <ErrorBox message={error} onRetry={retry} />
      ) : items.length === 0 ? (
        <Empty
          {...EMPTY_COPY[tab === "hot" ? "hot" : "recommended"]}
          action={
            <Link to="/ask" className="btn btn--outline">
              去提问
            </Link>
          }
        />
      ) : (
        <>
          <ul className="feed">
            {items.map((q) => (
              <li key={q.id} className="feed__item">
                {/* 列表接口暂不返回 topics（questionRow 恒为 []），保留条件渲染，后端补字段后自动生效 */}
                {q.topics?.length ? (
                  <div className="feed__topics">
                    {q.topics.map((t) => (
                      <Link key={t.id} to={`/topic/${t.slug || t.id}`} className="tag">
                        {t.name}
                      </Link>
                    ))}
                  </div>
                ) : null}
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
    </>
  );
}
