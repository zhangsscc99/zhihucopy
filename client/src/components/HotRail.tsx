import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { get } from "../api";
import { RailSkeleton } from "./Skeleton";
import type { Page, Question } from "../types";

export function HotRail() {
  const [items, setItems] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    get<Page<Question>>("/questions?tab=hot&limit=10")
      .then((p) => setItems(p.items))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="rail-block">
      <h2 className="rail-block__title">热榜</h2>
      {loading ? (
        <RailSkeleton rows={8} />
      ) : items.length === 0 ? (
        <p className="rail-block__empty">还没有内容，来提第一个问题吧。</p>
      ) : (
        <>
          <ol className="hotlist">
            {items.map((q, i) => (
              <li key={q.id} className="hotlist__item">
                <span
                  className={`hotlist__rank ${
                    i === 0
                      ? "hotlist__rank--top1"
                      : i < 3
                        ? "hotlist__rank--top23"
                        : ""
                  }`}
                >
                  {i + 1}
                </span>
                <Link to={`/question/${q.id}`} className="hotlist__link">
                  {q.title}
                </Link>
              </li>
            ))}
          </ol>
          <Link to={{ pathname: "/", search: "?tab=hot" }} className="rail-block__more">
            查看全部热榜
          </Link>
        </>
      )}
      <footer className="rail-block__foot">知乎（仿） · 有问题，就会有答案</footer>
    </div>
  );
}
