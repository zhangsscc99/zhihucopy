// 搜索跳转统一入口：桌面顶栏、移动搜索层、结果页输入框共用，始终落 /search?q=。
export function searchHref(term: string): string {
  return `/search?q=${encodeURIComponent(term.trim())}`;
}
