import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { get } from "../api";
import { Empty, ErrorBox } from "../components/Layout";
import { FeedSkeleton } from "../components/Skeleton";
import type { Page, Topic } from "../types";

const PAGE_SIZE = 20;

export function Topics() {
  const [items, setItems] = useState<Topic[]>([]);
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
    get<Page<Topic>>(`/topics?sort=followers&page=1&limit=${PAGE_SIZE}`)
      .then((res) => {
        if (seq !== requestSeq.current) return;
        setItems(res.items);
        setHasMore(res.has_more && res.items.length > 0);
      })
      .catch((e: Error) => {
        if (seq !== requestSeq.current) return;
        setError(e.message || "话题列表加载失败");
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
    get<Page<Topic>>(`/topics?sort=followers&page=${next}&limit=${PAGE_SIZE}`)
      .then((res) => {
        if (seq !== requestSeq.current) return;
        setItems((prev) => {
          const seen = new Set(prev.map((t) => t.id));
          return [...prev, ...res.items.filter((t) => !seen.has(t.id))];
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
        <h1 className="page-head__title">话题广场</h1>
        <p className="page-head__desc">
          逛逛大家正在讨论的话题，进入话题看全部问题。
        </p>
      </section>

      {initialLoading ? (
        <FeedSkeleton count={5} />
      ) : error ? (
        <ErrorBox message={error} onRetry={retry} />
      ) : items.length === 0 ? (
        <Empty
          title="还没有话题"
          hint="提问时可以为问题关联话题，它们会出现在这里"
          action={
            <Link to="/ask" className="btn btn--outline">
              去提问
            </Link>
          }
        />
      ) : (
        <>
          <ul className="feed">
            {items.map((t) => (
              <li key={t.id} className="feed__item topic-item">
                <Link to={`/topic/${t.slug || t.id}`} className="topic-item__name">
                  {t.name}
                </Link>
                {t.description && (
                  <p className="topic-item__desc">{t.description}</p>
                )}
                <div className="feed__meta">
                  <span>{t.question_count ?? 0} 讨论</span>
                  <span>{t.follower_count ?? 0} 关注</span>
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
