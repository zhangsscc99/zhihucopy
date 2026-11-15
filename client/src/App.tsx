import { Navigate, Route, Routes } from "react-router-dom";
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
import { Notifications } from "./pages/Notifications";

function Me() {
  const { user, loading } = useAuth();
  if (loading) return null;
  return <Navigate to={user ? `/u/${user.id}` : "/login"} replace />;
}

export function App() {
  return (
    <Layout rail={<HotRail />}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/question/:id" element={<Question />} />
        <Route path="/topic/:key" element={<Topic />} />
        <Route path="/ask" element={<Ask />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/u/:id" element={<Profile />} />
        <Route path="/me" element={<Me />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="*" element={<Empty title="页面不存在" hint="回到首页继续浏览" />} />
      </Routes>
    </Layout>
  );
}
