import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";

interface ToastItem {
  id: number;
  text: string;
  kind: "info" | "error";
}

const ToastContext = createContext<(text: string, kind?: ToastItem["kind"]) => void>(
  () => undefined
);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const itemsRef = useRef<ToastItem[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const apply = (list: ToastItem[]) => {
    itemsRef.current = list;
    setItems(list);
  };

  const dismiss = useCallback((id: number) => {
    const t = timers.current.get(id);
    if (t !== undefined) clearTimeout(t);
    timers.current.delete(id);
  }, []);

  const push = useCallback(
    (text: string, kind: ToastItem["kind"] = "info") => {
      // 同文案同类型：替换旧条（计时重置），不叠加
      for (const t of itemsRef.current) {
        if (t.text === text && t.kind === kind) dismiss(t.id);
      }
      const rest = itemsRef.current.filter((t) => !(t.text === text && t.kind === kind));
      const id = nextId.current++;
      let next = [...rest, { id, text, kind }];
      // 不同文案可堆叠，最多 3 条（溢出丢最旧）
      if (next.length > 3) {
        for (const t of next.slice(0, next.length - 3)) dismiss(t.id);
        next = next.slice(-3);
      }
      timers.current.set(
        id,
        setTimeout(() => {
          timers.current.delete(id);
          apply(itemsRef.current.filter((x) => x.id !== id));
        }, 3200)
      );
      apply(next);
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="notify-stack">
        {items.map((t) => (
          <div key={t.id} role="status" aria-live="polite" className={`toast toast--${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
