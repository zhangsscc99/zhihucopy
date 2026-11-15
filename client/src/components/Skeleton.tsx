/**
 * 骨架屏：用现有中性灰（--line）勾出内容轮廓，轻微呼吸，不描边、不加卡片。
 * 几何尺寸贴近真实条目：标题 16px 行、摘要 12px 行、元信息 10px 小字。
 * prefers-reduced-motion 下静止（styles.css 中显式关闭动画）。
 */

const TITLE_WIDTHS = ["86%", "72%", "64%", "80%", "58%", "78%"];
const EXCERPT_WIDTHS = ["94%", "88%", "76%", "90%", "66%"];
const RAIL_WIDTHS = ["88%", "70%", "82%", "64%", "76%", "60%", "84%", "68%"];

function Bar({
  width,
  height = 12,
  className = "",
}: {
  width: number | string;
  height?: number;
  className?: string;
}) {
  return (
    <span
      className={`sk-bar ${className}`}
      style={{ width, height }}
      aria-hidden="true"
    />
  );
}

/** 问题列表首屏 / 追加加载的占位。 */
export function FeedSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="sk-feed" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">正在加载问题列表</span>
      {Array.from({ length: count }, (_, i) => (
        <div className="sk-feed__item" key={i}>
          <Bar width={TITLE_WIDTHS[i % TITLE_WIDTHS.length]} height={16} />
          <div className="sk-feed__lines">
            <Bar width={EXCERPT_WIDTHS[i % EXCERPT_WIDTHS.length]} />
            <Bar width="52%" />
          </div>
          <div className="sk-feed__meta">
            <Bar width={56} height={10} />
            <Bar width={44} height={10} />
            <Bar width={52} height={10} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** 侧栏热榜占位。 */
export function RailSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="sk-rail" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">正在加载热榜</span>
      {Array.from({ length: rows }, (_, i) => (
        <div className="sk-rail__row" key={i}>
          <Bar width={12} height={12} />
          <Bar width={RAIL_WIDTHS[i % RAIL_WIDTHS.length]} height={12} />
        </div>
      ))}
    </div>
  );
}
