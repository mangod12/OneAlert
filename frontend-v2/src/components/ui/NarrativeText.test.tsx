import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { NarrativeText } from './NarrativeText';

describe('NarrativeText', () => {
  it('renders **bold** markdown as strong elements', () => {
    const { container } = render(<NarrativeText text={'**Stage 1:** The attacker pivoted.'} />);
    const strong = container.querySelector('strong');
    expect(strong?.textContent).toBe('Stage 1:');
    expect(container.textContent).toContain('The attacker pivoted.');
    expect(container.textContent).not.toContain('**');
  });

  it('splits blank-line separated paragraphs', () => {
    const { container } = render(<NarrativeText text={'First paragraph.\n\nSecond paragraph.'} />);
    expect(container.querySelectorAll('p')).toHaveLength(2);
  });

  it('leaves plain text untouched', () => {
    const { container } = render(<NarrativeText text="No markup here." />);
    expect(container.querySelector('strong')).toBeNull();
    expect(container.textContent).toBe('No markup here.');
  });
});
