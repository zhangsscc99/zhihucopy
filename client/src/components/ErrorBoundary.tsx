import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

// 渲染层兜底：子树任何渲染异常 → 知乎风错误卡（白卡 + 「重试」），
// 绝不让一次组件崩溃把整个 SPA 卸载成白屏。重试即重置边界重新挂载子树。
interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  retry = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="crashbox" role="alert">
        <p className="crashbox__title">页面出错了</p>
        <p className="crashbox__hint">
          这一部分内容加载时发生异常，请重试或刷新页面。
        </p>
        <button
          type="button"
          className="btn btn--outline crashbox__retry"
          onClick={this.retry}
        >
          重试
        </button>
      </div>
    );
  }
}
