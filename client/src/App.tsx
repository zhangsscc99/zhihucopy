import { Navigate, Route, Routes, useSearchParams } from "react-router-dom";
import { useAuth } from "./auth";
import { Layout } from "./components/Layout";
import { HotRail } from "./components/HotRail";
import { Empty } from "./components/Layout";
import { Home } from "./pages/Home";
import { Question } from "./pages/Question";
import { Ask } from "./pages/Ask";
import { Login } from "./pages/Login";
import { Register } from "./pages/Register";
import { Profile } from "./pages/Profile";
import { Topic } from "./pages/Topic";
import { Topics } from "./pages/Topics";
import { Unanswered } from "./pages/Unanswered";
import { Notifications } from "./pages/Notifications";
import { Collections, CollectionDetail } from "./pages/Collections";
import { Admin } from "./pages/Admin";

function Me() {
  const { user, loading } = useAuth();
  if (loading) return null;
  return <Navigate to={user ? `/u/${user.id}` : "/login"} replace />;
}

// /search 仅承载结果页：无 q 参数时回首页，避免三 tab feed 渲染在 /search 路径下。
function Search() {
  const [params] = useSearchParams();
  if (!(params.get("q") || "").trim()) return <Navigate to="/" replace />;
  return <Home />;
}

export function App() {
  return (
    <Layout rail={<HotRail />}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/search" element={<Search />} />
        <Route path="/question/:id" element={<Question />} />
        <Route path="/topic/:key" element={<Topic />} />
        <Route path="/topics" element={<Topics />} />
        <Route path="/unanswered" element={<Unanswered />} />
        <Route path="/ask" element={<Ask />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/u/:id" element={<Profile />} />
        <Route path="/me" element={<Me />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/collections" element={<Collections />} />
        <Route path="/collections/:id" element={<CollectionDetail />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="*" element={<Empty title="页面不存在" hint="回到首页继续浏览" />} />
      </Routes>
    </Layout>
  );
}
