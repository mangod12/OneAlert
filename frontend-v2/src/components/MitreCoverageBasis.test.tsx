import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { MitreCoverageBasis } from './MitreCoverageBasis';
vi.mock('../api/client', () => ({ default: { get: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const row = { technique_id: 'T1190', name: 'Gateway technique', tactics: ['TA0001'], case_count: 2, enabled_rule_count: 1, disabled_rule_count: 0, unknown_rule_state_count: 0, basis: 'both' };
const snapshot = () => ({ total_techniques: 4, catalog_scope: 'Embedded catalog subset.', retrieved_at: '2026-11-21T00:00:00Z', tactics: [{ id: 'TA0001', name: 'Initial Access' }], counts: { both: 1, case_only: 1, rule_only: 1, unmapped: 1 }, records: [row, { ...row, technique_id: 'T1110', name: 'Case only', enabled_rule_count: 0, basis: 'case_only' }, { ...row, technique_id: 'T1078', name: 'Rule only', case_count: 0, basis: 'rule_only' }, { ...row, technique_id: 'T1133', name: 'Disabled only', case_count: 0, enabled_rule_count: 0, disabled_rule_count: 1, basis: 'unmapped' }] });
async function show() { render(<MitreCoverageBasis />); expect(get).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: /Explain coverage/ })); await screen.findByText('T1190: Gateway technique'); }
beforeEach(() => { get.mockReset(); get.mockResolvedValue({ data: snapshot() }); });
afterEach(cleanup);
it('distinguishes case and rule provenance without claiming tested detection', async () => {
  await show(); expect(screen.getByText(/Neither establishes tested detection/)).toBeInTheDocument();
  expect(screen.getByText('2 cases · 1 enabled rules · 0 disabled rules · 0 rules with unknown state.')).toBeInTheDocument();
  expect(screen.getByText(/4 of 4 catalog techniques match/)).toBeInTheDocument();
  expect(get).toHaveBeenCalledExactlyOnceWith('/mitre/coverage-basis');
});
it('filters case-only, enabled-only, unmapped and disabled references locally', async () => {
  await show(); fireEvent.change(screen.getByRole('combobox', { name: 'Coverage mapping basis' }), { target: { value: 'case_only' } });
  expect(screen.getByText('T1110: Case only')).toBeInTheDocument(); expect(screen.queryByText('T1190: Gateway technique')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Clear coverage basis filters' }));
  fireEvent.click(screen.getByRole('checkbox')); expect(screen.getByText('T1133: Disabled only')).toBeInTheDocument();
  expect(screen.getByText(/1 of 4 catalog techniques match/)).toBeInTheDocument(); expect(get).toHaveBeenCalledOnce();
});
it('searches exact-ID text and combines tactic and basis filters', async () => {
  await show(); fireEvent.change(screen.getByRole('searchbox'), { target: { value: ' T1190 ' } });
  expect(screen.getByText(/1 of 4 catalog techniques match/)).toBeInTheDocument();
  fireEvent.change(screen.getByRole('combobox', { name: 'Coverage basis tactic' }), { target: { value: 'TA0001' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Coverage mapping basis' }), { target: { value: 'rule_only' } });
  expect(screen.getByText(/No catalog techniques match/)).toBeInTheDocument();
});
it('pages loaded catalog evidence rather than truncating the source record set', async () => {
  const data = snapshot(); data.records = Array.from({ length: 23 }, (_, index) => ({ ...row, technique_id: `T${1000 + index}` })); data.total_techniques = 23; data.counts = { both: 23, case_only: 0, rule_only: 0, unmapped: 0 }; get.mockResolvedValue({ data });
  render(<MitreCoverageBasis />); fireEvent.click(screen.getByRole('button', { name: /Explain coverage/ }));
  await screen.findByText('T1000: Gateway technique'); expect(screen.getAllByRole('listitem')).toHaveLength(10);
  fireEvent.click(screen.getByRole('button', { name: 'More basis techniques' })); expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'T1022' } }); expect(screen.getByText('T1022: Gateway technique')).toBeInTheDocument(); expect(screen.getByText('Page 1 of 1')).toBeInTheDocument();
});
it.each(['counts', 'records', 'total_techniques', 'retrieved_at'])('fails closed on inconsistent %s', async field => {
  get.mockResolvedValue({ data: { ...snapshot(), [field]: 'wrong' } });
  render(<MitreCoverageBasis />); fireEvent.click(screen.getByRole('button', { name: /Explain coverage/ }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Missing evidence is unknown');
  expect(screen.queryByText('T1190: Gateway technique')).not.toBeInTheDocument();
});
it('retries unavailable coverage without inferring gaps', async () => {
  get.mockRejectedValueOnce(new Error('Unavailable')); render(<MitreCoverageBasis />); fireEvent.click(screen.getByRole('button', { name: /Explain coverage/ }));
  await screen.findByRole('alert'); fireEvent.click(screen.getByRole('button', { name: 'Retry coverage basis' }));
  expect(await screen.findByText('T1190: Gateway technique')).toBeInTheDocument();
});
it('hands the exact catalog technique to full association review', async () => {
  const select = vi.fn(); render(<MitreCoverageBasis onSelectTechnique={select} />);
  fireEvent.click(screen.getByRole('button', { name: /Explain coverage/ })); await screen.findByText('T1190: Gateway technique');
  fireEvent.click(screen.getByRole('button', { name: 'Review saved associations for T1190' })); expect(select).toHaveBeenCalledExactlyOnceWith('T1190');
});
