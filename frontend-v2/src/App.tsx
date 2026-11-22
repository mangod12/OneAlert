import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense, useEffect } from 'react';
import { useAuthStore } from './stores/authStore';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AppLayout } from './components/layout/AppLayout';
import { ToastContainer } from './components/Toast';

const SearchWorkspace = lazy(() => import('./pages/SearchWorkspace').then(module => ({ default: module.SearchWorkspace })));
const Login = lazy(() => import('./pages/Login').then(module => ({ default: module.Login })));
const Register = lazy(() => import('./pages/Register').then(module => ({ default: module.Register })));
const Dashboard = lazy(() => import('./pages/Dashboard').then(module => ({ default: module.Dashboard })));
const Cases = lazy(() => import('./pages/Cases').then(module => ({ default: module.Cases })));
const MyTasks = lazy(() => import('./pages/MyTasks').then(module => ({ default: module.MyTasks })));
const Watchlist = lazy(() => import('./pages/Watchlist').then(module => ({ default: module.Watchlist })));
const Incidents = lazy(() => import('./pages/Incidents').then(module => ({ default: module.Incidents })));
const Reports = lazy(() => import('./pages/Reports').then(module => ({ default: module.Reports })));
const CaseLinkedEvidence = lazy(() => import('./pages/CaseLinkedEvidence').then(module => ({ default: module.CaseLinkedEvidence })));
const CaseDetail = lazy(() => import('./pages/CaseDetail').then(module => ({ default: module.CaseDetail })));
const Alerts = lazy(() => import('./pages/Alerts').then(module => ({ default: module.Alerts })));
const EventEvidence = lazy(() => import('./pages/EventEvidence').then(module => ({ default: module.EventEvidence })));
const Events = lazy(() => import('./pages/EventSourceRoute').then(module => ({ default: module.EventSourceRoute })));
const Assets = lazy(() => import('./pages/Assets').then(module => ({ default: module.Assets })));
const OTDiscovery = lazy(() => import('./pages/OTDiscovery').then(module => ({ default: module.OTDiscovery })));
const MitreMap = lazy(() => import('./pages/MitreMap').then(module => ({ default: module.MitreMap })));
const HuntSessionEvidenceRoute = lazy(() => import('./components/HuntSessionEvidenceRoute').then(module => ({ default: module.HuntSessionEvidenceRoute })));
const HuntLab = lazy(() => import('./pages/HuntLab').then(module => ({ default: module.HuntLabRoute })));
const Notifications = lazy(() => import('./pages/Notifications').then(module => ({ default: module.Notifications })));
const Settings = lazy(() => import('./pages/Settings').then(module => ({ default: module.Settings })));
const AuditLog = lazy(() => import('./pages/AuditLog').then(module => ({ default: module.AuditLogRoute })));
const Compliance = lazy(() => import('./pages/Compliance').then(module => ({ default: module.Compliance })));
const SbomComponentSearch = lazy(() => import('./pages/SbomComponentSearch').then(module => ({ default: module.SbomComponentSearch })));
const SuppressionOverlapReview = lazy(() => import('./pages/SuppressionOverlapReview').then(module => ({ default: module.SuppressionOverlapReview })));
const SuppressionMatchEvidence = lazy(() => import('./pages/SuppressionMatchEvidence').then(module => ({ default: module.SuppressionMatchEvidence })));
const Sbom = lazy(() => import('./pages/Sbom').then(module => ({ default: module.Sbom })));
const Topology = lazy(() => import('./pages/Topology').then(module => ({ default: module.Topology })));
const SbomDocumentLibrary = lazy(() => import('./pages/SbomDocumentLibrary').then(module => ({ default: module.SbomDocumentLibrary })));
const ResponsePlans = lazy(() => import('./pages/ResponsePlans').then(module => ({ default: module.ResponsePlansRoute })));
const Validation = lazy(() => import('./pages/Validation').then(module => ({ default: module.ValidationRoute })));

function App() {
  const { isAuthenticated, hasCheckedSession, fetchUser } = useAuthStore();

  useEffect(() => {
    if (!hasCheckedSession) {
      fetchUser();
    }
  }, [hasCheckedSession, fetchUser]);

  return (
    <BrowserRouter basename="/app">
      <ToastContainer />
      <Suspense fallback={<div className="grid min-h-screen place-items-center bg-surface-950 text-sm text-surface-400" role="status">Loading OneAlert…</div>}>
      <Routes>
        <Route path="/login" element={isAuthenticated ? <Navigate to="/" /> : <Login />} />
        <Route path="/register" element={isAuthenticated ? <Navigate to="/" /> : <Register />} />
        <Route
          element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          }
        >
          <Route path="/" element={<Dashboard />} />
          <Route path="/cases" element={<Cases />} />
          <Route path="/my-tasks" element={<MyTasks />} />
          <Route path="/watchlist" element={<Watchlist />} />
          <Route path="/incidents" element={<Incidents />} />
          <Route path="/search" element={<SearchWorkspace />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/cases/:caseId/evidence" element={<CaseLinkedEvidence />} />
          <Route path="/cases/:caseId" element={<CaseDetail />} />
          <Route path="/alerts" element={<Alerts />} />
          <Route path="/events/:eventId" element={<EventEvidence />} />
          <Route path="/events" element={<Events />} />
          <Route path="/assets" element={<Assets />} />
          <Route path="/ot" element={<OTDiscovery />} />
          <Route path="/mitre" element={<MitreMap />} />
          <Route path="/hunt" element={<HuntSessionEvidenceRoute><HuntLab /></HuntSessionEvidenceRoute>} />
          <Route path="/sbom/documents" element={<SbomDocumentLibrary />} />
          <Route path="/response-plans" element={<ResponsePlans />} />
          <Route path="/validation" element={<Validation />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/topology" element={<Topology />} />
          <Route path="/sbom/components" element={<SbomComponentSearch />} />
          <Route path="/settings/suppression-rules/:ruleId/overlap" element={<SuppressionOverlapReview />} />
          <Route path="/settings/suppression-rules/:ruleId" element={<SuppressionMatchEvidence />} />
          <Route path="/sbom" element={<Sbom />} />
          <Route path="/compliance" element={<Compliance />} />
          <Route path="/audit-log" element={<AuditLog />} />
        </Route>
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

export default App;
