import { Link } from "react-router-dom";
import { ApiError } from "../api";
import { usePageTitle } from "../lib/usePageTitle";

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

// 调用方传入的 detail 多为英文原始错误串（e.message），在此归一化为中文人话。
// 已含中文的串原样透出（截 60 字）；识别不了的纯英文串一律丢弃，不给用户看。
export function friendlyDetail(raw?: string): string | undefined {
  const s = (raw || "").trim();
  if (!s) return undefined;
  if (/failed to fetch|networkerror|load failed/i.test(s))
    return "网络连接不稳定，请检查网络后重试。";
  if (/timeout|aborted/i.test(s)) return "请求超时，稍后再试。";
  if (/internal|500|unexpected token|syntaxerror/i.test(s))
    return "服务端出了点问题，我们正在处理。";
  if (/[一-鿿]/.test(s)) return s.slice(0, 60);
  return undefined;
}

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
  const friendly = friendlyDetail(detail);
  // 兜底路由/独立 404 用默认站点标题；被 Question/Profile 等嵌入时父级
  // usePageTitle 后执行、覆盖为本页专属错误标题。
  usePageTitle(null);
  return (
    <div className="notfound">
      {copy.code && <p className="notfound__code">{copy.code}</p>}
      <p className="notfound__title">{copy.title}</p>
      <p className="notfound__hint">{copy.hint}</p>
      {friendly && <p className="notfound__detail">{friendly}</p>}
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
