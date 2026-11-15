import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { get, post } from "../api";
import { useAuth } from "../auth";
import { useToast } from "../toast";
import { Empty, ErrorBox, Spinner } from "../components/Layout";
import { Button, Tag, Textarea } from "../components/ui";
import type { Answer, Question as QuestionType } from "../types";

export function Question() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [question, setQuestion] = useState<QuestionType | null>(null);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    get<{ question: QuestionType; answers: Answer[] }>(`/questions/${id}`)
      .then((d) => {
        setQuestion(d.question);
        setAnswers(d.answers);
        setError("");
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(load, [load]);

  const submit = async () => {
    if (!draft.trim()) return;
    setSubmitting(true);
    try {
      const { answer } = await post<{ answer: Answer }>(`/questions/${id}/answers`, {
        content_md: draft,
      });
      setAnswers((xs) => [answer, ...xs]);
      setQuestion((q) => (q ? { ...q, answer_count: q.answer_count + 1 } : q));
      setDraft("");
      toast("回答已发布");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <Spinner />;
  if (error) return <ErrorBox message={error} />;
  if (!question) return <Empty title="问题不存在" />;

  return (
    <article className="question">
      {question.topics.length > 0 && (
        <div className="question__topics">
          {question.topics.map((t) => (
            <Tag key={t.id}>{t.name}</Tag>
          ))}
        </div>
      )}
      <h1 className="question__title">{question.title}</h1>
      {question.detail_md && <p className="question__detail">{question.detail_md}</p>}
      <div className="question__meta">
        <Link to={`/u/${question.author.id}`}>{question.author.nickname}</Link>
        <span> 提问于 {new Date(question.created_at + "Z").toLocaleDateString("zh-CN")}</span>
        <span>{question.view_count} 次浏览</span>
      </div>

      <section className="answers">
        <h2 className="answers__count">{question.answer_count} 个回答</h2>
        {answers.length === 0 ? (
          <Empty title="还没有回答" hint="写下第一个回答，帮提问的人一把" />
        ) : (
          <ul className="answerlist">
            {answers.map((a) => (
              <li key={a.id} className="answer">
                <div className="answer__author">
                  <Link to={`/u/${a.author.id}`}>{a.author.nickname}</Link>
                  <span className="answer__votes">{a.vote_up} 人赞同</span>
                </div>
                <div className="answer__body prose">{a.content_md}</div>
                <div className="answer__foot">
                  发布于 {new Date(a.created_at + "Z").toLocaleString("zh-CN")}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="answer-editor">
        <h2 className="answers__count">写下你的回答</h2>
        {user ? (
          <>
            <Textarea
              rows={6}
              placeholder="分享你的见解…（支持 Markdown）"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <div className="answer-editor__actions">
              <Button onClick={submit} disabled={submitting || !draft.trim()}>
                {submitting ? "发布中…" : "发布回答"}
              </Button>
            </div>
          </>
        ) : (
          <p className="answer-editor__hint">
            <Link to="/login" onClick={() => navigate("/login")}>
              登录
            </Link>{" "}
            后即可回答这个问题
          </p>
        )}
      </section>
    </article>
  );
}
