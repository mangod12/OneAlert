import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StatusBadge } from './StatusBadge';

describe('StatusBadge', () => {
  it('renders its children', () => {
    render(<StatusBadge tone="danger">critical</StatusBadge>);
    expect(screen.getByText('critical')).toBeTruthy();
  });

  it('applies the tone classes', () => {
    const { container } = render(<StatusBadge tone="danger">critical</StatusBadge>);
    const badge = container.firstElementChild;
    expect(badge?.className).toContain('text-danger');
    expect(badge?.className).toContain('border-danger/30');
  });

  it('defaults to the neutral tone', () => {
    const { container } = render(<StatusBadge>unknown</StatusBadge>);
    expect(container.firstElementChild?.className).toContain('text-surface-300');
  });
});
