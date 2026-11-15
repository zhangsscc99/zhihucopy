import { useEffect, useState } from "react";
import { get, patch, post } from "../api";
import { useAuth } from "../auth";
import { useToast } from "../toast";
import { Empty, ErrorBox, Spinner } from "../components/Layout";
import { Button, Card, Input } from "../components/ui";
import { formatTime } from "../lib/time";

interface AdminReport {
  id: number;
  reporter_nickname: string;
  target_type: "question" | "answer" | "comment";
  target_id: number;
  target_summary: string | null;
  reason: string;
  detail: string;
  status: "pending" | "handled" | "rejected";
  created_at: string;
}

interface AdminStats {
  users: number;
  questions: number;
  answers: number;
  comments: number;
  reports_pending: number;
}

interface AdminUser {
  id: number;
  nickname: string;
  email: string;
  muted_until: string | null;
  banned: number;
}

const STATUS_TABS = [
  { key: "pending", label: "待处理" },
  { key: "handled", label: "已处理" },
  { key: "rejected", label: "已驳回" },
] as const;
type ReportStatus = (typeof STATUS_TABS)[number]["key"];

const TYPE_LABELS = { question: "问题", answer: "回答", comment: "评论" } as const;
const REASON_LABELS: Record<string, string> = {
  spam: "垃圾广告",
  abuse: "辱骂攻击",
  illegal: "违法违规",
  other: "其他",
};
const STATUS_LABELS: Record<ReportStatus, string> = {
  pending: "待处理",
  handled: "已处理",
  rejected: "已驳回",
};

export function Admin() {
  const { user, loading } = useAuth();
  const toast = useToast();
  const isAdmin = Boolean(user?.is_admin);

  const [stats, setStats] = useState<AdminStats | null>(null);
  const [status, setStatus] = useState<ReportStatus>("pending");
  const [reports, setReports] = useState<AdminReport[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<number | null>(null);

  const [userQuery, setUserQuery] = useState("");
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [muteBusy, setMuteBusy] = useState<number | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    get<AdminStats>("/admin/stats")
      .then(setStats)
      .catch(() => setStats(null));
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    setReports(null);
    get<{ items: AdminReport[] }>(`/admin/reports?status=${status}`)
      .then((d) => {
        setReports(d.items);
        setError("");
      })
      .catch((e) => setError((e as Error).message));
  }, [isAdmin, status]);

  if (loading) return <Spinner />;
  if (!isAdmin) return <Empty title="需要管理员权限" hint="管理后台仅对管理员开放" />;

  const handle = async (
    r: AdminReport,
    next: "handled" | "rejected",
    action: "collapse" | "remove" | "none",
    done: string
  ) => {
    if (busy !== null) return;
    setBusy(r.id);
    try {
      await patch(`/admin/reports/${r.id}`, { status: next, action });
      setReports((xs) => (xs ?? []).filter((x) => x.id !== r.id));
      setStats((s) =>
        s && next !== r.status
          ? { ...s, reports_pending: Math.max(0, s.reports_pending - 1) }
          : s
      );
      toast(done);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  };

  const searchUsers = () => {
    get<{ items: AdminUser[] }>(`/admin/users?q=${encodeURIComponent(userQuery)}`)
      .then((d) => setUsers(d.items))
      .catch((e) => toast((e as Error).message, "error"));
  };

  const mute = async (u: AdminUser, hours: number) => {
    if (muteBusy !== null) return;
    setMuteBusy(u.id);
    try {
      await post(`/admin/users/${u.id}/mute`, { hours });
      setUsers((xs) =>
        (xs ?? []).map((x) =>
          x.id === u.id
            ? { ...x, banned: hours > 0 ? 1 : 0, muted_until: hours > 0 ? x.muted_until : null }
            : x
        )
      );
      toast(hours > 0 ? `已禁言 ${u.nickname} ${hours} 小时` : `已解除 ${u.nickname} 的禁言`);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setMuteBusy(null);
    }
  };

  return (
    <div className="admin">
      <Card className="admin__card">
        <h1 className="page-title">管理后台</h1>
        {stats && (
          <p className="page-hint">
            用户 {stats.users} · 问题 {stats.questions} · 回答 {stats.answers} · 评论{" "}
            {stats.comments} · 待处理举报 {stats.reports_pending}
          </p>
        )}
        <h2 className="admin__section" id="admin-reports-label">
          举报队列
        </h2>
        <div className="admin__tabs" role="group" aria-label="举报状态筛选">
          {STATUS_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              aria-pressed={status === t.key}
              className={`md-editor__tab${status === t.key ? " md-editor__tab--active" : ""}`}
              onClick={() => setStatus(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
        {error ? (
          <ErrorBox message={error} />
        ) : reports === null ? (
          <Spinner />
        ) : reports.length === 0 ? (
          <Empty title={`没有${STATUS_LABELS[status]}的举报`} />
        ) : (
          <ul className="admin__reports" aria-labelledby="admin-reports-label">
            {reports.map((r) => (
              <li key={r.id} className="report-item">
                <div className="report-item__head">
                  <span className="tag">{TYPE_LABELS[r.target_type]} #{r.target_id}</span>
                  <span className="tag">{REASON_LABELS[r.reason] ?? r.reason}</span>
                  <span className="report-item__meta">
                    {r.reporter_nickname} 举报于 {formatTime(r.created_at)}
                  </span>
                </div>
                {r.target_summary && (
                  <p className="report-item__summary">{r.target_summary}</p>
                )}
                {r.detail && <p className="report-item__detail">补充说明：{r.detail}</p>}
                {r.status === "pending" ? (
                  <div className="report-item__actions">
                    <Button
                      variant="outline"
                      disabled={busy !== null}
                      onClick={() => handle(r, "handled", "collapse", "已折叠目标")}
                    >
                      折叠目标
                    </Button>
                    <Button
                      variant="outline"
                      disabled={busy !== null}
                      onClick={() => handle(r, "handled", "remove", "已删除目标")}
                    >
                      删除目标
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={busy !== null}
                      onClick={() => handle(r, "rejected", "none", "已驳回举报")}
                    >
                      驳回
                    </Button>
                  </div>
                ) : (
                  <p className="report-item__status">{STATUS_LABELS[r.status]}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="admin__card">
        <h2 className="admin__section">用户禁言</h2>
        <div className="admin__search">
          <Input
            value={userQuery}
            placeholder="按昵称或邮箱搜索用户"
            aria-label="搜索用户"
            onChange={(e) => setUserQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && searchUsers()}
          />
          <Button variant="outline" onClick={searchUsers}>
            搜索
          </Button>
        </div>
        {users !== null && (
          <ul className="admin__users">
            {users.length === 0 && <li className="admin__empty">没有匹配的用户</li>}
            {users.map((u) => (
              <li key={u.id} className="admin__user">
                <span className="admin__user-name">
                  {u.nickname}
                  <span className="admin__user-email">{u.email}</span>
                </span>
                {u.banned ? (
                  <Button
                    variant="ghost"
                    disabled={muteBusy !== null}
                    onClick={() => mute(u, 0)}
                  >
                    解除禁言
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    disabled={muteBusy !== null}
                    onClick={() => mute(u, 24)}
                  >
                    禁言 24 小时
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
