import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { MentionTextarea, type MentionMember } from './MentionTextarea';

const members: MentionMember[] = [
  { id: 1, email: 'will@example.com', full_name: 'Will Watch', is_active: true },
  { id: 2, email: 'sam@example.com', full_name: 'Sam Scout', is_active: true },
  { id: 3, email: 'gone@example.com', full_name: 'Gone Girl', is_active: false },
];

function Harness() {
  const [value, setValue] = useState('');
  return <MentionTextarea aria-label="Add a note" value={value} onChange={setValue} members={members} />;
}

function type(text: string) {
  const area = screen.getByLabelText('Add a note');
  fireEvent.change(area, { target: { value: text, selectionStart: text.length } });
  return area;
}

afterEach(cleanup);

describe('MentionTextarea', () => {
  it('shows matching members while typing an @token', () => {
    render(<Harness />);
    type('check @w');
    expect(screen.getByRole('option', { name: /Will Watch/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /Sam Scout/ })).toBeNull();
    expect(screen.queryByRole('option', { name: /Gone Girl/ })).toBeNull();
  });

  it('inserts the email local part and a trailing space on click', () => {
    render(<Harness />);
    type('hey @sa');
    fireEvent.mouseDown(screen.getByRole('option', { name: /Sam Scout/ }));
    expect((screen.getByLabelText('Add a note') as HTMLTextAreaElement).value).toBe('hey @sam ');
  });

  it('accepts the highlighted suggestion with Enter', () => {
    render(<Harness />);
    type('@w');
    fireEvent.keyDown(screen.getByLabelText('Add a note'), { key: 'Enter' });
    expect((screen.getByLabelText('Add a note') as HTMLTextAreaElement).value).toBe('@will ');
  });

  it('navigates suggestions with arrow keys', () => {
    render(<Harness />);
    const area = type('@');
    fireEvent.keyDown(area, { key: 'ArrowDown' });
    fireEvent.keyDown(area, { key: 'Enter' });
    expect((area as HTMLTextAreaElement).value).toBe('@sam ');
  });

  it('closes the popup on Escape and keeps the typed text', () => {
    render(<Harness />);
    const area = type('ping @w');
    fireEvent.keyDown(area, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect((area as HTMLTextAreaElement).value).toBe('ping @w');
  });

  it('does not open for emails or text without an @token', () => {
    render(<Harness />);
    type('mail will@example.com works');
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
