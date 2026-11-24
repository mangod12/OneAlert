import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { TimelineRecordedTime } from './TimelineRecordedTime';
afterEach(cleanup);
it('shows offset time as exact UTC matching filters and preserves raw source spelling in details', () => { render(<TimelineRecordedTime timestamp="2026-11-24T00:30:00+05:30" />); const time = screen.getByText('2026-11-23 19:00:00.000 UTC'); expect(time).toHaveAttribute('datetime', '2026-11-23T19:00:00.000Z'); expect(screen.getByText('Recorded timestamp: 2026-11-24T00:30:00+05:30')).toBeInTheDocument(); });
it('treats timezone-less ISO server time as UTC and avoids a browser-local time conversion', () => { render(<TimelineRecordedTime timestamp="2026-11-24T00:30:00" />); expect(screen.getByText('2026-11-24 00:30:00.000 UTC')).toBeInTheDocument(); expect(screen.getByText(/without an offset is treated as UTC/)).toBeInTheDocument(); });
it.each(['', 'bad', '2026-02-30T12:00:00Z', '2026-11-24T24:00:00Z'])('uses an explicit unavailable state rather than Invalid Date or a fabricated time: %s', timestamp => { render(<TimelineRecordedTime timestamp={timestamp} />); expect(screen.getByText('Recorded time unavailable')).toBeInTheDocument(); expect(screen.queryByText('Invalid Date')).not.toBeInTheDocument(); expect(document.querySelector('time')).toBeNull(); });
