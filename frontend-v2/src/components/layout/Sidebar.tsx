import { NavLink, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { useAuthStore } from '../../stores/authStore';
import {
  Activity, Bell, BriefcaseMedical, ClipboardList, FileCheck,
  LayoutDashboard, LogOut, Network, Search, Server, Settings, Shield,
  Swords, Target, X,
} from 'lucide-react';
import clsx from 'clsx';

const navigation = [
  { label: 'Command', items: [
    { to: '/', icon: LayoutDashboard, label: 'Overview' },
    { to: '/cases', icon: BriefcaseMedical, label: 'Investigations' },
  ] },
  { label: 'Observe', items: [
    { to: '/alerts', icon: Bell, label: 'Alerts' },
    { to: '/events', icon: Activity, label: 'Events' },
    { to: '/assets', icon: Server, label: 'Assets' },
    { to: '/ot', icon: Network, label: 'OT Discovery' },
  ] },
  { label: 'Analyze', items: [
    { to: '/mitre', icon: Target, label: 'MITRE ATT&CK' },
    { to: '/hunt', icon: Search, label: 'Hunt Lab' },
  ] },
  { label: 'Act', items: [
    { to: '/response-plans', icon: FileCheck, label: 'Response Plans' },
    { to: '/validation', icon: Swords, label: 'Validation' },
  ] },
  { label: 'Govern', items: [
    { to: '/audit-log', icon: ClipboardList, label: 'Audit Log' },
    { to: '/settings', icon: Settings, label: 'Settings' },
  ] },
];

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const { user, logout } = useAuthStore();
  const location = useLocation();

  useEffect(() => { onClose(); }, [location.pathname, onClose]);

  return (
    <>
      <button
        type="button"
        aria-label="Close navigation"
        className={clsx('fixed inset-0 z-40 bg-surface-950/75 backdrop-blur-sm transition md:hidden', open ? 'opacity-100' : 'pointer-events-none opacity-0')}
        onClick={onClose}
        tabIndex={open ? 0 : -1}
      />
      <aside className={clsx(
        'fixed inset-y-0 left-0 z-50 flex w-[var(--oa-sidebar-width)] flex-col border-r border-surface-800 bg-surface-900 shadow-[var(--oa-shadow-float)] transition-[transform,visibility] duration-200 md:visible md:translate-x-0 md:shadow-none',
        open ? 'visible translate-x-0' : 'invisible -translate-x-full',
      )}>
        <div className="flex h-[var(--oa-command-height)] items-center justify-between border-b border-surface-800 px-4">
          <NavLink to="/" className="flex items-center gap-2.5" aria-label="OneAlert overview">
            <span className="grid h-8 w-8 place-items-center rounded-md border border-primary-500/30 bg-primary-500/10 text-primary-300">
              <Shield className="h-5 w-5" aria-hidden="true" />
            </span>
            <span>
              <span className="block text-sm font-bold tracking-tight text-surface-50">OneAlert</span>
              <span className="block text-[9px] font-bold uppercase tracking-[0.18em] text-surface-500">Security OS</span>
            </span>
          </NavLink>
          <button type="button" onClick={onClose} aria-label="Close navigation" className="grid h-9 w-9 place-items-center rounded-md text-surface-400 hover:bg-surface-800 hover:text-surface-100 md:hidden">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <nav aria-label="Primary navigation" className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {navigation.map(group => (
            <div key={group.label} className="mb-3">
              <p className="px-2 pb-1.5 pt-1 text-[10px] font-bold uppercase tracking-[0.16em] text-surface-500">{group.label}</p>
              <div className="space-y-0.5">
                {group.items.map(item => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/'}
                    className={({ isActive }) => clsx(
                      'group flex min-h-9 items-center gap-3 rounded-md border px-2.5 text-[13px] font-medium transition-colors',
                      isActive
                        ? 'border-primary-500/25 bg-primary-500/10 text-primary-200'
                        : 'border-transparent text-surface-400 hover:border-surface-700 hover:bg-surface-800/70 hover:text-surface-100',
                    )}
                  >
                    <item.icon className="h-[17px] w-[17px] shrink-0" aria-hidden="true" />
                    <span className="truncate">{item.label}</span>
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-surface-800 p-3">
          <div className="flex items-center gap-3 rounded-md border border-surface-800 bg-surface-950/40 px-2.5 py-2.5">
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-primary-600 text-xs font-bold text-surface-50">
              {(user?.full_name?.[0] || user?.email?.[0] || '?').toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-surface-200">{user?.full_name || user?.email || 'Operator'}</p>
              <p className="truncate text-[10px] uppercase tracking-wide text-surface-500">{user?.role || 'analyst'}</p>
            </div>
            <button type="button" onClick={logout} aria-label="Sign out of your account" title="Sign out" className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-surface-400 hover:bg-danger/10 hover:text-danger">
              <LogOut className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
