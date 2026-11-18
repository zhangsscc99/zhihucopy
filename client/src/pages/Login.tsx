import { useState } from "react";
import {
  Link,
  Navigate,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { useAuth } from "../auth";
import { useToast } from "../toast";
import { Button, Card, Input } from "../components/ui";
import { authHref, safeNext } from "../lib/nextParam";

export function Login() {
  const { user, loading, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const [params] = useSearchParams();
  const next = params.get("next");
  const dest = safeNext(next) ?? "/";
  // 复用 dest 的站内校验：next 经校验原样保留（=== dest）且非 /login 自指时，
  // 说明用户是被守卫动作送过来的，表单上方给一行解释；外站/无 next 不显示。
  const showNextHint = next === dest && next !== "/login";
  // 守卫动作（赞同/关注/回答…）是 push 进站并带 state.returnTo=当前页=next：
  // 登录成功用 navigate(-1) 弹掉登录条目落回原条目，栈里不留同址相邻项，
  // 之后的「后退一次」才能走到进站前的上一页。其余入口（顶栏/直访/401/
  // next≠当前页）沿用 replace，后退仍回到进入登录页之前的页面。
  const navState = location.state as { returnTo?: unknown; pushed?: unknown } | null;
  const backToOrigin =
    next !== null && navState?.pushed === true && navState.returnTo === next;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await login(email, password);
      toast("欢迎回来");
      if (backToOrigin) navigate(-1);
      else navigate(dest, { replace: true });
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
          {showNextHint && (
            <p className="authform__hint">登录后即可继续刚才的操作</p>
          )}
          <label className="form-label" htmlFor="login-email">
            邮箱
            <Input
              id="login-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="form-label" htmlFor="login-password">
            密码
            <Input
              id="login-password"
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
          <Link to={authHref("/register", next)}>
            注册一个
          </Link>
        </p>
      </Card>
    </div>
  );
}
