import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { get } from "../api";
import { useAuth } from "../auth";
import { Empty, ErrorBox, Spinner } from "../components/Layout";
import type { Page, Question } from "../types";

type Tab = "following" | "recommended" | "hot";

const TABS: { key: Tab; label: string }[] = [
  { key: "following", label: "关注" },
  { key: "recommended", label: "推荐" },
  { key: "hot", label: "热榜" },
];

function excerpt(md: string, n = 90) {
  const text = md.replace(/[#>*`\-[\]()!]/g, "").replace(/\s+/g, " ").trim();
  return text.length > n ? text.slice(0, n) + "…" : text;
}

export function Home() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab) || "recommended";
  const [data, setData] = useState<Page<Question> | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (tab === "following") return;
    setLoading(true);
    setError("");
    get<Page<Question>>(`/questions?tab=${tab === "hot" ? "hot" : "new"}&limit=20`)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [tab]);

  const setTab = (t: Tab) => setParams(t === "recommended" ? {} : { tab: t });

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
        />
      ) : loading ? (
        <Spinner />
      ) : error ? (
        <ErrorBox message={error} />
      ) : !data || data.items.length === 0 ? (
        <Empty
          title="还没有问题"
          hint="提出第一个问题，让这里开始生长"
        />
      ) : (
        <ul className="feed">
          {data.items.map((q) => (
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
      )}
    </>
  );
}
