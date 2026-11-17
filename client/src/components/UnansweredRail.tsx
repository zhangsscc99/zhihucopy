import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { get } from "../api";
import type { Page, Question, Topic } from "../types";

export function UnansweredRail() {
  const [items, setItems] = useState<Question[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let dead = false;
    get<Page<Question>>("/questions?tab=unanswered&page=1&limit=5")
      .then(async (p) => {
        if (dead) return;
        if (p.items.length > 0) {
          setItems(p.items);
          return;
        }
        // Z1105 — 未答库存为 0 时不留空白，兜底一块轻量「你可能感兴趣的话题」。
        const t = await get<Page<Topic>>("/topics?sort=followers&page=1&limit=6").catch(
          () => null
        );
        if (!dead && t) setTopics(t.items);
      })
      .catch(() => {})
      .finally(() => {
        if (!dead) setLoaded(true);
      });
    return () => {
      dead = true;
    };
  }, []);

  if (!loaded || (items.length === 0 && topics.length === 0)) return null;

  if (items.length === 0) {
    return (
      <div className="rail-block rail-block--unanswered rail-block--topics">
        <div className="rail-block__head">
          <h2 className="rail-block__title">你可能感兴趣的话题</h2>
          <Link to="/topics" className="rail-block__head-more">
            更多
          </Link>
        </div>
        <ul className="answerlist">
          {topics.map((t) => (
            <li key={t.id} className="answerlist__item">
              <Link to={`/topic/${t.slug || t.id}`} className="answerlist__link">
                {t.name}
              </Link>
              <span className="answerlist__meta">{t.follower_count ?? 0} 人关注</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="rail-block rail-block--unanswered">
      <div className="rail-block__head">
        <h2 className="rail-block__title">等你来答</h2>
        <Link to="/unanswered" className="rail-block__head-more">
          更多
        </Link>
      </div>
      <ul className="answerlist">
        {items.map((q) => (
          <li key={q.id} className="answerlist__item">
            <Link to={`/question/${q.id}`} className="answerlist__link">
              {q.title}
            </Link>
            <span className="answerlist__meta">{q.follower_count} 人关注</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
