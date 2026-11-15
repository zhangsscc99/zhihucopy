import {
  forwardRef,
  useCallback,
  useRef,
  useState,
  type TextareaHTMLAttributes,
} from "react";
import Markdown from "./Markdown";
import { Textarea } from "./ui";

type MarkdownEditorProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

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

    return (
      <div className="md-editor">
        <div className="md-editor__tabs" role="tablist" aria-label="编辑与预览切换">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "edit"}
            className={`md-editor__tab${tab === "edit" ? " md-editor__tab--active" : ""}`}
            onClick={() => setTab("edit")}
          >
            编辑
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "preview"}
            className={`md-editor__tab${tab === "preview" ? " md-editor__tab--active" : ""}`}
            onClick={() => setTab("preview")}
          >
            预览
          </button>
        </div>
        <Textarea ref={attachRef} value={value} hidden={tab === "preview"} {...rest} />
        {tab === "preview" && (
          <div className="md-editor__preview prose" aria-live="polite">
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
