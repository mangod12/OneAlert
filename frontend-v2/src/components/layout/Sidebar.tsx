import { NavLink } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import {
  LayoutDashboard,
  Bell,
  Server,
  Network,
  Settings,
  LogOut,
  Shield,
  ClipboardList,
  BriefcaseMedical,
  Activity,
  Target,
  Search,
  FileCheck,
  Swords,
} from 'lucide-react';
import clsx from 'clsx';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/cases', icon: BriefcaseMedical, label: 'Cases' },
  { to: '/alerts', icon: Bell, label: 'Alerts' },
  { to: '/events', icon: Activity, label: 'Events' },
  { to: '/assets', icon: Server, label: 'Assets' },
  { to: '/ot', icon: Network, label: 'OT Discovery' },
  { to: '/mitre', icon: Target, label: 'MITRE ATT&CK' },
  { to: '/hunt', icon: Search, label: 'Hunt Lab' },
  { to: '/response-plans', icon: FileCheck, label: 'Response Plans' },
  { to: '/validation', icon: Swords, label: 'Validation' },
  { to: '/audit-log', icon: ClipboardList, label: 'Audit Log' },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

export function Sidebar() {
  const { user, logout } = useAuthStore();

  return (
    <aside className="sticky top-0 z-50 flex w-full flex-col border-b border-surface-800 bg-surface-900 md:fixed md:left-0 md:top-0 md:h-screen md:w-64 md:border-b-0 md:border-r">
      <div className="border-b border-surface-800 p-4 md:p-6">
        <div className="flex items-center gap-2">
          <Shield className="w-8 h-8 text-primary-400" />
          <span className="text-xl font-bold text-white">OneAlert</span>
        </div>
      </div>

      <nav className="flex gap-1 overflow-x-auto p-2 scrollbar-hide md:flex-1 md:flex-col md:gap-0 md:space-y-1 md:p-4">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              clsx(
                'flex shrink-0 items-center gap-3 px-3 py-2.5 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary-600/20 text-primary-300'
                  : 'text-surface-400 hover:bg-surface-800 hover:text-surface-200'
              )
            }
          >
            <item.icon className="w-5 h-5" />
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="hidden border-t border-surface-800 p-4 md:block">
        <div className="flex items-center gap-3 px-3 py-2 mb-2">
          <div className="w-8 h-8 rounded-full bg-primary-600 flex items-center justify-center text-white text-sm font-medium">
            {user?.full_name?.[0] || user?.email?.[0] || '?'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-surface-200 truncate">
              {user?.full_name || user?.email}
            </p>
            <p className="text-xs text-surface-500 truncate">{user?.role}</p>
          </div>
        </div>
        <button
          onClick={logout}
          aria-label="Sign out of your account"
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-surface-400 hover:bg-surface-800 hover:text-danger w-full transition-colors"
        >
          <LogOut className="w-5 h-5" />
          Sign Out
        </button>
      </div>
    </aside>
  );
}
