import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { get } from "../api";
import type { Page, Question } from "../types";

export function UnansweredRail() {
  const [items, setItems] = useState<Question[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    get<Page<Question>>("/questions?tab=unanswered&page=1&limit=5")
      .then((p) => setItems(p.items))
      .catch(() => setItems([]))
      .finally(() => setLoaded(true));
  }, []);

  if (!loaded || items.length === 0) return null;

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
