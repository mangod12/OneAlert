interface Step { id: number; action: string; output_summary: string | null }
interface Receipt { format: string; prompt: number | null; completion: number | null; prompt_state: string; completion_state: string }
function parse(text: string | null): Receipt | null {
  try {
    const value = JSON.parse(text ?? '');
    if (!value || value.format !== 'onealert-provider-usage-v1' || (['prompt', 'completion'] as const).some(key => !['reported', 'missing', 'invalid'].includes(value[`${key}_state`]) || (value[`${key}_state`] === 'reported' ? !Number.isSafeInteger(value[key]) || value[key] < 0 || value[key] > 2147483647 : value[key] !== null))) return null;
    return value;
  } catch { return null; }
}
export function ProviderUsageEvidence({ steps, promptTokens, completionTokens }: { steps: Step[]; promptTokens: number; completionTokens: number }) {
  const records = Array.isArray(steps) ? steps.filter(step => step?.action === 'provider_usage_receipt') : [];
  const receipts = records.map(step => parse(step.output_summary)), valid = receipts.every(value => value !== null) && new Set(records.map(step => step.id)).size === records.length;
  const sums = { prompt: 0, completion: 0 };
  for (const receipt of receipts) if (receipt) for (const key of ['prompt', 'completion'] as const) sums[key] += receipt[key] ?? 0;
  const matches = valid && sums.prompt === promptTokens && sums.completion === completionTokens;
  return <section aria-label="Provider-reported token evidence" className="space-y-2 rounded border border-surface-700 p-3 text-xs text-surface-300">
    <h3 className="text-sm font-semibold text-surface-100">Provider-reported token evidence</h3>
    <p>Token counters are provider-reported metadata, not prices, spend totals, billing reconciliation, independently measured usage or proof of a successful response. Zero without usage receipts does not mean no tokens were used. Historical runs are not backfilled.</p>
    {!records.length ? <p>No provider usage receipts in this loaded run. Recorded aggregate token counts have unknown coverage.</p> : !valid ? <p role="alert" className="text-warning">Provider usage receipts are malformed. No usage coverage or reconciled token total is inferred.</p> : <>
      <p>{records.length} recorded completion {records.length === 1 ? 'receipt' : 'receipts'} · Prompt counters reported in {receipts.filter(value => value?.prompt_state === 'reported').length} · Completion counters reported in {receipts.filter(value => value?.completion_state === 'reported').length}.</p>
      <p>{matches ? 'Saved aggregate counts match the sums of valid reported counters in these receipts.' : 'Saved aggregate counts do not match these receipt sums. Do not treat the aggregate as reconciled usage.'} Missing or invalid counters are unknown, not reported zeros.</p>
      <p>Receipts describe returned JSON-completion responses observed by this run, including responses whose JSON was invalid. They do not cover transport failures without a response, hidden provider retries, embeddings, other processes or all account usage. No prompt or generated text is included in these receipt fields.</p>
      <details><summary className="cursor-pointer text-primary-300">Review recorded completion counters</summary><ol className="mt-2 space-y-2">{receipts.map((receipt, index) => <li key={records[index].id} className="break-words rounded border border-surface-700 p-2">Step record #{records[index].id}: prompt {receipt!.prompt_state === 'reported' ? receipt!.prompt : `unknown (${receipt!.prompt_state})`}; completion {receipt!.completion_state === 'reported' ? receipt!.completion : `unknown (${receipt!.completion_state})`}.</li>)}</ol></details>
    </>}
  </section>;
}
