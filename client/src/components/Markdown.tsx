import { memo } from "react";
import { Link } from "react-router-dom";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

const BASENAME = "/zhihucopy";

const stripBasename = (href: string) => {
  if (!href.startsWith(BASENAME)) return href;
  const rest = href.slice(BASENAME.length);
  return rest === "" ? "/" : /^[/#?]/.test(rest) ? rest : href;
};

const components: Components = {
  a: ({ href, children }) => {
    if (href && /^(https?:|mailto:)/i.test(href)) {
      return (
        <a href={href} target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      );
    }
    if (href && href.startsWith("/") && !href.startsWith("//")) {
      return <Link to={stripBasename(href)}>{children}</Link>;
    }
    return <span>{children}</span>;
  },
};

interface MarkdownProps {
  source: string;
  className?: string;
}

function Markdown({ source, className }: MarkdownProps) {
  if (!source.trim()) return null;
  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={components}>
        {source}
      </ReactMarkdown>
    </div>
  );
}

export default memo(Markdown);
