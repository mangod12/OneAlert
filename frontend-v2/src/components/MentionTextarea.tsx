import { useMemo, useRef, useState } from 'react';

export interface MentionMember {
  id: number;
  email: string;
  full_name: string | null;
  is_active: boolean;
}

interface MentionTextareaProps {
  value: string;
  onChange: (value: string) => void;
  members: MentionMember[];
  id?: string;
  rows?: number;
  maxLength?: number;
  placeholder?: string;
  className?: string;
  'aria-label'?: string;
}

interface TokenMatch {
  start: number;
  query: string;
}

// Finds the "@token" currently being typed at the caret, if any. A token
// starts at @ preceded by start/whitespace and runs until whitespace.
function activeToken(text: string, caret: number): TokenMatch | null {
  const before = text.slice(0, caret);
  const match = /(?:^|\s)@([A-Za-z0-9._-]*)$/.exec(before);
  if (!match) return null;
  return { start: caret - match[1].length - 1, query: match[1].toLowerCase() };
}

export function MentionTextarea({ value, onChange, members, id, rows = 2, maxLength, placeholder, className, ...rest }: MentionTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [token, setToken] = useState<TokenMatch | null>(null);
  const [highlight, setHighlight] = useState(0);

  const suggestions = useMemo(() => {
    if (!token) return [];
    return members
      .filter(m => m.is_active)
      .filter(m => {
        if (!token.query) return true;
        const local = m.email.split('@', 1)[0].toLowerCase();
        return local.startsWith(token.query) || (m.full_name ?? '').toLowerCase().includes(token.query);
      })
      .slice(0, 6);
  }, [members, token]);

  const open = token !== null && suggestions.length > 0;

  const syncToken = (text: string, caret: number) => {
    setToken(activeToken(text, caret));
    setHighlight(0);
  };

  const accept = (member: MentionMember) => {
    if (!token) return;
    const local = member.email.split('@', 1)[0];
    const next = `${value.slice(0, token.start)}@${local} ${value.slice(ref.current?.selectionStart ?? value.length)}`;
    onChange(next);
    setToken(null);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      const caret = token.start + local.length + 2;
      el.setSelectionRange(caret, caret);
    });
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open) return;
    if (event.key === 'ArrowDown') { event.preventDefault(); setHighlight(h => (h + 1) % suggestions.length); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setHighlight(h => (h - 1 + suggestions.length) % suggestions.length); }
    else if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); accept(suggestions[highlight]); }
    else if (event.key === 'Escape') { event.preventDefault(); setToken(null); }
  };

  return (
    <div className="relative min-w-0 flex-1">
      <textarea
        ref={ref}
        id={id}
        rows={rows}
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        className={className}
        onChange={event => {
          onChange(event.target.value);
          syncToken(event.target.value, event.target.selectionStart ?? event.target.value.length);
        }}
        onKeyDown={handleKeyDown}
        onBlur={() => { window.setTimeout(() => setToken(null), 150); }}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-controls={open ? 'mention-suggestions' : undefined}
        aria-activedescendant={open ? `mention-option-${suggestions[highlight]?.id}` : undefined}
        {...rest}
      />
      {open && (
        <ul
          id="mention-suggestions"
          role="listbox"
          aria-label="Mention a teammate"
          className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-md border border-surface-700 bg-surface-900 shadow-lg"
        >
          {suggestions.map((member, index) => (
            <li
              key={member.id}
              id={`mention-option-${member.id}`}
              role="option"
              aria-selected={index === highlight}
              className={`cursor-pointer px-3 py-1.5 text-sm ${index === highlight ? 'bg-surface-700 text-surface-50' : 'text-surface-200'}`}
              onMouseDown={event => { event.preventDefault(); accept(member); }}
            >
              {member.full_name ? `${member.full_name} (${member.email})` : member.email}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
