import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { get } from "../api";
import { Empty, ErrorBox } from "../components/Layout";
import { FeedSkeleton } from "../components/Skeleton";
import type { Page, Question } from "../types";

const PAGE_SIZE = 20;

function excerpt(md: string, n = 90) {
  const text = md.replace(/[#>*`\-[\]()!]/g, "").replace(/\s+/g, " ").trim();
  return text.length > n ? text.slice(0, n) + "…" : text;
}

export function Unanswered() {
  const [items, setItems] = useState<Question[]>([]);
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
    setHasMore(false);
    setPage(1);
    get<Page<Question>>(`/questions?tab=unanswered&page=1&limit=${PAGE_SIZE}`)
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
  }, [reloadToken]);

  const loadMore = useCallback(() => {
    if (moreLoading || initialLoading) return;
    const seq = requestSeq.current;
    const next = page + 1;
    setMoreLoading(true);
    setMoreError("");
    get<Page<Question>>(`/questions?tab=unanswered&page=${next}&limit=${PAGE_SIZE}`)
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
  }, [initialLoading, moreLoading, page]);

  const retry = () => setReloadToken((n) => n + 1);

  return (
    <>
      <section className="page-head">
        <h1 className="page-head__title">等你来答</h1>
        <p className="page-head__desc">
          这些问题还没有回答，你的回答可能就是题主正在等的那个。
        </p>
      </section>

      {initialLoading ? (
        <FeedSkeleton count={5} />
      ) : error ? (
        <ErrorBox message={error} onRetry={retry} />
      ) : items.length === 0 ? (
        <Empty
          title="现在没有等待回答的问题"
          hint="每个问题都已有回答，不如由你来提一个新问题"
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
                {q.detail_md && (
                  <p className="feed__excerpt">{excerpt(q.detail_md)}</p>
                )}
                <div className="feed__meta">
                  <Link to={`/u/${q.author.id}`} className="feed__author">
                    {q.author.nickname}
                  </Link>
                  <span>{q.answer_count} 个回答</span>
                  <span>{q.view_count} 次浏览</span>
                  <Link to={`/question/${q.id}`} className="feed__author">
                    写回答
                  </Link>
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
