import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { get, post } from "../api";
import { useAuth } from "../auth";
import { useToast } from "../toast";
import MarkdownEditor from "../components/MarkdownEditor";
import { Button, Card, Input } from "../components/ui";
import type { Page, Question, Topic } from "../types";

const MAX_TOPICS = 5;

export function Ask() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [topicPool, setTopicPool] = useState<Topic[] | null>(null);
  const [pickedTopics, setPickedTopics] = useState<Topic[]>([]);
  const [topicQuery, setTopicQuery] = useState("");
  const [topicOpen, setTopicOpen] = useState(false);
  const topicInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    get<Page<Topic>>("/topics?sort=questions&limit=50")
      .then((d) => setTopicPool(d.items))
      .catch(() => setTopicPool([]));
  }, []);

  if (!loading && !user) {
    navigate("/login");
    return null;
  }

  const topicOptions = (topicPool ?? []).filter(
    (t) =>
      !pickedTopics.some((p) => p.id === t.id) &&
      (!topicQuery.trim() ||
        t.name.toLowerCase().includes(topicQuery.trim().toLowerCase()))
  );
  const topicFull = pickedTopics.length >= MAX_TOPICS;

  const addTopic = (t: Topic) => {
    if (topicFull || pickedTopics.some((p) => p.id === t.id)) return;
    setPickedTopics((xs) => [...xs, t]);
    setTopicQuery("");
    setTopicOpen(true);
    topicInputRef.current?.focus();
  };

  const removeTopic = (id: number) =>
    setPickedTopics((xs) => xs.filter((t) => t.id !== id));

  const onTopicKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (topicOptions[0]) addTopic(topicOptions[0]);
    } else if (e.key === "Escape") {
      setTopicOpen(false);
    } else if (e.key === "Backspace" && !topicQuery && pickedTopics.length) {
      setPickedTopics((xs) => xs.slice(0, -1));
    }
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      const { question } = await post<{ question: Question }>("/questions", {
        title: title.trim(),
        detail_md: detail,
        topic_ids: pickedTopics.map((t) => t.id),
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
      <div className="form-label">
        <span id="ask-detail-label">补充说明（可选）</span>
        <MarkdownEditor
          rows={6}
          value={detail}
          aria-labelledby="ask-detail-label"
          placeholder="背景、你已经尝试过的方法、期望的回答方向…（支持 Markdown）"
          onChange={(e) => setDetail(e.target.value)}
        />
      </div>
      <div className="form-label">
        <span id="ask-topics-label">话题（可选，最多 {MAX_TOPICS} 个）</span>
        <div
          className="topic-select"
          data-testid="topic-select"
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              setTopicOpen(false);
            }
          }}
        >
          <div className="topic-select__box">
            {pickedTopics.map((t) => (
              <span key={t.id} className="topic-select__chip tag">
                {t.name}
                <button
                  type="button"
                  className="topic-select__chip-x"
                  aria-label={`移除话题 ${t.name}`}
                  onClick={() => removeTopic(t.id)}
                >
                  ×
                </button>
              </span>
            ))}
            <input
              ref={topicInputRef}
              className="topic-select__input"
              aria-labelledby="ask-topics-label"
              placeholder={
                topicFull
                  ? "已达上限"
                  : pickedTopics.length
                    ? "继续添加话题…"
                    : "搜索话题…"
              }
              disabled={topicFull}
              value={topicQuery}
              onFocus={() => setTopicOpen(true)}
              onChange={(e) => {
                setTopicQuery(e.target.value);
                setTopicOpen(true);
              }}
              onKeyDown={onTopicKeyDown}
            />
          </div>
          {topicOpen && !topicFull && (
            <ul className="topic-select__menu" role="listbox" aria-label="话题候选">
              {topicPool === null ? (
                <li className="topic-select__empty">话题加载中…</li>
              ) : topicOptions.length === 0 ? (
                <li className="topic-select__empty">没有匹配的话题</li>
              ) : (
                topicOptions.slice(0, 8).map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={false}
                      className="topic-select__option"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => addTopic(t)}
                    >
                      <span>{t.name}</span>
                      {typeof t.question_count === "number" && (
                        <span className="topic-select__count">
                          {t.question_count} 个问题
                        </span>
                      )}
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
          {pickedTopics.length > 0 && (
            <p className="topic-select__hint">
              已选 {pickedTopics.length}/{MAX_TOPICS} 个话题
            </p>
          )}
        </div>
      </div>
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
