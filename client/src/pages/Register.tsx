import { useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth";
import { useToast } from "../toast";
import { Button, Card, Input } from "../components/ui";

export function Register() {
  const { user, loading, register } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const next = params.get("next");
  const dest = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  const [nickname, setNickname] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await register(email, password, nickname);
      toast("注册成功，欢迎来到知乎（仿）");
      navigate(dest, { replace: true });
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return null;
  if (user) return <Navigate to={dest} replace />;

  return (
    <div className="authpage">
      <Card className="authcard">
        <h1 className="page-title">加入知乎（仿）</h1>
        <form onSubmit={submit} className="authform">
          <label className="form-label">
            昵称
            <Input
              required
              maxLength={24}
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
            />
          </label>
          <label className="form-label">
            邮箱
            <Input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="form-label">
            密码
            <Input
              type="password"
              required
              minLength={6}
              autoComplete="new-password"
              placeholder="至少 6 个字符"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <Button type="submit" disabled={busy}>
            {busy ? "注册中…" : "注册"}
          </Button>
        </form>
        <p className="authcard__alt">
          已有账号？
          <Link to={next ? `/login?next=${encodeURIComponent(next)}` : "/login"}>
            直接登录
          </Link>
        </p>
      </Card>
    </div>
  );
}
