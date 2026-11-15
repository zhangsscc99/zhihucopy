import {
  forwardRef,
  useCallback,
  useRef,
  useState,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import Markdown from "./Markdown";
import { Textarea } from "./ui";

type MarkdownEditorProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

// ---- 工具栏：在光标处插入/包裹 Markdown 语法 --------------------------------

interface EditResult {
  start: number; // 替换区间 [start, end)
  end: number;
  text: string; // 替换后的文本
  selStart: number; // 插入后的选区
  selEnd: number;
}
type ToolRun = (v: string, s: number, e: number) => EditResult;

const wrapSelection =
  (before: string, after: string, placeholder: string): ToolRun =>
  (v, s, e) => {
    const inner = v.slice(s, e) || placeholder;
    return {
      start: s,
      end: e,
      text: before + inner + after,
      selStart: s + before.length,
      selEnd: s + before.length + inner.length,
    };
  };

// 行前缀工具（标题/列表/引用）：作用于选区覆盖的整行；全部已有前缀则去掉（切换语义）。
const linePrefix =
  (prefix: string): ToolRun =>
  (v, s, e) => {
    const ls = v.lastIndexOf("\n", Math.max(0, s - 1)) + 1;
    let le = v.indexOf("\n", e);
    if (le === -1) le = v.length;
    const lines = v.slice(ls, le).split("\n");
    const nonEmpty = lines.filter((l) => l.trim());
    const strip =
      nonEmpty.length > 0 && nonEmpty.every((l) => l.startsWith(prefix));
    const next = lines
      .map((l) =>
        strip ? (l.startsWith(prefix) ? l.slice(prefix.length) : l) : prefix + l
      )
      .join("\n");
    return { start: ls, end: le, text: next, selStart: ls, selEnd: ls + next.length };
  };

const codeTool: ToolRun = (v, s, e) => {
  const sel = v.slice(s, e);
  if (sel.includes("\n")) {
    return {
      start: s,
      end: e,
      text: "```\n" + sel + "\n```",
      selStart: s + 4,
      selEnd: s + 4 + sel.length,
    };
  }
  return wrapSelection("`", "`", "代码")(v, s, e);
};

const linkTool: ToolRun = (v, s, e) => {
  const label = v.slice(s, e) || "链接文字";
  const text = `[${label}](https://)`;
  const urlStart = s + label.length + 3; // "[label](" 之后
  return {
    start: s,
    end: e,
    text,
    selStart: urlStart,
    selEnd: urlStart + "https://".length,
  };
};

// 绕过 React 的 value tracker 写值并派发 input，让受控 textarea 正常触发 onChange。
const nativeAreaSetter = Object.getOwnPropertyDescriptor(
  HTMLTextAreaElement.prototype,
  "value"
)!.set!;
const setNativeValue = (el: HTMLTextAreaElement, value: string) => {
  nativeAreaSetter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
};

const iconProps = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

const TOOLS: { key: string; label: string; run: ToolRun; icon: ReactNode }[] = [
  {
    key: "bold",
    label: "加粗",
    run: wrapSelection("**", "**", "粗体"),
    icon: (
      <svg {...iconProps}>
        <path d="M7 5h5.5a3.5 3.5 0 0 1 0 7H7z" />
        <path d="M7 12h6.5a3.5 3.5 0 0 1 0 7H7z" />
      </svg>
    ),
  },
  {
    key: "heading",
    label: "H2", // 不能叫「标题」：会与 /ask 页 getByLabel("标题") 的标题输入框撞名
    run: linePrefix("## "),
    icon: (
      <svg {...iconProps}>
        <path d="M6 5v14M18 5v14M6 12h12" />
      </svg>
    ),
  },
  {
    key: "list",
    label: "列表",
    run: linePrefix("- "),
    icon: (
      <svg {...iconProps}>
        <path d="M9 6h11M9 12h11M9 18h11" />
        <circle cx="4.5" cy="6" r="1.1" fill="currentColor" stroke="none" />
        <circle cx="4.5" cy="12" r="1.1" fill="currentColor" stroke="none" />
        <circle cx="4.5" cy="18" r="1.1" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    key: "code",
    label: "代码",
    run: codeTool,
    icon: (
      <svg {...iconProps}>
        <path d="M15 7l5 5-5 5M9 7l-5 5 5 5" />
      </svg>
    ),
  },
  {
    key: "quote",
    label: "引用",
    run: linePrefix("> "),
    icon: (
      <svg {...iconProps}>
        <path d="M5.5 5v14" strokeWidth={2.6} />
        <path d="M11 8h8M11 12h8M11 16h8" />
      </svg>
    ),
  },
  {
    key: "link",
    label: "链接",
    run: linkTool,
    icon: (
      <svg {...iconProps}>
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </svg>
    ),
  },
];

const MarkdownEditor = forwardRef<HTMLTextAreaElement, MarkdownEditorProps>(
  function MarkdownEditor({ value, ...rest }, ref) {
    const [tab, setTab] = useState<"edit" | "preview">("edit");
    const tabRef = useRef(tab);
    tabRef.current = tab;
    const patchedElRef = useRef<HTMLTextAreaElement | null>(null);
    const text = String(value ?? "");

    // 预览时 textarea 仅 hidden、不卸载：内容与撤销栈不丢，父级 ref 始终指向已挂载节点。
    // 父级在预览态调 focus() 时先切回编辑态，待其可见后再真正聚焦。
    const attachRef = useCallback(
      (el: HTMLTextAreaElement | null) => {
        if (el && patchedElRef.current !== el) {
          patchedElRef.current = el;
          const nativeFocus = el.focus.bind(el);
          el.focus = (options?: FocusOptions) => {
            if (tabRef.current === "preview") {
              setTab("edit");
              requestAnimationFrame(() => nativeFocus(options));
            } else {
              nativeFocus(options);
            }
          };
        }
        if (typeof ref === "function") ref(el);
        else if (ref) ref.current = el;
      },
      [ref]
    );

    // 工具栏点击不改选区（mousedown preventDefault 留住 textarea 焦点）；
    // 预览态经 patched focus 先切回编辑，再在下一帧落插入逻辑。
    const applyTool = useCallback((run: ToolRun) => {
      const el = patchedElRef.current;
      if (!el) return;
      el.focus();
      requestAnimationFrame(() => {
        const { value: v, selectionStart: s, selectionEnd: e } = el;
        const r = run(v, s, e);
        setNativeValue(el, v.slice(0, r.start) + r.text + v.slice(r.end));
        requestAnimationFrame(() => {
          el.focus();
          el.setSelectionRange(r.selStart, r.selEnd);
        });
      });
    }, []);

    return (
      <div className="md-editor">
        <div className="md-editor__bar">
          <div className="md-toolbar" role="toolbar" aria-label="Markdown 格式工具栏">
            {TOOLS.map((t) => (
              <button
                key={t.key}
                type="button"
                className="md-toolbar__btn"
                aria-label={t.label}
                title={t.label}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => applyTool(t.run)}
              >
                {t.icon}
              </button>
            ))}
          </div>
          <div className="md-editor__tabs" role="group" aria-label="编辑与预览切换">
            <button
              type="button"
              aria-pressed={tab === "edit"}
              className={`md-editor__tab${tab === "edit" ? " md-editor__tab--active" : ""}`}
              onClick={() => setTab("edit")}
            >
              编辑
            </button>
            <button
              type="button"
              aria-pressed={tab === "preview"}
              className={`md-editor__tab${tab === "preview" ? " md-editor__tab--active" : ""}`}
              onClick={() => setTab("preview")}
            >
              预览
            </button>
          </div>
        </div>
        <Textarea ref={attachRef} value={value} hidden={tab === "preview"} {...rest} />
        {tab === "preview" && (
          <div className="md-editor__preview md-preview prose" aria-live="polite">
            {text.trim() ? (
              <Markdown source={text} />
            ) : (
              <p className="md-editor__empty">
                还没有内容，切回「编辑」输入 Markdown 后可在这里预览
              </p>
            )}
          </div>
        )}
      </div>
    );
  }
);

export default MarkdownEditor;
