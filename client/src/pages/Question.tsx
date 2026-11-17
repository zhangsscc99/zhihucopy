import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { del, followUser, get, patch, post, unfollowUser } from "../api";
import { useAuth } from "../auth";
import { useToast } from "../toast";
import { Empty, Spinner } from "../components/Layout";
import { isContentMissing, NotFound } from "./NotFound";
import Markdown from "../components/Markdown";
import MarkdownEditor from "../components/MarkdownEditor";
import { Button, Textarea } from "../components/ui";
import type { Answer, Page, Question as QuestionType } from "../types";
import { formatTime } from "../lib/time";

interface CommentNode {
  id: number;
  parent_id: number | null;
  created_at: string;
  is_deleted: boolean;
  is_collapsed?: boolean;
  content: string | null;
  placeholder?: string;
  author_id?: number | null;
  author: { id: number; nickname: string; avatar_url: string } | null;
  children?: CommentNode[];
}

interface CollectionItem {
  id: number;
  name: string;
  item_count: number;
  has_item?: number;
}

const firstChar = (s: string) => Array.from(s.trim())[0] ?? "";

type AnswerSort = "default" | "newest";

const ANSWER_PAGE_SIZE = 10;
// #answer-N 深链补页上限：目标不在已加载列表时最多再自动拉 5 页（5×10 条）。
const ANCHOR_MAX_FETCH = 5;
const ANSWER_SORTS: { key: AnswerSort; label: string }[] = [
  { key: "default", label: "默认" },
  { key: "newest", label: "最新" },
];

// 排序态走 URL：?sort=new ⇄ 最新，缺省/其他 ⇄ 默认；刷新后保持。
const readSort = (search: string): AnswerSort => {
  const v = new URLSearchParams(search).get("sort");
  return v === "new" || v === "newest" ? "newest" : "default";
};
const sortSearch = (s: AnswerSort) => (s === "newest" ? "?sort=new" : "");

