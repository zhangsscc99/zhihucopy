const BASE = "/zhihucopy/api";
export const TOKEN_KEY = "zhihu_token";

export class ApiError extends Error {
  status: number;
  // 服务端响应体里的 error 原文（无 error 字段时为 undefined）——调用方
  // 据此决定是透出服务端文案还是用自己的兜底文案。
  serverError?: string;
  constructor(message: string, status: number, serverError?: string) {
    super(message);
    this.status = status;
    this.serverError = serverError;
  }
}

let unauthorizedHandler: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) {
  unauthorizedHandler = fn;
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export interface ApiOptions {
  // 默认 true：401 时触发全局未授权处理（清 user + 跳登录页）。
  // 后台静默重校验（/auth/me）传 false，只清 token、不把用户从当前页拽走。
  onUnauthorized?: boolean;
}

export async function api<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  opts?: ApiOptions
): Promise<T> {
  const token = getToken();
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (res.status === 401 && token) {
    setToken(null);
    if (opts?.onUnauthorized !== false) unauthorizedHandler?.();
  }
  if (!res.ok) {
    throw new ApiError(data.error || `请求失败（${res.status}）`, res.status, data.error);
  }
  return data as T;
}

export const get = <T>(path: string, opts?: ApiOptions) =>
  api<T>("GET", path, undefined, opts);
export const post = <T>(path: string, body?: unknown) => api<T>("POST", path, body);
export const patch = <T>(path: string, body?: unknown) => api<T>("PATCH", path, body);
export const del = <T>(path: string) => api<T>("DELETE", path);

export interface FollowUserResult {
  following: boolean;
  follower_count: number;
  following_count: number;
}

export const followUser = (userId: number) =>
  post<FollowUserResult>(`/users/${userId}/follow`, {});
export const unfollowUser = (userId: number) =>
  del<FollowUserResult>(`/users/${userId}/follow`);
