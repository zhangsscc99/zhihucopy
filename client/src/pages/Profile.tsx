import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { get } from "../api";
import { Card } from "../components/ui";
import { Empty, ErrorBox, Spinner } from "../components/Layout";
import type { User } from "../types";

interface ProfileData {
  user: User;
  stats: {
    answers: number;
    questions: number;
    followers: number;
    following: number;
    vote_up: number;
  };
}

export function Profile() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<ProfileData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    get<ProfileData>(`/users/${id}`)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <Spinner />;
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Empty title="用户不存在" />;

  const { user, stats } = data;
  return (
    <Card className="profile">
      <div className="profile__head">
        <span className="avatar avatar--lg">
          {user.avatar_url ? <img src={user.avatar_url} alt="" /> : user.nickname.slice(0, 1)}
        </span>
        <div>
          <h1 className="profile__name">{user.nickname}</h1>
          <p className="profile__bio">{user.bio || "这个人还没有写简介。"}</p>
          <p className="profile__joined">
            {new Date(user.created_at + "Z").toLocaleDateString("zh-CN")} 加入
          </p>
        </div>
      </div>
      <dl className="profile__stats">
        <div>
          <dt>回答</dt>
          <dd>{stats.answers}</dd>
        </div>
        <div>
          <dt>提问</dt>
          <dd>{stats.questions}</dd>
        </div>
        <div>
          <dt>获赞</dt>
          <dd>{stats.vote_up}</dd>
        </div>
        <div>
          <dt>关注</dt>
          <dd>{stats.following}</dd>
        </div>
        <div>
          <dt>粉丝</dt>
          <dd>{stats.followers}</dd>
        </div>
      </dl>
    </Card>
  );
}
