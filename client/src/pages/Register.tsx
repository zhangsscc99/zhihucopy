import { useRef, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth";
import { useToast } from "../toast";
import { Button, Card, Input } from "../components/ui";
import { authHref, safeNext } from "../lib/nextParam";
import { usePageTitle } from "../lib/usePageTitle";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type FieldKey = "nickname" | "email" | "password";
type FieldErrors = Partial<Record<FieldKey, string>>;

export function Register() {
  usePageTitle("注册");
  const { user, loading, register } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const next = params.get("next");
  const dest = safeNext(next) ?? "/";
  const [nickname, setNickname] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const nicknameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const fieldRefs: Record<FieldKey, React.RefObject<HTMLInputElement | null>> = {
    nickname: nicknameRef,
    email: emailRef,
    password: passwordRef,
  };

  const clearFieldError = (key: FieldKey) =>
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const nextErrors: FieldErrors = {};
    if (nickname.trim().length < 2 || nickname.trim().length > 20) {
      nextErrors.nickname = "请输入 2–20 个字的昵称";
    }
    if (!EMAIL_RE.test(email.trim())) {
      nextErrors.email = "请输入有效的邮箱地址";
    }
    if (password.length < 6) {
      nextErrors.password = "密码至少 6 个字符";
    }
    const firstInvalid = (Object.keys(fieldRefs) as FieldKey[]).find((k) => nextErrors[k]);
    if (firstInvalid) {
      setErrors(nextErrors);
      fieldRefs[firstInvalid].current?.focus();
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await register(email, password, nickname);
      toast("注册成功，欢迎来到知乎（仿）");
      navigate(dest, { replace: true });
    } catch (err) {
      const msg = (err as Error).message || "注册失败，请稍后重试";
      if (/邮箱|邮件/.test(msg)) {
        setErrors({ email: msg });
        emailRef.current?.focus();
      } else if (/昵称|用户名/.test(msg)) {
        setErrors({ nickname: msg });
        nicknameRef.current?.focus();
      } else {
        toast(msg, "error");
      }
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
        <form onSubmit={submit} className="authform" noValidate>
          <label className="form-label" htmlFor="reg-nickname">
            昵称
            <Input
              id="reg-nickname"
              ref={nicknameRef}
              required
              maxLength={24}
              value={nickname}
              onChange={(e) => {
                setNickname(e.target.value);
                clearFieldError("nickname");
              }}
            />
            {errors.nickname && <p className="field-error">{errors.nickname}</p>}
          </label>
          <label className="form-label" htmlFor="reg-email">
            邮箱
            <Input
              id="reg-email"
              ref={emailRef}
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                clearFieldError("email");
              }}
            />
            {errors.email && <p className="field-error">{errors.email}</p>}
          </label>
          <label className="form-label" htmlFor="reg-password">
            密码
            <Input
              id="reg-password"
              ref={passwordRef}
              type="password"
              required
              minLength={6}
              autoComplete="new-password"
              placeholder="至少 6 个字符"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                clearFieldError("password");
              }}
            />
            {errors.password && <p className="field-error">{errors.password}</p>}
          </label>
          <Button type="submit" disabled={busy}>
            {busy ? "注册中…" : "注册"}
          </Button>
        </form>
        <p className="authcard__alt">
          已有账号？
          <Link to={authHref("/login", next)}>
            直接登录
          </Link>
        </p>
      </Card>
    </div>
  );
}
