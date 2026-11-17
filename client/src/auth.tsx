import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  get,
  post,
  setToken,
  getToken,
  setUnauthorizedHandler,
  TOKEN_KEY,
} from "./api";
import type { User } from "./types";

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, nickname: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();
  // 当前 user 是为哪个 token 解析出来的；token 变了（他页登录/换号）必须重拉。
  const userTokenRef = useRef<string | null>(null);
  const inFlightRef = useRef<Promise<void> | null>(null);

  // 任何一次进入/回到页面都按 localStorage 里的当前 token 重放校验：
  // 无 token → 立即清空 user；有 token 且 user 不是为它解析的 → 拉一次 /auth/me。
  // 串行化去重，同一时刻至多一个在途请求。
  const refresh = useCallback((): Promise<void> => {
    if (inFlightRef.current) return inFlightRef.current;
    const token = getToken();
    if (!token) {
      userTokenRef.current = null;
      setUser(null);
      setLoading(false);
      return Promise.resolve();
    }
    if (userTokenRef.current === token) {
      setLoading(false);
      return Promise.resolve();
    }
    // token 存在但归属未定：先按「解析中」处理，顶栏渲染空位而不是「登录 注册」。
    setLoading(true);
    const p = get<{ user: User }>("/auth/me", { onUnauthorized: false })
      .then(({ user: u }) => {
        if (getToken() === token) {
          userTokenRef.current = token;
          setUser(u);
        } else {
          userTokenRef.current = null;
          setUser(null);
        }
      })
      .catch(() => {
        userTokenRef.current = null;
        setUser(null);
      })
      .finally(() => {
        inFlightRef.current = null;
        setLoading(false);
        // 校验期间 token 又变了（他页登录/登出），按新 token 再来一轮。
        if (getToken() !== token) void refresh();
      });
    inFlightRef.current = p;
    return p;
  }, []);

  // 挂载 + 每次路由变化（含同文档内的浏览器后退/前进）都重新校验。
  useEffect(() => {
    void refresh();
  }, [refresh, location.key]);

  // 跨文档回退（bfcache 复活的陈旧 React 树）与切回前台/他标签页改 token。
  useEffect(() => {
    const onShow = () => void refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === TOKEN_KEY) void refresh();
    };
    window.addEventListener("pageshow", onShow);
    window.addEventListener("popstate", onShow);
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("pageshow", onShow);
      window.removeEventListener("popstate", onShow);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("storage", onStorage);
    };
  }, [refresh]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      userTokenRef.current = null;
      setUser(null);
      navigate("/login");
    });
  }, [navigate]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await post<{ token: string; user: User }>("/auth/login", {
      email,
      password,
    });
    setToken(res.token);
    userTokenRef.current = res.token;
    setUser(res.user);
    setLoading(false);
  }, []);

  const register = useCallback(
    async (email: string, password: string, nickname: string) => {
      const res = await post<{ token: string; user: User }>("/auth/register", {
        email,
        password,
        nickname,
      });
      setToken(res.token);
      userTokenRef.current = res.token;
      setUser(res.user);
      setLoading(false);
    },
    []
  );

  const logout = useCallback(() => {
    setToken(null);
    userTokenRef.current = null;
    setUser(null);
    navigate("/");
  }, [navigate]);

  const value = useMemo(
    () => ({ user, loading, login, register, logout, refresh }),
    [user, loading, login, register, logout, refresh]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
