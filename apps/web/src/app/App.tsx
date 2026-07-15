import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Home } from "../features/home/Home";
import { PlayerLogin } from "../features/player/auth/PlayerLogin";
import { PlayerLayout } from "../features/player/PlayerLayout";
import { PlayerDashboard } from "../features/player/PlayerDashboard";
import { TimedWordleGame } from "../features/player/timed-wordle/TimedWordleGame";
import { TimedWordleResultsPage } from "../features/player/timed-wordle/TimedWordleResultsPage";
import { UnwordleGame } from "../features/player/unwordle/UnwordleGame";
import { UnwordleResults } from "../features/player/unwordle/UnwordleResults";
import { AdminLogin } from "../features/admin/common/AdminLogin";
import { AdminLayout } from "../features/admin/common/AdminLayout";
import { EventsListPage } from "../features/admin/events/EventsListPage";
import { EventSetupPage } from "../features/admin/events/EventSetupPage";
import { EventWorkspaceLayout } from "../features/admin/events/EventWorkspaceLayout";
import { EventControlCenter } from "../features/admin/events/EventControlCenter";
import { EventEditPage } from "../features/admin/events/EventEditPage";
import { TimedWordleAdminPanel } from "../features/admin/timed-wordle/TimedWordleAdminPanel";
import { MessagingPanel } from "../features/admin/messaging/MessagingPanel";
import { CutoffToolPage } from "../features/admin/cutoff/CutoffToolPage";
import { UnwordleAdminPanel } from "../features/admin/unwordle/UnwordleAdminPanel";
import { WinnersPage } from "../features/admin/winners/WinnersPage";
import { AuditLogPage } from "../features/admin/audit/AuditLogPage";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/play/:eventId" element={<PlayerLogin />} />
        <Route element={<PlayerLayout />}>
          <Route path="/play/:eventId/dashboard" element={<PlayerDashboard />} />
          <Route path="/play/:eventId/game" element={<TimedWordleGame />} />
          <Route path="/play/:eventId/results" element={<TimedWordleResultsPage />} />
          <Route path="/play/:eventId/unwordle/game" element={<UnwordleGame />} />
          <Route path="/play/:eventId/unwordle/results" element={<UnwordleResults />} />
        </Route>

        <Route path="/admin" element={<AdminLogin />} />
        <Route element={<AdminLayout />}>
          <Route path="/admin/events" element={<EventsListPage />} />
          <Route path="/admin/events/new" element={<EventSetupPage />} />
          <Route element={<EventWorkspaceLayout />}>
            <Route path="/admin/events/:eventId" element={<EventControlCenter />} />
            <Route path="/admin/events/:eventId/edit" element={<EventEditPage />} />
            <Route path="/admin/events/:eventId/prelims" element={<TimedWordleAdminPanel />} />
            <Route path="/admin/events/:eventId/messages" element={<MessagingPanel />} />
            <Route path="/admin/events/:eventId/cutoff" element={<CutoffToolPage />} />
            <Route path="/admin/events/:eventId/playoffs" element={<UnwordleAdminPanel />} />
            <Route path="/admin/events/:eventId/winners" element={<WinnersPage />} />
            <Route path="/admin/events/:eventId/audit" element={<AuditLogPage />} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
