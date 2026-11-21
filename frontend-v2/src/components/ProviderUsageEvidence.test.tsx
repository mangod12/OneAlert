import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { ProviderUsageEvidence } from './ProviderUsageEvidence';
const step = (id: number, value = {}) => ({ id, action: 'provider_usage_receipt', output_summary: JSON.stringify({ format: 'onealert-provider-usage-v1', prompt: 0, completion: 4, prompt_state: 'reported', completion_state: 'reported', ...value }) });
afterEach(cleanup);
it('treats historical zero without receipts as unknown coverage', () => {
  render(<ProviderUsageEvidence steps={[]} promptTokens={0} completionTokens={0} />);
  expect(screen.getByText(/unknown coverage/)).toBeInTheDocument(); expect(screen.getByText(/Zero without usage receipts does not mean/)).toBeInTheDocument();
});
it('distinguishes reported zero and sums valid per-response counters', () => {
  render(<ProviderUsageEvidence steps={[step(1), step(2, { prompt: 5 })]} promptTokens={5} completionTokens={8} />);
  expect(screen.getByText(/Saved aggregate counts match/)).toBeInTheDocument(); expect(screen.getByText(/Step record #1: prompt 0; completion 4/)).toBeInTheDocument(); expect(screen.getByText(/Prompt counters reported in 2/)).toBeInTheDocument();
});
it('keeps missing and invalid counters unknown instead of a reported zero', () => {
  render(<ProviderUsageEvidence steps={[step(1, { prompt: null, prompt_state: 'missing', completion: null, completion_state: 'invalid' })]} promptTokens={0} completionTokens={0} />);
  expect(screen.getByText(/prompt unknown \(missing\); completion unknown \(invalid\)/)).toBeInTheDocument(); expect(screen.getByText(/Prompt counters reported in 0/)).toBeInTheDocument();
});
it('flags aggregate mismatch without claiming reconciled totals', () => {
  render(<ProviderUsageEvidence steps={[step(1)]} promptTokens={99} completionTokens={4} />);
  expect(screen.getByText(/do not match these receipt sums/)).toBeInTheDocument();
});
it.each(['bad JSON', JSON.stringify({ format: 'wrong' }), JSON.stringify({ format: 'onealert-provider-usage-v1', prompt: -1, prompt_state: 'reported', completion: 0, completion_state: 'reported' }), JSON.stringify({ format: 'onealert-provider-usage-v1', prompt: 0, prompt_state: 'missing', completion: 0, completion_state: 'reported' })])('refuses malformed receipts %#', output_summary => {
  render(<ProviderUsageEvidence steps={[{ id: 1, action: 'provider_usage_receipt', output_summary }]} promptTokens={0} completionTokens={0} />);
  expect(screen.getByRole('alert')).toHaveTextContent('malformed'); expect(screen.queryByText(/Saved aggregate counts match/)).not.toBeInTheDocument();
});
it('does not count an unrelated step even if text resembles a receipt', () => {
  render(<ProviderUsageEvidence steps={[{ ...step(1), action: 'unrelated' }]} promptTokens={0} completionTokens={0} />);
  expect(screen.getByText(/No provider usage receipts/)).toBeInTheDocument();
});
it('rejects duplicate receipt source identities', () => {
  render(<ProviderUsageEvidence steps={[step(1), step(1)]} promptTokens={0} completionTokens={8} />); expect(screen.getByRole('alert')).toBeInTheDocument();
});
