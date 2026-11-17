export interface Badge {
  code: string;
  name: string;
  description: string;
  icon_svg: string;
  // Z1123 展示字段：label 为可读全称，title 为完整中文说明；
  // 未知 code 时 label 为 null，前端兜底显示 code 原文。
  label?: string | null;
  title?: string | null;
  granted_at?: string;
}

export interface User {
  id: number;
  email: string;
  nickname: string;
  avatar_url: string;
  bio: string;
  salt_value: number;
  level: number;
  is_admin: number;
  created_at: string;
}

export interface Author {
  id: number;
  nickname: string;
  avatar_url: string;
  bio?: string;
  // 仅登录请求在回答列表回带：当前用户是否已关注该作者。
  is_following?: boolean;
}

export interface Topic {
  id: number;
  name: string;
  slug?: string;
  description?: string;
  follower_count?: number;
  question_count?: number;
  is_following?: boolean;
}

export interface Question {
  id: number;
  title: string;
  detail_md: string;
  created_at: string;
  updated_at: string;
  answer_count: number;
  follower_count: number;
  view_count: number;
  author: Author;
  topics: Topic[];
  matched?: "title" | "detail" | "topic";
  followed?: boolean;
  // 仅热榜（/questions?tab=hot、/feed/hot）返回：热度分与排名变化。
  hot_score?: number;
  rank_delta?: number;
}

export interface Answer {
  id: number;
  question_id: number;
  question_title?: string;
  content_md: string;
  vote_up: number;
  vote_down: number;
  comment_count: number;
  is_collapsed: number;
  created_at: string;
  updated_at: string;
  author: Author;
  is_collected?: boolean;
  // 仅登录请求返回：该回答是否为当前用户本人所发（置顶与「你的回答」标识用）。
  is_mine?: boolean;
}

export interface Page<T> {
  items: T[];
  total: number;
  has_more: boolean;
}

// /search 的各 scope 命中数（tab 计数用）。
export interface SearchCounts {
  question: number;
  answer: number;
  user: number;
}

// /search?type=answer 的条目：所属问题 + 命中片段 + 作者/赞同。
export interface AnswerResult {
  id: number;
  question_id: number;
  question_title: string;
  snippet: string;
  vote_up: number;
  created_at: string;
  author: Author;
  topics: Topic[];
}

// /search?type=user 的条目。
export interface UserResult {
  id: number;
  nickname: string;
  avatar_url: string;
  bio: string;
  answer_count: number;
  follower_count: number;
}

export interface ProfileData {
  user: User;
  badges?: Badge[];
  stats: {
    answers: number;
    questions: number;
    followers: number;
    following: number;
    vote_up: number;
  };
  // 仅登录请求返回：当前用户是否已关注该页主。
  is_following?: boolean;
}

// /users/:id/highlights — 0 回答主页的空态补内容：页主最近关注的问题与赞同的回答。
export interface UpvotedAnswer {
  answer_id: number;
  question_id: number;
  question_title: string;
  snippet: string;
  vote_up: number;
  created_at: string;
  author: Author;
}

export interface ProfileHighlights {
  followed_questions: Question[];
  upvoted_answers: UpvotedAnswer[];
}
