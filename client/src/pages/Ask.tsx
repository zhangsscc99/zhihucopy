import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { post } from "../api";
import { useAuth } from "../auth";
import { useToast } from "../toast";
import { Button, Card, Input, Textarea } from "../components/ui";
import type { Question } from "../types";

export function Ask() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!loading && !user) {
    navigate("/login");
    return null;
  }

  const submit = async () => {
    setSubmitting(true);
    try {
      const { question } = await post<{ question: Question }>("/questions", {
        title: title.trim(),
        detail_md: detail,
        topic_ids: [],
      });
      toast("问题已发布");
      navigate(`/question/${question.id}`);
    } catch (e) {
      toast((e as Error).message, "error");
      setSubmitting(false);
    }
  };

  return (
    <Card className="ask">
      <h1 className="page-title">提出问题</h1>
      <p className="page-hint">说清楚你想知道什么，具体的问题更容易得到好回答。</p>
      <label className="form-label">
        标题
        <Input
          value={title}
          maxLength={100}
          placeholder="一句话说清你的问题（100 字以内）"
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <label className="form-label">
        补充说明（可选）
        <Textarea
          rows={6}
          value={detail}
          placeholder="背景、你已经尝试过的方法、期望的回答方向…"
          onChange={(e) => setDetail(e.target.value)}
        />
      </label>
      <div className="form-actions">
        <Button onClick={submit} disabled={submitting || !title.trim()}>
          {submitting ? "发布中…" : "发布问题"}
        </Button>
        <Button variant="ghost" onClick={() => navigate(-1)}>
          取消
        </Button>
      </div>
    </Card>
  );
}
