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
}

export interface Topic {
  id: number;
  name: string;
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
  followed?: boolean;
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
}

export interface Page<T> {
  items: T[];
  total: number;
  has_more: boolean;
}
