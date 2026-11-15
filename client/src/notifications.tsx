import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { get, post } from "./api";
import { useAuth } from "./auth";

interface NotificationsState {
  unread: number;
  refresh: () => Promise<void>;
  syncUnread: (n: number) => void;
  markAllRead: () => Promise<void>;
  markRead: (id: number) => Promise<void>;
  markReadMany: (ids: number[]) => Promise<void>;
}

const NotificationsContext = createContext<NotificationsState | null>(null);

// 未读角标共享状态：TopNav 与通知页共用，登录态变化时重新拉取。
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [unread, setUnread] = useState(0);

  const refresh = useCallback(async () => {
    if (!user) {
      setUnread(0);
      return;
    }
    try {
      const res = await get<{ count?: number }>("/notifications/unread-count");
      setUnread(res?.count ?? 0);
    } catch {
      // 拉取失败保留现值，避免角标闪烁。
    }
  }, [user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 回到前台时轻量重拉未读数（无轮询定时器），保持角标与服务端一致。
  useEffect(() => {
    const onActive = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", onActive);
    document.addEventListener("visibilitychange", onActive);
    return () => {
      window.removeEventListener("focus", onActive);
      document.removeEventListener("visibilitychange", onActive);
    };
  }, [refresh]);

  const syncUnread = useCallback((n: number) => {
    setUnread(Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0);
  }, []);

  const markAllRead = useCallback(async () => {
    await post("/notifications/read", { all: true });
    setUnread(0);
  }, []);

  const markRead = useCallback(async (id: number) => {
    const res = await post<{ updated?: number }>("/notifications/read", {
      ids: [id],
    });
    const updated = res?.updated ?? 0;
    if (updated > 0) setUnread((u) => Math.max(0, u - updated));
  }, []);

  const markReadMany = useCallback(async (ids: number[]) => {
    const list = [...new Set(ids.filter((v) => Number.isInteger(v) && v > 0))];
    if (!list.length) return;
    const res = await post<{ updated?: number }>("/notifications/read", {
      ids: list,
    });
    const updated = res?.updated ?? 0;
    if (updated > 0) setUnread((u) => Math.max(0, u - updated));
  }, []);

  const value = useMemo(
    () => ({ unread, refresh, syncUnread, markAllRead, markRead, markReadMany }),
    [unread, refresh, syncUnread, markAllRead, markRead, markReadMany]
  );
  return (
    <NotificationsContext.Provider value={value}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationsContext);
  if (!ctx) {
    throw new Error("useNotifications must be used inside <NotificationsProvider>");
  }
  return ctx;
}
