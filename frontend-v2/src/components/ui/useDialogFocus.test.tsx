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

function CustomDialog({ children, onClose = () => {} }: { children?: React.ReactNode; onClose?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(ref, onClose);
  return <div ref={ref} role="dialog">{children}</div>;
}

describe('dialog focus safety', () => {
  it('ignores hidden, inert, disabled and negative-tabindex controls', () => {
    render(<CustomDialog><button hidden>hidden</button><div style={{ display: 'none' }}><button>css hidden</button></div><div inert><button>inert</button></div><fieldset disabled><button>fieldset</button></fieldset><button tabIndex={-1}>programmatic</button><button>visible</button></CustomDialog>);
    expect(document.activeElement).toBe(getButton('visible'));
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(getButton('visible'));
  });

  it('focuses an empty dialog and retains focus on Tab', () => {
    render(<CustomDialog />);
    const dialog = document.querySelector('[role="dialog"]');
    expect(document.activeElement).toBe(dialog);
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(dialog);
  });

  it('recovers focus when all controls become disabled', () => {
    const view = render(<CustomDialog><button>available</button></CustomDialog>);
    view.rerender(<CustomDialog><button disabled>available</button></CustomDialog>);
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(document.querySelector('[role="dialog"]'));
  });

  it('handles Escape only on the topmost dialog and restores the underlying focus', () => {
    const parentClose = vi.fn();
    function Nested() {
      const [open, setOpen] = useState(false);
      return <CustomDialog onClose={parentClose}><button onClick={() => setOpen(true)}>open child</button>{open && <CustomDialog onClose={() => setOpen(false)}><button>child</button></CustomDialog>}</CustomDialog>;
    }
    render(<Nested />);
    const trigger = getButton('open child');
    fireEvent.click(trigger);
    expect(document.activeElement).toBe(getButton('child'));
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(getButton('child'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(parentClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(parentClose).toHaveBeenCalledTimes(1);
  });

  it('keeps an initially mounted nested dialog on top', () => {
    const parentClose = vi.fn();
    const childClose = vi.fn();
    render(<CustomDialog onClose={parentClose}><button>parent</button><CustomDialog onClose={childClose}><button>nested</button></CustomDialog></CustomDialog>);
    expect(document.activeElement).toBe(getButton('nested'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(childClose).toHaveBeenCalledTimes(1);
    expect(parentClose).not.toHaveBeenCalled();
  });

  it('recovers focus from the dialog container in both directions', () => {
    render(<CustomDialog><button>start</button><button>end</button></CustomDialog>);
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    dialog.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(getButton('end'));
    dialog.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(getButton('start'));
  });
});
