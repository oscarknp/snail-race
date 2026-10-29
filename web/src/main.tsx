import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import "./styles.css";
import { ActivityDialogProvider } from "./components/ActivityForm.tsx";
import { Layout } from "./components/Layout.tsx";
import { Loading, ToastProvider } from "./components/ui.tsx";
import { AuthProvider, useAuth } from "./lib/auth.tsx";
import { Activities } from "./pages/Activities.tsx";
import { ForgotPassword, Login, Register, ResetPassword } from "./pages/Auth.tsx";
import { Dashboard } from "./pages/Dashboard.tsx";
import { Landing } from "./pages/Landing.tsx";
import { Leaderboard } from "./pages/Leaderboard.tsx";
import { NotFound } from "./pages/NotFound.tsx";
import { Person } from "./pages/Person.tsx";
import { Profile } from "./pages/Profile.tsx";
import { RacePage } from "./pages/RacePage.tsx";
import { Races } from "./pages/Races.tsx";

function Private({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Loading label="Waking up the snails…" />;
  if (!me) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <ActivityDialogProvider>{children}</ActivityDialogProvider>;
}

function Home() {
  const { me, loading } = useAuth();
  if (loading) return <Loading label="Waking up the snails…" />;
  // The race is the first thing a logged-in racer sees.
  return me ? <Private><RacePage /></Private> : <Landing />;
}

function GuestOnly({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth();
  if (loading) return <Loading />;
  return me ? <Navigate to="/" replace /> : <>{children}</>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Home />} />
              <Route path="login" element={<GuestOnly><Login /></GuestOnly>} />
              <Route path="register" element={<GuestOnly><Register /></GuestOnly>} />
              <Route path="forgot-password" element={<ForgotPassword />} />
              <Route path="reset-password" element={<ResetPassword />} />
              <Route path="dashboard" element={<Private><Dashboard /></Private>} />
              <Route path="activities" element={<Private><Activities /></Private>} />
              <Route path="leaderboard" element={<Private><Leaderboard /></Private>} />
              <Route path="races" element={<Private><Races /></Private>} />
              <Route path="races/:id" element={<Private><RacePage /></Private>} />
              <Route path="profile" element={<Private><Profile /></Private>} />
              <Route path="people/:id" element={<Private><Person /></Private>} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
