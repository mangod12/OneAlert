import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense, useEffect } from 'react';
import { useAuthStore } from './stores/authStore';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AppLayout } from './components/layout/AppLayout';
import { ToastContainer } from './components/Toast';

const Login = lazy(() => import('./pages/Login').then(module => ({ default: module.Login })));
const Register = lazy(() => import('./pages/Register').then(module => ({ default: module.Register })));
const Dashboard = lazy(() => import('./pages/Dashboard').then(module => ({ default: module.Dashboard })));
const Cases = lazy(() => import('./pages/Cases').then(module => ({ default: module.Cases })));
const CaseDetail = lazy(() => import('./pages/CaseDetail').then(module => ({ default: module.CaseDetail })));
const Alerts = lazy(() => import('./pages/Alerts').then(module => ({ default: module.Alerts })));
const Events = lazy(() => import('./pages/Events').then(module => ({ default: module.Events })));
const Assets = lazy(() => import('./pages/Assets').then(module => ({ default: module.Assets })));
const OTDiscovery = lazy(() => import('./pages/OTDiscovery').then(module => ({ default: module.OTDiscovery })));
const MitreMap = lazy(() => import('./pages/MitreMap').then(module => ({ default: module.MitreMap })));
const HuntLab = lazy(() => import('./pages/HuntLab').then(module => ({ default: module.HuntLab })));
const Settings = lazy(() => import('./pages/Settings').then(module => ({ default: module.Settings })));
const AuditLog = lazy(() => import('./pages/AuditLog').then(module => ({ default: module.AuditLog })));
const ResponsePlans = lazy(() => import('./pages/ResponsePlans').then(module => ({ default: module.ResponsePlans })));
const Validation = lazy(() => import('./pages/Validation').then(module => ({ default: module.Validation })));

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
          <Route path="/cases/:caseId" element={<CaseDetail />} />
          <Route path="/alerts" element={<Alerts />} />
          <Route path="/events" element={<Events />} />
          <Route path="/assets" element={<Assets />} />
          <Route path="/ot" element={<OTDiscovery />} />
          <Route path="/mitre" element={<MitreMap />} />
          <Route path="/hunt" element={<HuntLab />} />
          <Route path="/response-plans" element={<ResponsePlans />} />
          <Route path="/validation" element={<Validation />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/audit-log" element={<AuditLog />} />
        </Route>
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

export default App;
