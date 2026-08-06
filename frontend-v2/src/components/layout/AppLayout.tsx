import { useCallback, useEffect, useRef, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { CommandBar } from './CommandBar';
import { Sidebar } from './Sidebar';

export function AppLayout() {
  const [navigationOpen, setNavigationOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeNavigation = useCallback(() => setNavigationOpen(false), []);

  useEffect(() => {
    if (!navigationOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setNavigationOpen(false);
        requestAnimationFrame(() => menuButtonRef.current?.focus());
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [navigationOpen]);

  return (
    <div className="min-h-screen bg-surface-950">
      <a href="#main-content" className="fixed left-3 top-3 z-[100] -translate-y-20 rounded-md bg-primary-500 px-3 py-2 text-sm font-semibold text-surface-950 transition focus:translate-y-0">Skip to content</a>
      <Sidebar open={navigationOpen} onClose={closeNavigation} />
      <CommandBar onOpenNavigation={() => setNavigationOpen(true)} menuButtonRef={menuButtonRef} />
      <main id="main-content" tabIndex={-1} className="min-h-screen pt-[var(--oa-command-height)] md:ml-[var(--oa-sidebar-width)]">
        <div className="mx-auto w-full max-w-[1920px] p-4 sm:p-5 lg:p-6 xl:p-7">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