// 固定条/摘要共用：去 Markdown 记号、压平空白后截断（保留连字符等普通标点）。
const answerExcerpt = (md: string, n = 80) => {
  const text = md.replace(/[#>*`[\]()!]/g, "").replace(/\s+/g, " ").trim();
  return text.length > n ? `${text.slice(0, n)}…` : text;
};

// 已删除或被折叠的评论统一按「gone」处理：正文不渲染。
const isGoneComment = (c: CommentNode) => Boolean(c.is_deleted || c.is_collapsed);

// 从两级评论树里摘掉被删评论：无存活子回复的整条移除；仍有存活子回复的
// 降级为「该评论已删除」占位（与刷新后服务端返回的软删形态一致，保住子回复）。
const dropComment = (list: CommentNode[], id: number): CommentNode[] =>
  list.flatMap((c) => {
    if (c.id === id) {
      const alive = (c.children ?? []).filter((k) => !isGoneComment(k));
      if (!alive.length) return [];
      return [
        {
          ...c,
          is_deleted: true,
          content: null,
          author: null,
          placeholder: "该评论已删除",
          children: alive,
        },
      ];
    }
    if (c.children?.some((k) => k.id === id)) {
      const children = c.children.filter((k) => k.id !== id);
      // 占位行仅剩已删除子回复时连占位一起摘走，否则留下孤行。
      if (isGoneComment(c) && !children.some((k) => !isGoneComment(k))) return [];
      return [{ ...c, children }];
    }
    return [c];
  });

// 渲染行展开：已删除/被折叠且没有存活子回复的评论不单独占行（由列表末尾
// 「N 条评论已删除」合并行交代）；仍有存活子回复的保留占位行，否则子回复
// 会成孤儿。
const flattenVisibleComments = (list: CommentNode[]): CommentNode[] =>
  list.flatMap((c) => {
    const aliveChildren = (c.children ?? []).filter((k) => !isGoneComment(k));
    if (isGoneComment(c) && !aliveChildren.length) return [];
    return [c, ...aliveChildren];
  });

// 「N 条评论已删除」合并行的 N：因删除/折叠而不再单独占行的条数（无存活
// 子回复的那些）。自己删除的评论本地已整条摘除、刷新后也按 author_id 排除，
// 不计入；仍带存活子回复的占位行有自己的行位，也不计入。
const mergedDeletedCount = (
  list: CommentNode[],
  selfId: number | null
): number =>
  list.reduce((n, c) => {
    const hasAliveChild = (c.children ?? []).some((k) => !isGoneComment(k));
    const hidden =
      isGoneComment(c) && !hasAliveChild && c.author_id !== selfId ? 1 : 0;
    return n + hidden + mergedDeletedCount(c.children ?? [], selfId);
  }, 0);

// 评论计数口径 = 可见且未删除/未折叠的评论数（与服务端 comment_count 一致）：
// 「该评论已删除」占位行与合并行仍渲染但不计入；收起/展开两态共用同一数值。
const visibleCommentCount = (list: CommentNode[]): number =>
  list.reduce(
    (n, c) => n + (isGoneComment(c) ? 0 : 1) + visibleCommentCount(c.children ?? []),
    0
  );

// 已加载时按评论树统计非删除节点；未加载时回落服务端冗余列。
const displayCommentCount = (
  a: Answer,
  cs: CommentNode[] | "loading" | undefined
) => (Array.isArray(cs) ? visibleCommentCount(cs) : a.comment_count);

export function Question() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const loginNext = `/login?next=${encodeURIComponent(
    location.pathname + location.search
  )}`;
  // push 进站并标记 returnTo：登录成功后 Login 用 navigate(-1) 落回本条目，
  // 「后退一次」能越过本页回到上一页（详见 Login.tsx）。
  const loginState = {
    returnTo: location.pathname + location.search,
    pushed: true,
  };

  const [question, setQuestion] = useState<QuestionType | null>(null);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [error, setError] = useState("");
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);

  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // 回答草稿按问题落 localStorage：进入/切换问题时恢复，输入防抖写回，清空即删键。
  const draftKey = `zhihu_answer_draft:q${id}`;
  useEffect(() => {
    try {
      setDraft(localStorage.getItem(draftKey) ?? "");
    } catch {
      setDraft("");
    }
  }, [draftKey]);
  useEffect(() => {
    const t = window.setTimeout(() => {
      try {
        if (draft.trim()) localStorage.setItem(draftKey, draft);
        else localStorage.removeItem(draftKey);
      } catch {
        // localStorage 不可用时退化为纯内存草稿，不打断输入。
      }
    }, 400);
    return () => window.clearTimeout(t);
  }, [draft, draftKey]);

  const [following, setFollowing] = useState<boolean | null>(null);
  const [followPending, setFollowPending] = useState(false);
  // 回答作者行「+ 关注」：按作者 id 记本地覆盖态（同一作者多张卡联动）；
  // 初始值来自 answer.author.is_following（登录态由列表接口批量回带）。
  const [authorFollows, setAuthorFollows] = useState<Record<number, boolean>>({});
  const [authorFollowPending, setAuthorFollowPending] = useState<
    Record<number, boolean>
  >({});
  const [votes, setVotes] = useState<Record<number, number>>({});
  const [votePending, setVotePending] = useState<Record<number, boolean>>({});
  const [openComments, setOpenComments] = useState<Record<number, boolean>>({});
  const [comments, setComments] = useState<Record<number, CommentNode[] | "loading">>({});
  const [commentsError, setCommentsError] = useState<Record<number, string>>({});
  const [commentDrafts, setCommentDrafts] = useState<Record<number, string>>({});
  const [commentSending, setCommentSending] = useState<Record<number, boolean>>({});
  const [favFor, setFavFor] = useState<number | null>(null);
  const [collections, setCollections] = useState<CollectionItem[] | null>(null);
  const [favNewName, setFavNewName] = useState("");
  const [favBusy, setFavBusy] = useState(false);
  const [uncollecting, setUncollecting] = useState<Record<number, boolean>>({});

  // 回答分页：detail 首屏 5 条视为第 0 页，之后走 /questions/:id/answers 分页接口
  const [sort, setSort] = useState<AnswerSort>(() => readSort(location.search));
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [moreLoading, setMoreLoading] = useState(false);
  const [moreError, setMoreError] = useState("");
  const [sortLoading, setSortLoading] = useState(false);
  const [newId, setNewId] = useState<number | null>(null);
  // URL #answer-N 深链命中的回答：滚动定位后短暂高亮（anchorDoneRef 按 hash 去重）。
  const [anchorId, setAnchorId] = useState<number | null>(null);
  // 补页拉尽仍未找到目标：底部轻量提示条（「该回答可能已被删除 · 回到顶部」）。
  const [anchorMiss, setAnchorMiss] = useState(false);
  const anchorDoneRef = useRef<string | null>(null);
  // anchorSeenRef 记当前在处理哪个 hash（换 hash 时复位补页计数/提示）；
  // anchorFetchRef 记本 hash 已自动补页次数；anchorTimerRef 存高亮淡出定时器
  // （挂 ref 而非 effect cleanup：answers 重建触发的重跑不会误清淡出定时器）。
  const anchorSeenRef = useRef<string | null>(null);
  const anchorFetchRef = useRef(0);
  const anchorTimerRef = useRef(0);
  // 本人在本问题下的回答（detail 的 my_answers）：固定条独立成栏，不进排序列表。
  const [myAnswers, setMyAnswers] = useState<Answer[]>([]);
  const [confirmDelId, setConfirmDelId] = useState<number | null>(null);
  const [delPending, setDelPending] = useState<Record<number, boolean>>({});
  // 回答卡「⋯」菜单 / 内联编辑 / 卡内删除确认条（confirmDelId 是固定条的确认态，互不影响）。
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [cardConfirmDelId, setCardConfirmDelId] = useState<number | null>(null);
  const [confirmDelCommentId, setConfirmDelCommentId] = useState<number | null>(null);
  const [commentDelPending, setCommentDelPending] = useState<Record<number, boolean>>({});
  // 评论「回复」内联表单：replyFor=展开中的父评论 id（全局同一时刻只开一个）。
  const [replyFor, setReplyFor] = useState<number | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [replySending, setReplySending] = useState(false);
  const [replyError, setReplyError] = useState("");
  // replyFor 的 ref 镜像：removeComment 的 await 往返后要比对「当前」表单归属，
  // 不能信发起那一帧的闭包值（期间用户可能已把表单切到别的评论）。
  const replyForRef = useRef<number | null>(null);
  useEffect(() => {
    replyForRef.current = replyFor;
  }, [replyFor]);
  const answersReq = useRef(0);

  // sort / sortLoading 都留一份 ref 影子值：effect 和 promise 回调里要读
  // 「已生效」的最新值，闭包里的 state 是发请求那一帧的。写它们一律走 sync*。
  const sortRef = useRef(sort);
  const sortLoadingRef = useRef(false);
  const syncSort = (s: AnswerSort) => {
    sortRef.current = s;
    setSort(s);
  };
  const syncSortLoading = (v: boolean) => {
    sortLoadingRef.current = v;
    setSortLoading(v);
  };
  // 「这个问题 + 这个排序」在 URL 驱动路径上失败过的指纹：effect 对账命中即
  // 跳过并纠回地址栏，不在同一次失败上自激重试；按钮（syncUrl）路径不受拦。
  const sortFailedKeyRef = useRef<string | null>(null);

  const editorRef = useRef<HTMLTextAreaElement>(null);
  const editorBoxRef = useRef<HTMLElement>(null);

  const answersUrl = (s: AnswerSort, p: number) =>
    `/questions/${id}/answers?sort=${s}&page=${p}&limit=${ANSWER_PAGE_SIZE}`;

  const load = useCallback(() => {
    const seq = ++answersReq.current;
    const wanted = readSort(window.location.search);
    setLoading(true);
    setNotFound(false);
    syncSort(wanted);
    setPage(0);
    setHasMore(false);
    setMoreLoading(false);
    syncSortLoading(false);
    setMoreError("");
    setNewId(null);
    setMyAnswers([]);
    setConfirmDelId(null);
    setMenuFor(null);
    setEditingId(null);
    setEditSaving(false);
    setCardConfirmDelId(null);
    setConfirmDelCommentId(null);
    resetReplyState();
    get<{ question: QuestionType; answers: Answer[]; my_answers?: Answer[] }>(
      `/questions/${id}`
    )
      .then((d) => {
        if (seq !== answersReq.current) return;
        setQuestion(d.question);
        setFollowing(Boolean(d.question.followed));
        setMyAnswers(d.my_answers ?? []);
        setError("");
        if (wanted === "default") {
          setAnswers(d.answers);
          setHasMore(d.question.answer_count > d.answers.length);
          return;
        }
        // ?sort=new 深链/刷新：detail 只给默认序首屏，最新序另取分页第 1 页
        return get<Page<Answer>>(
          `/questions/${id}/answers?sort=newest&page=1&limit=${ANSWER_PAGE_SIZE}`
        ).then((res) => {
          if (seq !== answersReq.current) return;
          setAnswers(res.items);
          setPage(1);
          setHasMore(res.has_more);
        });
      })
      .catch((e) => {
        if (seq !== answersReq.current) return;
        if (isContentMissing(e)) setNotFound(true);
        else setError(e.message);
      })
      .finally(() => {
        if (seq !== answersReq.current) return;
        setLoading(false);
      });
  }, [id]);

  useEffect(load, [load]);

  const loadMoreAnswers = () => {
    if (moreLoading || sortLoading || !hasMore) return;
    const seq = answersReq.current;
    const next = page + 1;
    setMoreLoading(true);
    setMoreError("");
    get<Page<Answer>>(answersUrl(sort, next))
      .then((res) => {
        if (seq !== answersReq.current) return;
        setAnswers((prev) => {
          const seen = new Set(prev.map((a) => a.id));
          return [...prev, ...res.items.filter((a) => !seen.has(a.id))];
        });
        setPage(next);
        setHasMore(res.has_more);
      })
      .catch((e: Error) => {
        if (seq !== answersReq.current) return;
        setMoreError(e.message || "加载更多失败");
      })
      .finally(() => {
        if (seq !== answersReq.current) return;
        setMoreLoading(false);
      });
  };

  // 切排序：syncUrl 时把状态写进 ?sort=（replace，不污染历史）；失败回滚
  // {sort,page,hasMore} 三态（answers 未动过，旧列表与旧分页态一致）。
  const applySort = (next: AnswerSort, syncUrl: boolean) => {
    if (next === sortRef.current) return;
    // URL 同步调用不抢在途排序请求：等它落地后由落地对账收敛（见 finally）。
    if (sortLoadingRef.current && !syncUrl) return;
    const seq = ++answersReq.current;
    const prev = { sort: sortRef.current, page, hasMore };
    syncSort(next);
    if (syncUrl) {
      navigate(
        { pathname: location.pathname, search: sortSearch(next) },
        { replace: true }
      );
    }
    setPage(0);
    setHasMore(false);
    setMoreLoading(false);
    setMoreError("");
    syncSortLoading(true);
    get<Page<Answer>>(answersUrl(next, 1))
      .then((res) => {
        if (seq !== answersReq.current) return;
        sortFailedKeyRef.current = null;
        // 排序成功落地后再丢草稿/表单：失败回滚时列表没变，不该清空用户输入。
        resetReplyState();
        setAnswers(res.items);
        setPage(1);
        setHasMore(res.has_more);
      })
      .catch((e: Error) => {
        if (seq !== answersReq.current) return;
        sortFailedKeyRef.current = `${id}|${next}`;
        syncSort(prev.sort);
        setPage(prev.page);
        setHasMore(prev.hasMore);
        // 失败回滚必须连地址栏一起纠正（URL 驱动路径也要）：地址栏停在
        // 拉不动的 ?sort= 上会让 effect 对账永远 readSort!=sort，自激成
        // 无限重试 + 重复弹错。
        navigate(
          { pathname: location.pathname, search: sortSearch(prev.sort) },
          { replace: true }
        );
        toast(`切换排序失败：${e.message || "网络错误"}`, "error");
      })
      .finally(() => {
        if (seq !== answersReq.current) return;
        syncSortLoading(false);
        // 落地时补一次对账：在途期间 URL 可能被后退/前进又改过，而 loading
        // 守卫把当时的 effect 跳过了——这里收敛到当前地址栏想要的排序。
        const wanted = readSort(window.location.search);
        if (wanted !== sortRef.current) applySort(wanted, false);
      });
  };

  const switchSort = (next: AnswerSort) => {
    if (next === sort || sortLoading) return;
    applySort(next, true);
  };

  // 前进/后退或直接改 ?sort= 时跟随 URL（与 seg 点击共用同一条加载路径）。
  // 只对「已加载的就是当前路由问题」做排序对账：跨问题导航（含 search 变化）
  // 由 load 全权负责——load 自己按 window.location.search 取数并复位 loading。
  // 否则这里会用旧闭包（loading===false、question 还是旧问题）调用 applySort，
  // 抢走 answersReq 序号：detail 响应被丢弃、loading 永不复位、页面卡 Spinner。
  const searchKey = location.search;
  useEffect(() => {
    if (loading || !question || String(question.id) !== id) return;
    const wanted = readSort(searchKey);
    // 同一「问题|排序」刚失败过：不再自激重试；但把地址栏纠回当前生效的
    // 排序，保证 URL 与按钮选中态一致（按钮手动重试走 syncUrl，不受此拦）。
    if (sortFailedKeyRef.current === `${id}|${wanted}`) {
      if (sortRef.current !== wanted) {
        navigate(
          { pathname: location.pathname, search: sortSearch(sortRef.current) },
          { replace: true }
        );
      }
      return;
    }
    applySort(wanted, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchKey, loading, question, id]);

  // 「⋯」菜单：点外部或 Esc 收起。
  useEffect(() => {
    if (menuFor === null) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(".answer__more")) setMenuFor(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuFor(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuFor]);

  // 刚发布的回答：本地置顶后滚动定位 + 短暂高亮
  useEffect(() => {
    if (newId === null) return;
    document
      .getElementById(`answer-${newId}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
    const t = window.setTimeout(() => setNewId(null), 2400);
    return () => window.clearTimeout(t);
  }, [newId]);

  const answerIdsKey = answers.map((a) => a.id).join(",");
  // hash 指向的目标 answer id：渲染期同步解析——「你的回答」固定条在目标
  // 不在列表时兜底渲染 id="answer-N"，锚点 effect 用 getElementById 找它。
  const anchorAid = (() => {
    const m = /^#answer-(\d+)$/.exec(location.hash);
    return m ? Number(m[1]) : null;
  })();

  // 深链 #answer-N：目标已在 DOM（列表项或「你的回答」固定条兜底项）→
  // 滚动定位 + 2s 高亮；不在 → 按当前排序自动补页（上限 ANCHOR_MAX_FETCH 页），
  // 每页落地后本 effect 重跑再判；拉尽/到上限仍找不到 → anchorMiss 轻量提示。
  // 只依赖 hash、id 集合与加载态——投票/评论重建 answers 不重复滚动。
  useEffect(() => {
    const hash = location.hash;
    const m = /^#answer-(\d+)$/.exec(hash);
    if (!m) {
      anchorDoneRef.current = null;
      anchorSeenRef.current = null;
      anchorFetchRef.current = 0;
      setAnchorMiss(false);
      return;
    }
    if (anchorSeenRef.current !== hash) {
      anchorSeenRef.current = hash;
      anchorFetchRef.current = 0;
      setAnchorMiss(false);
    }
    if (anchorDoneRef.current === hash) return;
    // detail/排序/补页在途时 DOM 还会变，等落地后本 effect 随依赖变更再跑。
    if (loading || sortLoading || moreLoading) return;
    const aid = Number(m[1]);
    const el = document.getElementById(`answer-${aid}`);
    if (el) {
      anchorDoneRef.current = hash;
      setAnchorMiss(false);
      el.scrollIntoView({ block: "start" });
      setAnchorId(aid);
      window.clearTimeout(anchorTimerRef.current);
      anchorTimerRef.current = window.setTimeout(() => setAnchorId(null), 2000);
      return;
    }
    if (hasMore && anchorFetchRef.current < ANCHOR_MAX_FETCH) {
      anchorFetchRef.current += 1;
      loadMoreAnswers();
      return;
    }
    // 找不到不记 done：此后手动「加载更多」若把目标拉进 DOM，仍能补定位。
    setAnchorMiss(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadMoreAnswers 每次渲染重建，进 deps 会让补页自激
  }, [location.hash, answerIdsKey, loading, sortLoading, moreLoading, hasMore]);

  // 高亮淡出定时器与提示条自动收起：组件卸载时清掉，避免 stray setState。
  useEffect(() => () => window.clearTimeout(anchorTimerRef.current), []);
  useEffect(() => {
    if (!anchorMiss) return;
    const t = window.setTimeout(() => setAnchorMiss(false), 8000);
    return () => window.clearTimeout(t);
  }, [anchorMiss]);

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
    navigate(loginNext, { state: loginState });
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

  // 登录身份切换（登出/换号）时清掉按旧身份记的作者关注覆盖态，
  // 让按钮回落到服务端 is_following 口径。
  const userId = user?.id ?? null;
  useEffect(() => {
    setAuthorFollows({});
    setAuthorFollowPending({});
  }, [userId]);

  const authorFollowed = (a: Answer) =>
    authorFollows[a.author.id] ?? Boolean(a.author.is_following);

  const toggleAuthorFollow = async (a: Answer) => {
    if (!user) return needLogin();
    const uid = a.author.id;
    if (uid === user.id || authorFollowPending[uid]) return;
    setAuthorFollowPending((p) => ({ ...p, [uid]: true }));
    const was = authorFollowed(a);
    setAuthorFollows((m) => ({ ...m, [uid]: !was }));
    try {
      const r = was ? await unfollowUser(uid) : await followUser(uid);
      setAuthorFollows((m) => ({ ...m, [uid]: r.following }));
      toast(r.following ? "已关注" : "已取消关注");
    } catch (e) {
      setAuthorFollows((m) => ({ ...m, [uid]: was }));
      toast((e as Error).message, "error");
    } finally {
      setAuthorFollowPending((p) => ({ ...p, [uid]: false }));
    }
  };

  const writeAnswer = () => {
    if (!user) {
      toast("登录后即可回答");
      navigate(loginNext, { state: loginState });
      return;
    }
    editorBoxRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    editorRef.current?.focus();
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
    if (!body || commentSending[a.id]) return;
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
      bumpCommentCount(a.id, 1);
      toast("评论已发布");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setCommentSending((s) => ({ ...s, [a.id]: false }));
    }
  };

  // 「回复」入口：未登录按站内写操作惯例跳登录；登录则在目标评论下方开/切
  // 内联表单（切换目标时重置草稿与错误，同一时刻只保留一个表单）。
  const toggleReplyForm = (c: CommentNode) => {
    if (!user) return needLogin();
    setConfirmDelCommentId(null);
    setReplyError("");
    // 切到另一条评论时草稿被静默丢弃，补一条提示（同一条收起不提示）。
    // 属信息告知而非错误：info 级。
    if (replyFor !== null && replyFor !== c.id && replyDraft.trim()) {
      toast("已放弃上一条未发送的回复", "info");
    }
    setReplyDraft("");
    setReplyFor((cur) => (cur === c.id ? null : c.id));
  };

  const closeReplyForm = () => {
    setReplyFor(null);
    setReplyDraft("");
    setReplyError("");
  };

  // 列表/排序整体重置时的回复表单收尾：三态一起清（漏清 replyDraft 会让旧草稿
  // 串进下一条评论的表单）。确有未提交草稿被放弃时给一条 info 提示。
  const resetReplyState = () => {
    if (replyFor !== null && replyDraft.trim()) {
      toast("已放弃未提交的回复草稿", "info");
    }
    setReplyFor(null);
    setReplyDraft("");
    setReplyError("");
  };

  // 二级回复提交：成功后乐观挂到父评论 children 末尾、计数 +1、收起表单。
  // 失败时错误落在表单内（role=alert），不关表单、不丢草稿。
  const submitReply = async (a: Answer, parent: CommentNode) => {
    const body = replyDraft.trim();
    if (!body || replySending) return;
    setReplySending(true);
    setReplyError("");
    try {
      const { comment } = await post<{ comment: CommentNode }>("/comments", {
        target_type: "answer",
        target_id: a.id,
        parent_id: parent.id,
        body,
      });
      setComments((cs) => {
        const list = cs[a.id];
        if (!Array.isArray(list)) return cs;
        return {
          ...cs,
          [a.id]: (list as CommentNode[]).map((c) =>
            c.id === parent.id
              ? { ...c, children: [...(c.children ?? []), comment] }
              : c
          ),
        };
      });
      bumpCommentCount(a.id, 1);
      closeReplyForm();
      toast("回复已发布");
    } catch (e) {
      setReplyError((e as Error).message || "回复失败，请重试");
    } finally {
      setReplySending(false);
    }
  };

  // 评论计数同步改两处：回答列表与「你的回答」固定条展示的是同一条 answer。
  const bumpCommentCount = (answerId: number, delta: number) => {
    const bump = (xs: Answer[]) =>
      xs.map((x) =>
        x.id === answerId
          ? { ...x, comment_count: Math.max(0, x.comment_count + delta) }
          : x
      );
    setAnswers(bump);
    setMyAnswers(bump);
  };

  const startEdit = (a: Answer) => {
    setMenuFor(null);
    setCardConfirmDelId(null);
    setEditingId(a.id);
    setEditDraft(a.content_md);
  };

  const saveEdit = async (a: Answer) => {
    if (editSaving || !editDraft.trim()) return;
    setEditSaving(true);
    try {
      const { answer } = await patch<{ answer: Answer }>(`/answers/${a.id}`, {
        content_md: editDraft,
      });
      const apply = (xs: Answer[]) =>
        xs.map((x) => (x.id === a.id ? { ...x, ...answer } : x));
      setAnswers(apply);
      setMyAnswers(apply);
      setEditingId(null);
      toast("已保存");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setEditSaving(false);
    }
  };

  const setAnswerCollected = (answerId: number, val: boolean) =>
    setAnswers((xs) => xs.map((x) => (x.id === answerId ? { ...x, is_collected: val } : x)));

  const toggleFav = async (answerId: number) => {
    if (!user) return needLogin();
    if (favFor === answerId) {
      setFavFor(null);
      return;
    }
    setFavFor(answerId);
    setFavNewName("");
    setCollections(null);
    try {
      const d = await get<{ collections: CollectionItem[] }>(
        `/collections?answer_id=${answerId}`
      );
      setCollections(d.collections);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const collect = async (c: CollectionItem, answerId: number) => {
    if (favBusy) return;
    setFavBusy(true);
    try {
      const was = Boolean(c.has_item);
      const d = was
        ? await del<{ collected: boolean }>(`/collections/${c.id}/items/${answerId}`)
        : await post<{ collected: boolean }>(`/collections/${c.id}/items`, {
            answer_id: answerId,
          });
      setCollections((cs) =>
        (cs ?? []).map((x) =>
          x.id === c.id
            ? { ...x, has_item: was ? 0 : 1, item_count: Math.max(0, x.item_count + (was ? -1 : 1)) }
            : x
        )
      );
      setAnswerCollected(answerId, was ? d.collected : true);
      toast(was ? "已取消收藏" : `已收藏到「${c.name}」`);
      if (!was) setFavFor(null);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setFavBusy(false);
    }
  };

  const createAndCollect = async (answerId: number) => {
    const name = favNewName.trim();
    if (!name || favBusy) return;
    setFavBusy(true);
    try {
      const { collection } = await post<{ collection: CollectionItem }>("/collections", {
        name,
        is_public: false,
      });
      await post(`/collections/${collection.id}/items`, { answer_id: answerId });
      setCollections((cs) => [
        { ...collection, item_count: 1, has_item: 1 },
        ...(cs ?? []),
      ]);
      setAnswerCollected(answerId, true);
      setFavNewName("");
      setFavFor(null);
      toast(`已收藏到「${collection.name}」`);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setFavBusy(false);
    }
  };

  // 「已收藏」再点一次 = 从当前用户所有收藏夹移除该回答。
  const uncollect = async (answerId: number) => {
    if (!user) return needLogin();
    if (uncollecting[answerId]) return;
    setUncollecting((u) => ({ ...u, [answerId]: true }));
    try {
      const d = await get<{ collections: CollectionItem[] }>(
        `/collections?answer_id=${answerId}`
      );
      let still = false;
      for (const c of d.collections.filter((x) => x.has_item)) {
        const r = await del<{ collected: boolean }>(`/collections/${c.id}/items/${answerId}`);
        still = r.collected;
      }
      setAnswerCollected(answerId, still);
      setCollections((cs) =>
        (cs ?? []).map((x) => (x.has_item ? { ...x, has_item: 0, item_count: Math.max(0, x.item_count - 1) } : x))
      );
      toast("已取消收藏");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setUncollecting((u) => ({ ...u, [answerId]: false }));
    }
  };

  // 「你的回答」固定条删除入口：软删除后两侧列表同步摘除、页头计数 -1。
  const removeAnswer = async (a: Answer) => {
    if (delPending[a.id]) return;
    setDelPending((d) => ({ ...d, [a.id]: true }));
    try {
      await del(`/answers/${a.id}`);
      setAnswers((xs) => xs.filter((x) => x.id !== a.id));
      setMyAnswers((xs) => xs.filter((x) => x.id !== a.id));
      setQuestion((q) =>
        q ? { ...q, answer_count: Math.max(0, q.answer_count - 1) } : q
      );
      setConfirmDelId(null);
      setCardConfirmDelId(null);
      setMenuFor(null);
      if (editingId === a.id) setEditingId(null);
      toast("回答已删除");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setDelPending((d) => ({ ...d, [a.id]: false }));
    }
  };

  // 删除自己的评论：软删后从评论树摘除并把卡片上「N 条评论」-1。
  const removeComment = async (a: Answer, c: CommentNode) => {
    if (commentDelPending[c.id]) return;
    setCommentDelPending((d) => ({ ...d, [c.id]: true }));
    try {
      await del(`/comments/${c.id}`);
      setComments((cs) => {
        const list = cs[a.id];
        if (!Array.isArray(list)) return cs;
        return { ...cs, [a.id]: dropComment(list, c.id) };
      });
      bumpCommentCount(a.id, -1);
      setConfirmDelCommentId(null);
      // 有子回复的一级评论删除后降级为占位行，挂在它下面的回复表单必须一并
      // 关掉——占位行没有「回复」入口，留着表单提交只会被服务端拒。
      // 比对 ref 里的「当前」归属而非发起删除那一帧的闭包值：往返期间用户若已
      // 把表单切到别的评论，绝不能误关新表单、丢掉里面的草稿。
      if (replyForRef.current === c.id) closeReplyForm();
      toast("评论已删除");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setCommentDelPending((d) => ({ ...d, [c.id]: false }));
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
      setAnswers((xs) => [answer, ...xs.filter((x) => x.id !== answer.id)]);
      setMyAnswers((xs) => [answer, ...xs.filter((x) => x.id !== answer.id)]);
      setQuestion((q) => (q ? { ...q, answer_count: q.answer_count + 1 } : q));
      setNewId(answer.id);
      setDraft("");
      try {
        localStorage.removeItem(draftKey);
      } catch {
        // 忽略
      }
      toast("回答已发布");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <Spinner />;
  if (notFound) return <NotFound />;
  if (error) return <NotFound kind="error" detail={error} onRetry={load} />;
  if (!question) return <NotFound />;

  return (
    <article className="question">
      {question.topics.length > 0 && (
        <div className="question__topics">
          {question.topics.map((t) => (
            <Link key={t.id} to={`/topic/${t.slug || t.id}`} className="tag">
              {t.name}
            </Link>
          ))}
        </div>
      )}
      <h1 className="question__title">{question.title}</h1>
      {question.detail_md && (
        <Markdown source={question.detail_md} className="question__detail prose" />
      )}
      <div className="question__meta">
        <Link to={`/u/${question.author.id}`}>{question.author.nickname}</Link>
        <span>提问于 {formatTime(question.created_at)}</span>
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
        <div className="answers__head">
          <h2 className="answers__count">{question.answer_count} 个回答</h2>
          {question.answer_count > 0 && (
            <div className="answers__sort" role="group" aria-label="回答排序">
              {ANSWER_SORTS.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  className={`answers__sort-btn${
                    sort === s.key ? " answers__sort-btn--active" : ""
                  }`}
                  aria-pressed={sort === s.key}
                  disabled={sortLoading}
                  onClick={() => switchSort(s.key)}
                >
                  {s.label}
                </button>
              ))}
              {sortLoading && <span className="answers__sort-hint">加载中…</span>}
            </div>
          )}
        </div>
        {!user && (
          <p className="answers__login-hint">
            登录后即可回答 · 已有 {question.answer_count} 条回答
            <Link to={loginNext} state={loginState} className="answers__login-cta">
              去登录
            </Link>
          </p>
        )}
        {myAnswers.length > 0 && (
          <section className="myanswers" aria-label="你的回答">
            <h3 className="myanswers__title">你的回答</h3>
            <ul className="myanswers__list">
              {myAnswers.map((a) => {
                const inList = answers.some((x) => x.id === a.id);
                return (
                  <li
                    key={a.id}
                    className={`myanswers__item${
                      a.id === anchorId ? " answer--anchor" : ""
                    }`}
                    // 深链兜底：目标是本人回答且尚未加载进列表时，固定条顶替
                    // 渲染 id="answer-N"（在列表里则不重复 id，避免 DOM id 冲突）。
                    id={!inList && anchorAid === a.id ? `answer-${a.id}` : undefined}
                  >
                    <div className="myanswers__body">
                      <p className="myanswers__excerpt">
                        {answerExcerpt(a.content_md)}
                      </p>
                      <p className="myanswers__meta">
                        {a.vote_up} 赞同 · {a.comment_count} 评论 · 发布于{" "}
                        {formatTime(a.created_at)}
                      </p>
                    </div>
                    <div className="myanswers__ops">
                      {inList && (
                        <button
                          type="button"
                          className="myanswers__op"
                          onClick={() =>
                            document
                              .getElementById(`answer-${a.id}`)
                              ?.scrollIntoView({
                                behavior: "smooth",
                                block: "start",
                              })
                          }
                        >
                          定位
                        </button>
                      )}
                      {confirmDelId === a.id ? (
                        <>
                          <button
                            type="button"
                            className="myanswers__op myanswers__op--danger"
                            disabled={delPending[a.id]}
                            onClick={() => void removeAnswer(a)}
                          >
                            {delPending[a.id] ? "删除中…" : "确认删除"}
                          </button>
                          <button
                            type="button"
                            className="myanswers__op"
                            disabled={delPending[a.id]}
                            onClick={() => setConfirmDelId(null)}
                          >
                            取消
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="myanswers__op"
                          onClick={() => setConfirmDelId(a.id)}
                        >
                          删除
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        {answers.length === 0 ? (
          <Empty title="还没有回答" hint="写下第一个回答，帮提问的人一把" />
        ) : (
          <ul className="answerlist">
            {answers.map((a) => {
              const my = votes[a.id] ?? 0;
              const cs = comments[a.id];
              const commentRows = Array.isArray(cs)
                ? flattenVisibleComments(cs)
                : [];
              const mergedCount = Array.isArray(cs)
                ? mergedDeletedCount(cs, user?.id ?? null)
                : 0;
              return (
                <li
                  key={a.id}
                  className={`answer${a.id === newId ? " answer--new" : ""}${
                    a.id === anchorId ? " answer--anchor" : ""
                  }`}
                  id={`answer-${a.id}`}
                >
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
                    {(!user || a.author.id !== user.id) && (
                      <button
                        type="button"
                        className={`answer__follow${
                          authorFollowed(a) ? " answer__follow--on" : ""
                        }`}
                        disabled={authorFollowPending[a.author.id]}
                        aria-pressed={authorFollowed(a)}
                        title={authorFollowed(a) ? "取消关注" : undefined}
                        onClick={() => void toggleAuthorFollow(a)}
                      >
                        {authorFollowed(a) ? "已关注" : "+ 关注"}
                      </button>
                    )}
                    {user && a.author.id === user.id && (
                      <div className="answer__more">
                        <button
                          type="button"
                          className="answer__more-btn"
                          aria-label="更多操作"
                          aria-expanded={menuFor === a.id}
                          onClick={() =>
                            setMenuFor((m) => (m === a.id ? null : a.id))
                          }
                        >
                          ⋯
                        </button>
                        {menuFor === a.id && (
                          <div className="answer__more-menu" role="menu">
                            <button
                              type="button"
                              role="menuitem"
                              className="answer__more-item"
                              onClick={() => startEdit(a)}
                            >
                              编辑
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              className="answer__more-item answer__more-item--danger"
                              onClick={() => {
                                setMenuFor(null);
                                setEditingId(null);
                                setCardConfirmDelId(a.id);
                              }}
                            >
                              删除
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  {editingId === a.id ? (
                    <div className="answer__edit">
                      <MarkdownEditor
                        rows={6}
                        aria-label="编辑回答"
                        value={editDraft}
                        onChange={(e) => setEditDraft(e.target.value)}
                      />
                      <div className="answer__edit-actions">
                        <Button
                          onClick={() => void saveEdit(a)}
                          disabled={editSaving || !editDraft.trim()}
                        >
                          {editSaving ? "保存中…" : "保存"}
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={editSaving}
                          onClick={() => setEditingId(null)}
                        >
                          取消
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Markdown source={a.content_md} className="answer__body prose" />
                  )}
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
                      {openComments[a.id]
                        ? `收起评论（${displayCommentCount(a, cs)}）`
                        : `${displayCommentCount(a, cs)} 条评论`}
                    </button>
                    <div className="answer__fav">
                      <button
                        type="button"
                        className={`answer__action${
                          a.is_collected ? " answer__action--collected" : ""
                        }`}
                        aria-pressed={Boolean(a.is_collected)}
                        disabled={uncollecting[a.id]}
                        onClick={() => (a.is_collected ? uncollect(a.id) : toggleFav(a.id))}
                      >
                        {a.is_collected ? "已收藏" : "收藏"}
                      </button>
                      {favFor === a.id && (
                        <div className="answer__fav-menu" role="menu">
                          {collections === null ? (
                            <p className="answer__fav-empty">加载中…</p>
                          ) : (
                            <>
                              {collections.length === 0 && (
                                <p className="answer__fav-empty">
                                  还没有收藏夹，先建一个吧
                                </p>
                              )}
                              {collections.map((c) => (
                                <button
                                  key={c.id}
                                  type="button"
                                  className={`answer__fav-item${
                                    c.has_item ? " answer__fav-item--on" : ""
                                  }`}
                                  disabled={favBusy}
                                  onClick={() => collect(c, a.id)}
                                >
                                  <span className="answer__fav-name">
                                    {c.name}（{c.item_count}）
                                  </span>
                                  {c.has_item ? (
                                    <span className="answer__fav-check" aria-label="已在此收藏夹">
                                      ✓
                                    </span>
                                  ) : null}
                                </button>
                              ))}
                              <div className="answer__fav-new">
                                <input
                                  type="text"
                                  className="answer__fav-input"
                                  maxLength={50}
                                  placeholder="新建收藏夹"
                                  aria-label="新建收藏夹名称"
                                  value={favNewName}
                                  onChange={(e) => setFavNewName(e.target.value)}
                                />
                                <button
                                  type="button"
                                  className="answer__fav-create"
                                  disabled={favBusy || !favNewName.trim()}
                                  onClick={() => createAndCollect(a.id)}
                                >
                                  创建并收藏
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                    <button type="button" className="answer__action" onClick={() => share(a)}>
                      分享
                    </button>
                    <span className="answer__date">发布于 {formatTime(a.created_at)}</span>
                  </div>
                  {cardConfirmDelId === a.id && (
                    <div className="answer__del-confirm" role="alert">
                      <span className="answer__del-confirm-text">
                        删除后不可恢复
                      </span>
                      <button
                        type="button"
                        className="answer__del-confirm-btn answer__del-confirm-btn--danger"
                        disabled={delPending[a.id]}
                        onClick={() => void removeAnswer(a)}
                      >
                        {delPending[a.id] ? "删除中…" : "确认删除"}
                      </button>
                      <button
                        type="button"
                        className="answer__del-confirm-btn"
                        disabled={delPending[a.id]}
                        onClick={() => setCardConfirmDelId(null)}
                      >
                        取消
                      </button>
                    </div>
                  )}
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
                          {commentRows.length === 0 && mergedCount === 0 ? (
                            <p className="answer__comment-empty">还没有评论，来说两句吧</p>
                          ) : (
                            <ul className="answer__comment-list">
                              {commentRows
                                .map((c) => {
                                  const cName = c.author
                                    ? c.author.nickname
                                    : "已注销用户";
                                  // 回复只挂一级未删评论（后端只支持两级）；删除仍限本人。
                                  const canReply = c.parent_id == null && !isGoneComment(c);
                                  const canDelete = Boolean(
                                    user && c.author && c.author.id === user.id && !isGoneComment(c)
                                  );
                                  return (
                                  <li
                                    key={c.id}
                                    className={`answer__comment${
                                      c.parent_id ? " answer__comment--child" : ""
                                    }`}
                                  >
                                    <div className="answer__comment-head">
                                      <span className="answer__comment-name">
                                        {cName}
                                      </span>
                                      <span className="answer__comment-time">
                                        {formatTime(c.created_at)}
                                      </span>
                                      {(canReply || canDelete) && (
                                        <span className="answer__comment-ops">
                                          {canReply && (
                                            <button
                                              type="button"
                                              className="answer__comment-op"
                                              aria-label={`回复 ${cName} 的评论`}
                                              aria-expanded={replyFor === c.id}
                                              aria-controls={`reply-slot-${c.id}`}
                                              onClick={() => toggleReplyForm(c)}
                                            >
                                              回复
                                            </button>
                                          )}
                                          {canDelete &&
                                            (confirmDelCommentId === c.id ? (
                                              <>
                                                <button
                                                  type="button"
                                                  className="answer__comment-op answer__comment-op--danger"
                                                  disabled={commentDelPending[c.id]}
                                                  onClick={() => void removeComment(a, c)}
                                                >
                                                  {commentDelPending[c.id]
                                                    ? "删除中…"
                                                    : "确认删除"}
                                                </button>
                                                <button
                                                  type="button"
                                                  className="answer__comment-op"
                                                  disabled={commentDelPending[c.id]}
                                                  onClick={() =>
                                                    setConfirmDelCommentId(null)
                                                  }
                                                >
                                                  取消
                                                </button>
                                              </>
                                            ) : (
                                              <button
                                                type="button"
                                                className="answer__comment-op"
                                                onClick={() =>
                                                  setConfirmDelCommentId(c.id)
                                                }
                                              >
                                                删除
                                              </button>
                                            ))}
                                        </span>
                                      )}
                                    </div>
                                    <p
                                      className={`answer__comment-body${
                                        isGoneComment(c) ? " answer__comment-body--deleted" : ""
                                      }`}
                                    >
                                      {isGoneComment(c) ? c.placeholder ?? "该评论已删除" : c.content}
                                    </p>
                                    {canReply && (
                                      // 稳定存在的挂载槽：收起态「回复」按钮的 aria-controls
                                      // 始终指向它，展开时表单渲染在槽内。
                                      <div
                                        className="answer__reply-slot"
                                        id={`reply-slot-${c.id}`}
                                      >
                                        {replyFor === c.id && (
                                          <div
                                            className="answer__reply-form"
                                            id={`reply-form-${c.id}`}
                                            onKeyDown={(e) => {
                                              if (e.key === "Escape") closeReplyForm();
                                            }}
                                          >
                                            <Textarea
                                              autoFocus
                                              rows={2}
                                              maxLength={500}
                                              aria-label={`回复 ${cName}`}
                                              placeholder={`回复 ${cName}：`}
                                              value={replyDraft}
                                              onChange={(e) => setReplyDraft(e.target.value)}
                                            />
                                            {replyError && (
                                              <p className="answer__reply-error" role="alert">
                                                {replyError}
                                              </p>
                                            )}
                                            <div className="answer__reply-actions">
                                              <Button
                                                onClick={() => void submitReply(a, c)}
                                                disabled={replySending || !replyDraft.trim()}
                                              >
                                                {replySending ? "回复中…" : "回复"}
                                              </Button>
                                              <Button
                                                variant="ghost"
                                                disabled={replySending}
                                                onClick={closeReplyForm}
                                              >
                                                取消
                                              </Button>
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </li>
                                  );
                                })}
                              {mergedCount > 0 && (
                                <li
                                  className="answer__comment-merged"
                                  aria-label={`${mergedCount} 条评论已删除`}
                                >
                                  {mergedCount} 条评论已删除
                                </li>
                              )}
                            </ul>
                          )}
                          {user ? (
                            <div className="answer__comment-form">
                              <Textarea
                                rows={2}
                                maxLength={500}
                                aria-label="写下你的评论"
                                placeholder="写下你的评论…"
                                value={commentDrafts[a.id] ?? ""}
                                onChange={(e) =>
                                  setCommentDrafts((d) => ({ ...d, [a.id]: e.target.value }))
                                }
                                onKeyDown={(e) => {
                                  if (
                                    e.key === "Enter" &&
                                    !e.nativeEvent.isComposing
                                  ) {
                                    e.preventDefault();
                                    void submitComment(a);
                                  }
                                }}
                              />
                              <div className="answer__comment-actions">
                                <Button
                                  onClick={() => submitComment(a)}
                                  disabled={
                                    commentSending[a.id] || !(commentDrafts[a.id] ?? "").trim()
                                  }
                                >
                                  {commentSending[a.id] ? "发布中…" : "发布评论"}
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <p className="answer__comment-hint">
                              <Link to={loginNext}>登录</Link>后参与评论
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
        {answers.length > 0 &&
          (moreError ? (
            <div className="feed-foot feed-foot--error" role="alert">
              <p className="feed-foot__text">加载更多失败：{moreError}</p>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={loadMoreAnswers}
              >
                重试
              </button>
            </div>
          ) : hasMore ? (
            <div className="feed-foot">
              <button
                type="button"
                className="btn btn--outline"
                disabled={moreLoading || sortLoading}
                onClick={loadMoreAnswers}
              >
                {moreLoading
                  ? "加载中…"
                  : page === 0
                    ? `查看全部 ${question.answer_count} 个回答`
                    : "加载更多回答"}
              </button>
            </div>
          ) : page > 0 ? (
            <p className="feed-end" role="status">
              已经到底了
            </p>
          ) : null)}
      </section>

      {anchorMiss && (
        <div className="anchor-miss" role="status">
          <span>该回答可能已被删除</span>
          <button
            type="button"
            className="anchor-miss__top"
            onClick={() => {
              setAnchorMiss(false);
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          >
            回到顶部
          </button>
        </div>
      )}

      <section className="answer-editor" ref={editorBoxRef}>
        <h2 className="answers__count" id="answer-editor-label">写下你的回答</h2>
        {user ? (
          <>
            <MarkdownEditor
              ref={editorRef}
              rows={6}
              aria-labelledby="answer-editor-label"
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
            <Link to={loginNext}>登录</Link>后即可回答这个问题
          </p>
        )}
      </section>
    </article>
  );
}
