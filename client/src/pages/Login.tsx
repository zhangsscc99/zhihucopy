import { useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth";
import { useToast } from "../toast";
import { Button, Card, Input } from "../components/ui";

export function Login() {
  const { user, loading, login } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const next = params.get("next");
  const dest = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await login(email, password);
      toast("欢迎回来");
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
        <h1 className="page-title">登录知乎（仿）</h1>
        <form onSubmit={submit} className="authform">
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
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <Button type="submit" disabled={busy}>
            {busy ? "登录中…" : "登录"}
          </Button>
        </form>
        <p className="authcard__alt">
          还没有账号？
          <Link to={next ? `/register?next=${encodeURIComponent(next)}` : "/register"}>
            注册一个
          </Link>
        </p>
      </Card>
    </div>
  );
}
