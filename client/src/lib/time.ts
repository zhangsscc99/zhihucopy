// 统一时间显示：7 天内相对时间，更早显示 YYYY-MM-DD（本地时区）。
// 服务端时间为 UTC 且无时区后缀（如 "2026-01-01 08:00:00"），这里按 UTC 解析。

function toDate(input: string | number | Date): Date | null {
  let d: Date;
  if (input instanceof Date) {
    d = input;
  } else if (typeof input === "number") {
    d = new Date(input);
  } else {
    const s = input.trim();
    // 裸 "YYYY-MM-DD[ HH:mm[:ss]]" 视为 UTC；带时区信息的按原样解析
    const bare = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/.test(s);
    d = new Date(bare ? s.replace(" ", "T") + "Z" : s);
  }
  return Number.isNaN(d.getTime()) ? null : d;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function formatTime(input: string | number | Date): string {
  const d = toDate(input);
  if (!d) return "";
  const diff = Date.now() - d.getTime();
  if (diff < 0) return ymd(d); // 未来/异常按日期显示
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  return ymd(d);
}
