import { Link } from "react-router-dom";
import { ApiError } from "../api";

// 「内容不存在」的唯一判定：接口 404（ApiError.status === 404）。
// fetch 抛错、5xx 及其它错误一律归「服务暂时不可用」。
export const isContentMissing = (e: unknown) =>
  e instanceof ApiError && e.status === 404;

const COPY = {
  missing: {
    code: "404",
    title: "你访问的内容不存在或已被删除",
    hint: "链接可能有误，或者内容已被作者删除。",
  },
  error: {
    code: "",
    title: "服务暂时不可用",
    hint: "稍后再试，或者先回首页看看别的内容。",
  },
} as const;

export function NotFound({
  kind = "missing",
  detail,
  onRetry,
}: {
  kind?: keyof typeof COPY;
  detail?: string;
  onRetry?: () => void;
}) {
  const copy = COPY[kind];
  return (
    <div className="notfound">
      {copy.code && <p className="notfound__code">{copy.code}</p>}
      <p className="notfound__title">{copy.title}</p>
      <p className="notfound__hint">{copy.hint}</p>
      {detail && <p className="notfound__detail">{detail}</p>}
      <div className="notfound__actions">
        <Link to="/" className="btn btn--primary">
          回到首页
        </Link>
        <Link to="/?focus=search" className="btn btn--outline">
          去搜索
        </Link>
        {onRetry && (
          <button type="button" className="btn btn--ghost" onClick={onRetry}>
            重试
          </button>
        )}
      </div>
    </div>
  );
}
