import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { del, get, post } from "../api";
import { useAuth } from "../auth";
import { useToast } from "../toast";
import { Empty, ErrorBox, Spinner } from "../components/Layout";
import { Button, Tag, Textarea } from "../components/ui";
import type { Answer, Question as QuestionType } from "../types";

interface CommentNode {
  id: number;
  parent_id: number | null;
  created_at: string;
  is_deleted: boolean;
  content: string | null;
  placeholder?: string;
  author: { id: number; nickname: string; avatar_url: string } | null;
  children?: CommentNode[];
}

interface CollectionItem {
  id: number;
  name: string;
  item_count: number;
}

const fmtDate = (s: string) => new Date(s + "Z").toLocaleDateString("zh-CN");
const fmtTime = (s: string) => new Date(s + "Z").toLocaleString("zh-CN");
const firstChar = (s: string) => Array.from(s.trim())[0] ?? "";
const relTime = (s: string) => {
  const mins = Math.floor((Date.now() - new Date(s + "Z").getTime()) / 60000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return fmtDate(s);
};

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

  const [following, setFollowing] = useState<boolean | null>(null);
  const [followPending, setFollowPending] = useState(false);
  const [votes, setVotes] = useState<Record<number, number>>({});
  const [votePending, setVotePending] = useState<Record<number, boolean>>({});
  const [openComments, setOpenComments] = useState<Record<number, boolean>>({});
  const [comments, setComments] = useState<Record<number, CommentNode[] | "loading">>({});
  const [commentsError, setCommentsError] = useState<Record<number, string>>({});
  const [commentDrafts, setCommentDrafts] = useState<Record<number, string>>({});
  const [commentSending, setCommentSending] = useState<Record<number, boolean>>({});
  const [favFor, setFavFor] = useState<number | null>(null);
  const [collections, setCollections] = useState<CollectionItem[] | null>(null);

  const editorRef = useRef<HTMLTextAreaElement>(null);
  const editorBoxRef = useRef<HTMLElement>(null);

  const load = useCallback(() => {
    setLoading(true);
    get<{ question: QuestionType; answers: Answer[] }>(`/questions/${id}`)
      .then((d) => {
        setQuestion(d.question);
        setFollowing(Boolean(d.question.followed));
        setAnswers(d.answers);
        setError("");
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(load, [load]);

  const answerIdsKey = answers.map((a) => a.id).join(",");
  useEffect(() => {
    if (!user || !answerIdsKey) return;
    let alive = true;
    const ids = answerIdsKey.split(",").map(Number);
    Promise.all(
      ids.map((aid) =>
        get<{ vote: number }>(`/votes/mine?target_type=answer&target_id=${aid}`)
          .then((d) => [aid, d.vote] as const)
          .catch(() => [aid, 0] as const)
      )
    ).then((entries) => {
      if (alive) setVotes(Object.fromEntries(entries) as Record<number, number>);
    });
    return () => {
      alive = false;
    };
  }, [user, answerIdsKey]);

  const needLogin = () => {
    toast("请先登录", "error");
    navigate("/login");
  };

  const followed = following ?? Boolean(question?.followed);

  const toggleFollow = async () => {
    if (!user) return needLogin();
    if (followPending) return;
    setFollowPending(true);
    const was = followed;
    setFollowing(!was);
    try {
      const d = was
        ? await del<{ following: boolean; follower_count: number }>(`/questions/${id}/follow`)
        : await post<{ following: boolean; follower_count: number }>(`/questions/${id}/follow`, {});
      setFollowing(d.following);
      setQuestion((q) => (q ? { ...q, follower_count: d.follower_count } : q));
      toast(d.following ? "已关注问题" : "已取消关注");
    } catch (e) {
      setFollowing(was);
      toast((e as Error).message, "error");
    } finally {
      setFollowPending(false);
    }
  };

  const writeAnswer = () => {
    editorBoxRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (user) editorRef.current?.focus();
  };

  const invite = async () => {
    const url = `${window.location.origin}/zhihucopy/question/${id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast("链接已复制，发给你想邀请的人吧");
    } catch {
      toast(url);
    }
  };

  const vote = async (a: Answer, value: 1 | -1) => {
    if (!user) return needLogin();
    if (votePending[a.id]) return;
    setVotePending((v) => ({ ...v, [a.id]: true }));
    const next = (votes[a.id] ?? 0) === value ? 0 : value;
    try {
      const d = await post<{ vote: number; voteup_count: number; votedown_count: number }>(
        "/votes",
        { target_type: "answer", target_id: a.id, value: next }
      );
      setVotes((v) => ({ ...v, [a.id]: d.vote }));
      setAnswers((xs) =>
        xs.map((x) =>
          x.id === a.id ? { ...x, vote_up: d.voteup_count, vote_down: d.votedown_count } : x
        )
      );
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setVotePending((v) => ({ ...v, [a.id]: false }));
    }
  };

  const loadComments = async (answerId: number) => {
    setComments((cs) => ({ ...cs, [answerId]: "loading" }));
    setCommentsError((ce) => {
      const next = { ...ce };
      delete next[answerId];
      return next;
    });
    try {
      const d = await get<{ items: CommentNode[] }>(
        `/comments?target_type=answer&target_id=${answerId}`
      );
      setComments((cs) => ({ ...cs, [answerId]: d.items }));
    } catch (e) {
      setComments((cs) => {
        const next = { ...cs };
        delete next[answerId];
        return next;
      });
      setCommentsError((ce) => ({ ...ce, [answerId]: (e as Error).message }));
      toast((e as Error).message, "error");
    }
  };

  const toggleComments = (answerId: number) => {
    const willOpen = !openComments[answerId];
    setOpenComments((o) => ({ ...o, [answerId]: willOpen }));
    if (willOpen && comments[answerId] === undefined) void loadComments(answerId);
  };

  const submitComment = async (a: Answer) => {
    const body = (commentDrafts[a.id] ?? "").trim();
    if (!body) return;
    setCommentSending((s) => ({ ...s, [a.id]: true }));
    try {
      const { comment } = await post<{ comment: CommentNode }>("/comments", {
        target_type: "answer",
        target_id: a.id,
        body,
      });
      setComments((cs) => ({
        ...cs,
        [a.id]: [...(Array.isArray(cs[a.id]) ? (cs[a.id] as CommentNode[]) : []), comment],
      }));
      setCommentDrafts((d) => ({ ...d, [a.id]: "" }));
      setAnswers((xs) =>
        xs.map((x) => (x.id === a.id ? { ...x, comment_count: x.comment_count + 1 } : x))
      );
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setCommentSending((s) => ({ ...s, [a.id]: false }));
    }
  };

  const toggleFav = async (answerId: number) => {
    if (!user) return needLogin();
    setFavFor((f) => (f === answerId ? null : answerId));
    if (collections !== null) return;
    try {
      const d = await get<{ collections: CollectionItem[] }>("/collections/mine");
      setCollections(d.collections);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const collect = async (c: CollectionItem, answerId: number) => {
    try {
      await post(`/collections/${c.id}/items`, { answer_id: answerId });
      setFavFor(null);
      toast(`已收藏到「${c.name}」`);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const share = async (a: Answer) => {
    const url = `${window.location.origin}/zhihucopy/question/${id}#answer-${a.id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast("链接已复制，去分享吧");
    } catch {
      toast(url);
    }
  };

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
        <span>提问于 {relTime(question.created_at)}</span>
        <span aria-hidden="true">·</span>
        <span>{question.follower_count} 人关注</span>
        <span aria-hidden="true">·</span>
        <span>{question.answer_count} 个回答</span>
        <span aria-hidden="true">·</span>
        <span>{question.view_count} 次浏览</span>
      </div>
      <div className="question__actions">
        <Button
          variant="outline"
          className={`question__follow${followed ? " question__follow--on" : ""}`}
          onClick={toggleFollow}
          disabled={followPending}
          title={followed ? "取消关注" : undefined}
        >
          {followed ? "已关注" : "关注问题"}
        </Button>
        <Button onClick={writeAnswer}>写回答</Button>
        <button type="button" className="question__invite" onClick={invite}>
          邀请回答
        </button>
      </div>

      <section className="answers">
        <h2 className="answers__count">{question.answer_count} 个回答</h2>
        {answers.length === 0 ? (
          <Empty title="还没有回答" hint="写下第一个回答，帮提问的人一把" />
        ) : (
          <ul className="answerlist">
            {answers.map((a) => {
              const my = votes[a.id] ?? 0;
              const cs = comments[a.id];
              return (
                <li key={a.id} className="answer" id={`answer-${a.id}`}>
                  <div className="answer__author">
                    <Link
                      to={`/u/${a.author.id}`}
                      className="answer__avatar"
                      aria-label={a.author.nickname}
                    >
                      {a.author.avatar_url ? (
                        <img src={a.author.avatar_url} alt="" />
                      ) : (
                        firstChar(a.author.nickname)
                      )}
                    </Link>
                    <div className="answer__author-text">
                      <Link to={`/u/${a.author.id}`} className="answer__name">
                        {a.author.nickname}
                      </Link>
                      {a.author.bio && <p className="answer__bio">{a.author.bio}</p>}
                    </div>
                  </div>
                  <div className="answer__body prose">
                    {a.content_md
                      .split(/\n{2,}/)
                      .map((p) => p.trim())
                      .filter(Boolean)
                      .map((p, i) => (
                        <p key={i}>{p}</p>
                      ))}
                  </div>
                  <div className="answer__actions">
                    <button
                      type="button"
                      className={`answer__vote answer__vote--up${my === 1 ? " is-active" : ""}`}
                      aria-pressed={my === 1}
                      disabled={votePending[a.id]}
                      onClick={() => vote(a, 1)}
                    >
                      赞同{a.vote_up > 0 ? ` ${a.vote_up}` : ""}
                    </button>
                    <button
                      type="button"
                      className={`answer__vote answer__vote--down${my === -1 ? " is-active" : ""}`}
                      aria-pressed={my === -1}
                      disabled={votePending[a.id]}
                      onClick={() => vote(a, -1)}
                    >
                      反对
                    </button>
                    <button
                      type="button"
                      className="answer__action"
                      onClick={() => toggleComments(a.id)}
                    >
                      {openComments[a.id] ? "收起评论" : `${a.comment_count} 条评论`}
                    </button>
                    <div className="answer__fav">
                      <button
                        type="button"
                        className="answer__action"
                        onClick={() => toggleFav(a.id)}
                      >
                        收藏
                      </button>
                      {favFor === a.id && (
                        <div className="answer__fav-menu" role="menu">
                          {collections === null ? (
                            <p className="answer__fav-empty">加载中…</p>
                          ) : collections.length === 0 ? (
                            <p className="answer__fav-empty">你还没有收藏夹</p>
                          ) : (
                            collections.map((c) => (
                              <button
                                key={c.id}
                                type="button"
                                className="answer__fav-item"
                                onClick={() => collect(c, a.id)}
                              >
                                {c.name}（{c.item_count}）
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                    <button type="button" className="answer__action" onClick={() => share(a)}>
                      分享
                    </button>
                    <span className="answer__date">发布于 {fmtDate(a.created_at)}</span>
                  </div>
                  {openComments[a.id] && (
                    <div className="answer__comments">
                      {cs === "loading" || (cs === undefined && !commentsError[a.id]) ? (
                        <p className="answer__comment-empty">评论加载中…</p>
                      ) : cs === undefined ? (
                        <p className="answer__comment-empty">
                          评论加载失败
                          <button
                            type="button"
                            className="answer__comment-retry"
                            onClick={() => void loadComments(a.id)}
                          >
                            重试
                          </button>
                        </p>
                      ) : (
                        <>
                          {cs.length === 0 ? (
                            <p className="answer__comment-empty">还没有评论，来说两句吧</p>
                          ) : (
                            <ul className="answer__comment-list">
                              {cs
                                .flatMap((c) => [c, ...(c.children ?? [])])
                                .map((c) => (
                                  <li
                                    key={c.id}
                                    className={`answer__comment${
                                      c.parent_id ? " answer__comment--child" : ""
                                    }`}
                                  >
                                    <span className="answer__comment-name">
                                      {c.author ? c.author.nickname : "已注销用户"}
                                    </span>
                                    <span className="answer__comment-time">
                                      {fmtTime(c.created_at)}
                                    </span>
                                    <p
                                      className={`answer__comment-body${
                                        c.is_deleted ? " answer__comment-body--deleted" : ""
                                      }`}
                                    >
                                      {c.is_deleted ? c.placeholder ?? "该评论已删除" : c.content}
                                    </p>
                                  </li>
                                ))}
                            </ul>
                          )}
                          {user ? (
                            <div className="answer__comment-form">
                              <Textarea
                                rows={2}
                                maxLength={500}
                                placeholder="写下你的评论…"
                                value={commentDrafts[a.id] ?? ""}
                                onChange={(e) =>
                                  setCommentDrafts((d) => ({ ...d, [a.id]: e.target.value }))
                                }
                              />
                              <div className="answer__comment-actions">
                                <Button
                                  onClick={() => submitComment(a)}
                                  disabled={
                                    commentSending[a.id] || !(commentDrafts[a.id] ?? "").trim()
                                  }
                                >
                                  {commentSending[a.id] ? "发布中…" : "发布"}
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <p className="answer__comment-hint">
                              <Link to="/login">登录</Link> 后参与评论
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="answer-editor" ref={editorBoxRef}>
        <h2 className="answers__count">写下你的回答</h2>
        {user ? (
          <>
            <Textarea
              ref={editorRef}
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
