// next 参数统一口径：仅放行站内路径（"/x"），拒绝外站与 "//host" 协议相对跳转。
export function safeNext(next: string | null): string | null {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : null;
}

// 登录/注册导航链接拼装：next 合法才透传，非法值退回裸路径。
export function authHref(
  path: "/login" | "/register",
  next: string | null
): string {
  const n = safeNext(next);
  return n ? `${path}?next=${encodeURIComponent(n)}` : path;
}
