import { Routes, Route, Navigate } from "react-router-dom";
import AppLayout from "@/components/layout/AppLayout";
import LoginPage from "@/pages/LoginPage";
import RegisterPage from "@/pages/RegisterPage";
import HomePage from "@/pages/HomePage";
import ProductIntroPage from "@/pages/ProductIntroPage";
import CreateExperiencePage from "@/pages/CreateExperiencePage";
import MedalDetailPage from "@/pages/MedalDetailPage";
import ProfilePage from "@/pages/ProfilePage";
import UserProfilePage from "@/pages/UserProfilePage";
import NotificationsPage from "@/pages/NotificationsPage";
import AgentSettingsPage from "@/pages/AgentSettingsPage";
import StageSummariesPage from "@/pages/StageSummariesPage";
import YearReviewListPage from "@/pages/YearReviewListPage";
import YearReviewDetailPage from "@/pages/YearReviewDetailPage";
import NotFoundPage from "@/pages/NotFoundPage";
import { useAuth } from "@/features/auth/useAuth";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  if (isAuthenticated) {
    return <Navigate to="/app" replace />;
  }
  return <>{children}</>;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<ProductIntroPage />} />
      <Route path="/intro" element={<Navigate to="/" replace />} />
      <Route
        path="/login"
        element={
          <PublicRoute>
            <LoginPage />
          </PublicRoute>
        }
      />
      <Route
        path="/register"
        element={
          <PublicRoute>
            <RegisterPage />
          </PublicRoute>
        }
      />
      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/app" element={<HomePage />} />
        <Route path="/create" element={<CreateExperiencePage />} />
        <Route path="/medals/:id" element={<MedalDetailPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/stage-summaries" element={<StageSummariesPage />} />
        <Route path="/year-review" element={<YearReviewListPage />} />
        <Route path="/year-review/:year" element={<YearReviewDetailPage />} />
        <Route path="/users/:id" element={<UserProfilePage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/settings/agent" element={<AgentSettingsPage />} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
