import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, hasCheckedSession } = useAuthStore();
  const location = useLocation();

  if (!hasCheckedSession) {
    return (
      <div className="grid min-h-screen place-items-center bg-surface-950" role="status" aria-label="Checking session">
        <div className="space-y-3 text-center">
          <div className="oa-skeleton mx-auto h-10 w-10 rounded-md" />
          <p className="text-sm text-surface-400">Checking secure session…</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
