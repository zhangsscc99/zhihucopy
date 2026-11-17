import { Link } from "react-router-dom";
import type { Author } from "../types";

// 信息流卡元信息行作者位：24px 圆形头像（有 avatar_url 用 <img>，否则
// 昵称首字占位）+ 昵称，同处一个 /u/:id 链接内。author 为空整条不渲染。
export function FeedAuthor({ author }: { author?: Author | null }) {
  if (!author) return null;
  return (
    <Link to={`/u/${author.id}`} className="feed__author">
      <span className="avatar feed__avatar" aria-hidden="true">
        {author.avatar_url ? (
          <img src={author.avatar_url} alt="" loading="lazy" />
        ) : (
          author.nickname?.slice(0, 1)
        )}
      </span>
      <span className="feed__author-name">{author.nickname}</span>
    </Link>
  );
}
