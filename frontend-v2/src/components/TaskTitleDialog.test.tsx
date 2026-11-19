import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TaskTitleDialog } from './TaskTitleDialog';
afterEach(cleanup);

describe('task title dialog', () => {
  it('requires a changed, nonblank title and saves trimmed wording', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn();
    render(<TaskTitleDialog title="Collect image" onSave={save} onClose={close} />);
    const input = screen.getByRole('textbox', { name: 'Task title' });
    const button = screen.getByRole('button', { name: 'Save task title' });
    expect(input).toHaveFocus();
    expect(button).toBeDisabled();
    fireEvent.change(input, { target: { value: '   ' } });
    expect(button).toBeDisabled();
    fireEvent.change(input, { target: { value: '  Collect memory image  ' } });
    fireEvent.click(button);
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(save).toHaveBeenCalledWith('Collect memory image');
  });

  it('keeps the draft on failure and allows retry', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce(undefined);
    const close = vi.fn();
    render(<TaskTitleDialog title="Collect image" onSave={save} onClose={close} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Collect memory image' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save task title' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('textbox')).toHaveValue('Collect memory image');
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save task title' }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
  });

  it('guards repeated save, cancel and escape while pending', async () => {
    let resolve!: () => void;
    const save = vi.fn(() => new Promise<void>(r => { resolve = r; }));
    const close = vi.fn();
    render(<TaskTitleDialog title="Collect image" onSave={save} onClose={close} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Collect memory image' } });
    const button = screen.getByRole('button', { name: 'Save task title' });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Cancel edit' })).toBeDisabled();
    expect(save).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
    resolve();
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
  });

  it('cancels without saving and caps title length', () => {
    const save = vi.fn();
    const close = vi.fn();
    render(<TaskTitleDialog title="Collect image" onSave={save} onClose={close} />);
    expect(screen.getByRole('textbox')).toHaveAttribute('maxlength', '300');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel edit' }));
    expect(close).toHaveBeenCalledOnce();
    expect(save).not.toHaveBeenCalled();
  });
});
