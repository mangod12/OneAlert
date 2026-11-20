import { useEffect, useRef, type RefObject } from 'react';

const dialogStack: HTMLElement[] = [];

const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

// Moves focus into a modal dialog on mount, keeps Tab/Shift+Tab cycling
// inside it, closes on Escape, and restores focus on unmount.
export function useDialogFocus(dialogRef: RefObject<HTMLElement | null>, onClose: () => void) {
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusables = () => Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(element => {
      if (element.matches(':disabled') || element.tabIndex < 0 || element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
      for (let node: HTMLElement | null = element; node; node = node.parentElement) {
        const style = window.getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
        if (node === dialog) break;
      }
      return true;
    });
    const previousTabIndex = dialog.getAttribute('tabindex');
    if (previousTabIndex === null) dialog.tabIndex = -1;
    // Child effects can run before their parent on a shared mount.
    const childIndex = dialogStack.findIndex(item => dialog.contains(item));
    if (childIndex === -1) dialogStack.push(dialog);
    else dialogStack.splice(childIndex, 0, dialog);
    if (dialogStack[dialogStack.length - 1] === dialog) (focusables()[0] ?? dialog).focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (dialogStack[dialogStack.length - 1] !== dialog) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !items.includes(active as HTMLElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !items.includes(active as HTMLElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      const wasTopmost = dialogStack[dialogStack.length - 1] === dialog;
      const index = dialogStack.lastIndexOf(dialog);
      if (index !== -1) dialogStack.splice(index, 1);
      if (previousTabIndex === null) dialog.removeAttribute('tabindex');
      if (wasTopmost && previous?.isConnected) previous.focus();
    };
  }, [dialogRef]);
}
