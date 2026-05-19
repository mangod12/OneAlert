import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';

export function AppLayout() {
  return (
    <div className="min-h-screen bg-surface-950">
      <Sidebar />
      <main className="p-4 md:ml-64 md:p-8">
        <Outlet />
      </main>
    </div>
  );
}
