import { Menu, Radio, ShieldCheck } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import type { RefObject } from 'react';

const routeMeta: Array<{ match: (path: string) => boolean; section: string; title: string }> = [
  { match: path => /^\/cases\/\d+/.test(path), section: 'Command / Investigations', title: 'Case workspace' },
  { match: path => path === '/cases', section: 'Command', title: 'Investigations' },
  { match: path => path === '/alerts', section: 'Observe', title: 'Alerts' },
  { match: path => path === '/events', section: 'Observe', title: 'Security events' },
  { match: path => path === '/assets', section: 'Observe', title: 'Asset inventory' },
  { match: path => path === '/ot', section: 'Observe', title: 'OT discovery' },
  { match: path => path === '/mitre', section: 'Analyze', title: 'MITRE ATT&CK' },
  { match: path => path === '/hunt', section: 'Analyze', title: 'Hunt lab' },
  { match: path => path === '/response-plans', section: 'Act', title: 'Response plans' },
  { match: path => path === '/validation', section: 'Act', title: 'Purple-team validation' },
  { match: path => path === '/audit-log', section: 'Govern', title: 'Audit log' },
  { match: path => path === '/settings', section: 'Govern', title: 'Settings' },
  { match: path => path === '/', section: 'Command', title: 'Security operations' },
];

export function CommandBar({ onOpenNavigation, menuButtonRef }: { onOpenNavigation: () => void; menuButtonRef: RefObject<HTMLButtonElement | null> }) {
  const { pathname } = useLocation();
  const meta = routeMeta.find(item => item.match(pathname)) ?? routeMeta[routeMeta.length - 1];

  return (
    <header className="fixed left-0 right-0 top-0 z-30 flex h-[var(--oa-command-height)] items-center justify-between border-b border-surface-800 bg-surface-950/92 px-3 backdrop-blur-md md:left-[var(--oa-sidebar-width)] md:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <button ref={menuButtonRef} type="button" aria-label="Open navigation" onClick={onOpenNavigation} className="grid h-10 w-10 shrink-0 place-items-center rounded-md text-surface-300 hover:bg-surface-800 md:hidden">
          <Menu className="h-5 w-5" aria-hidden="true" />
        </button>
        <div className="min-w-0">
          <p className="truncate text-[10px] font-bold uppercase tracking-[0.14em] text-surface-500">{meta.section}</p>
          <p className="truncate text-sm font-semibold text-surface-100">{meta.title}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 sm:gap-3">
        <div className="hidden items-center gap-2 rounded-md border border-surface-800 bg-surface-900 px-2.5 py-1.5 text-[11px] text-surface-400 sm:flex">
          <Radio className="h-3.5 w-3.5 text-success" aria-hidden="true" />
          Telemetry workspace
        </div>
        <div className="flex items-center gap-2 rounded-md border border-success/20 bg-success/8 px-2.5 py-1.5 text-[11px] font-semibold text-success">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="hidden sm:inline">Approval gates</span>
          <span className="sm:hidden">Gated</span>
        </div>
      </div>
    </header>
  );
}
