// 移动端搜索层「最近搜索」：localStorage 持久化，最多保留 8 条，新词置顶去重。
const KEY = "zhihu_recent_searches";
const MAX = 8;

export function loadRecentSearches(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list)
      ? list.filter((x): x is string => typeof x === "string" && x.trim() !== "")
      : [];
  } catch {
    return [];
  }
}

export function saveRecentSearch(term: string) {
  const t = term.trim();
  if (!t) return;
  try {
    const next = [t, ...loadRecentSearches().filter((x) => x !== t)].slice(0, MAX);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // localStorage 不可用时静默降级，不阻塞搜索。
  }
}
