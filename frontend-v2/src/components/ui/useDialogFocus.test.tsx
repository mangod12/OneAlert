import { cleanup, fireEvent, render } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useDialogFocus } from './useDialogFocus';

function Harness({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, onClose);
  return (
    <div>
      <button type="button">outside</button>
      <div ref={dialogRef} role="dialog">
        <button type="button">first</button>
        <button type="button">middle</button>
        <button type="button">last</button>
      </div>
    </div>
  );
}

function getButton(name: string) {
  return Array.from(document.querySelectorAll('button')).find(b => b.textContent === name)!;
}

afterEach(() => cleanup());

describe('useDialogFocus', () => {
  it('moves focus to the first focusable element on mount', () => {
    render(<Harness onClose={() => {}} />);
    expect(document.activeElement).toBe(getButton('first'));
  });

  it('wraps Tab from the last element back to the first', () => {
    render(<Harness onClose={() => {}} />);
    getButton('last').focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(getButton('first'));
  });

  it('wraps Shift+Tab from the first element back to the last', () => {
    render(<Harness onClose={() => {}} />);
    getButton('first').focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(getButton('last'));
  });

  it('calls onClose on Escape', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('restores focus to the previously focused element on unmount', () => {
    function Wrapper() {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <button type="button" onClick={() => setOpen(true)}>trigger</button>
          {open && <Harness onClose={() => setOpen(false)} />}
        </div>
      );
    }
    render(<Wrapper />);
    const trigger = getButton('trigger');
    trigger.focus();
    fireEvent.click(trigger);
    expect(document.activeElement).toBe(getButton('first'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.activeElement).toBe(trigger);
  });
});
