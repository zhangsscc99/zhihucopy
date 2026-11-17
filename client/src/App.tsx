import { Navigate, Route, Routes, useLocation, useSearchParams } from "react-router-dom";
import { useAuth } from "./auth";
import { Layout } from "./components/Layout";
import { HotRail } from "./components/HotRail";
import { UnansweredRail } from "./components/UnansweredRail";
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
import { NotFound } from "./pages/NotFound";
import { usePageTitle } from "./lib/usePageTitle";

function Me() {
  const { user, loading } = useAuth();
  usePageTitle("我的主页");
  if (loading) return null;
  return <Navigate to={user ? `/u/${user.id}` : "/login"} replace />;
}

// /search 仅承载结果页：无 q 参数时回首页，避免三 tab feed 渲染在 /search 路径下。
function Search() {
  const [params] = useSearchParams();
  if (!(params.get("q") || "").trim()) return <Navigate to="/" replace />;
  return <Home />;
}

// Z1105 — 首页热榜 tab 主列表本身就是热榜 Top20，右栏再列同一份属于重复；
// hot 下热榜块让位给「等你来答」（含无数据时的话题兜底），其余页面保持原样。
function Rail() {
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const hotHome = pathname === "/" && params.get("tab") === "hot";
  if (hotHome) return <UnansweredRail />;
  return (
    <>
      <HotRail />
      <UnansweredRail />
    </>
  );
}

export function App() {
  return (
    <Layout rail={<Rail />}>
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
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Layout>
  );
}
