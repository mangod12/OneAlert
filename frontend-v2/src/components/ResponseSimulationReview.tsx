import { useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
import { checkedTaskAccount } from '../utils/taskSnapshotReview';
import { useDialogFocus } from './ui/useDialogFocus';
interface Action { action_type: string; target: string; priority?: number; [key: string]: unknown }
interface Row { source_position: number; action_type: string; target: string; priority: number; simulation_order: number; shape_valid: boolean; handler_available: boolean }
interface Evidence { plan: { id: number; case_id: number; status: string; autonomy_level: string; actions: Action[] }; execution_mode: string; reviewed_fingerprint: string; preflight: { action_count: number; supported_count: number; unsupported_count: number; invalid_count: number; shape_valid: boolean; order_available: boolean; records: Row[] } }
function checkedEvidence(value: Evidence, planId: number) {
  const plan = value?.plan, flight = value?.preflight;
  if (!plan || plan.id !== planId || !Number.isSafeInteger(plan.case_id) || plan.case_id < 1 || plan.status !== 'approved' || !['L0', 'L1', 'L2', 'L3', 'L4'].includes(plan.autonomy_level) || value.execution_mode !== 'simulated' || !/^[a-f0-9]{64}$/.test(value.reviewed_fingerprint) || !Array.isArray(plan.actions) || !plan.actions.length || plan.actions.length > 5000 || !flight || flight.shape_valid !== true || flight.order_available !== true || flight.invalid_count !== 0 || flight.action_count !== plan.actions.length || !Array.isArray(flight.records) || flight.records.length !== plan.actions.length) throw Error('Incomplete simulation evidence.');
  if (!flight.records.every((row, index) => {
    const action = plan.actions[index], priority = action?.priority ?? 99;
    return action && typeof action === 'object' && !Array.isArray(action) && typeof action.action_type === 'string' && !!action.action_type.trim() && typeof action.target === 'string' && !!action.target.trim() && typeof priority === 'number' && Number.isFinite(priority) && Math.abs(priority) <= Number.MAX_SAFE_INTEGER && row && row.source_position === index + 1 && row.action_type === action.action_type && row.target === action.target && row.priority === priority && row.shape_valid === true && typeof row.handler_available === 'boolean' && Number.isSafeInteger(row.simulation_order) && row.simulation_order > 0 && row.simulation_order <= plan.actions.length;
  }) || new Set(flight.records.map(row => row.simulation_order)).size !== plan.actions.length || flight.supported_count !== flight.records.filter(row => row.handler_available).length || flight.unsupported_count !== flight.records.filter(row => !row.handler_available).length) throw Error('Simulation readiness did not match saved actions.');
  const order = [...flight.records].sort((a, b) => a.priority - b.priority);
  if (!order.every((row, index) => row.simulation_order === index + 1)) throw Error('Simulation order did not match saved priorities.');
  return value;
}
export function ResponseSimulationReview({ planId, onCancel, onCompleted }: { planId: number; onCancel: () => void; onCompleted: () => void }) {
  const [evidence, setEvidence] = useState<Evidence | null>(null), [account, setAccount] = useState<ReturnType<typeof checkedTaskAccount> | null>(null), [ack, setAck] = useState(false), [busy, setBusy] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const dialog = useRef<HTMLDivElement>(null), reads = useRef(0), saving = useRef(false);
  useDialogFocus(dialog, () => { if (!busy) onCancel(); });
  useEffect(() => { let active = true; const id = ++reads.current;
    Promise.all([apiClient.get(`/response-plans/${planId}/simulation-review`), apiClient.get('/auth/me')]).then(([source, who]) => { if (!active || id !== reads.current) return; setEvidence(checkedEvidence(source.data, planId)); setAccount(checkedTaskAccount(who.data)); }).catch(() => { if (active) setError('Exact approved plan, local simulation readiness or current account could not be verified. No simulation was sent. Close and load a fresh review.'); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; reads.current += 1; };
  }, [planId]);
  const simulate = async () => {
    if (busy || saving.current || !ack || !evidence || !account) return;
    saving.current = true; setBusy(true); setError(''); const frozen = evidence, id = ++reads.current; setEvidence(null); let sent = false;
    try {
      const who = checkedTaskAccount((await apiClient.get('/auth/me')).data);
      if (id !== reads.current) return;
      if (JSON.stringify(who) !== JSON.stringify(account)) throw Error('Current account changed.');
      sent = true; const response = await apiClient.post(`/response-plans/${planId}/simulate-reviewed`, { reviewed_fingerprint: frozen.reviewed_fingerprint });
      if (id !== reads.current) return;
      const result = response.data?.data, count = frozen.plan.actions.length;
      if (response.status !== 200 || response.data?.success !== true || result?.plan_id !== planId || result.execution_mode !== 'simulated' || result.total_actions !== count || !Number.isSafeInteger(result.succeeded) || !Number.isSafeInteger(result.failed) || result.succeeded < 0 || result.failed < 0 || result.succeeded + result.failed !== count || result.status !== (result.failed === 0 ? 'completed' : 'partial') || !Array.isArray(result.results) || result.results.length !== count) throw Error('Simulation result could not be verified.');
      const ordered = [...frozen.plan.actions].sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
      let succeeded = 0;
      for (let index = 0; index < count; index++) {
        const row = result.results[index], action = ordered[index];
        if (!row || row.action !== action.action_type || row.target !== action.target || row.execution_mode !== 'simulated' || !['completed', 'failed', 'skipped', 'error'].includes(row.status) || typeof row.detail !== 'string' || typeof row.executed_at !== 'string' || Number.isNaN(Date.parse(row.executed_at))) throw Error('Action outcome did not match.');
        if (row.status === 'completed') succeeded++;
      }
      if (succeeded !== result.succeeded) throw Error('Action counts did not match.');
      setNotice(`Simulation recorded for plan #${planId}: ${result.succeeded} of ${count} simulated actions succeeded; ${result.failed} failed or skipped. Saved plan status: ${result.status}. No external action was performed. Review refreshed decision evidence for individual results.`); onCompleted();
    } catch { if (id === reads.current) setError(sent ? 'Simulation could not be confirmed and may already have recorded results. No automatic retry was sent. Close and check fresh decision evidence before any further action.' : 'The current account could not be reverified. No simulation mutation was sent. Close and load a fresh review.'); }
    finally { if (id === reads.current) { saving.current = false; setBusy(false); } }
  };
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-950/80 p-4"><div ref={dialog} role="dialog" aria-modal="true" aria-label={`Review local simulation of plan ${planId}`} className="max-h-[90dvh] w-full max-w-2xl space-y-4 overflow-y-auto rounded-xl border border-surface-700 bg-surface-900 p-5 [overflow-wrap:anywhere]">
    <h2 className="text-lg font-semibold">Review local simulation of plan #{planId}</h2>{busy && <p role="status" className="text-sm">Checking exact simulation evidence...</p>}{error && <p role="alert" className="text-sm text-warning">{error}</p>}{notice && <p role="status" className="text-sm text-warning">{notice}</p>}
    {evidence && account && <><p className="text-xs">Account #{account.id} · {account.email} · {account.role} · Organization {account.org_id ?? 'None'}</p><p className="text-sm">Investigation #{evidence.plan.case_id} · Plan #{planId} · approved → executing → completed or partial · {evidence.plan.autonomy_level}</p>
      <p className="text-sm">{evidence.preflight.action_count} saved actions · {evidence.preflight.supported_count} recognized local handlers · {evidence.preflight.unsupported_count} unsupported actions will be skipped</p>
      <ol aria-label="Saved actions in simulation order" className="space-y-2">{[...evidence.preflight.records].sort((a, b) => a.simulation_order - b.simulation_order).map(row => <li key={row.source_position} className="rounded border border-surface-700 p-3 text-xs"><p>Simulation order {row.simulation_order} · Saved position {row.source_position} · {row.handler_available ? 'Local simulation handler' : 'Unsupported: will be skipped'}</p><pre className="mt-1 whitespace-pre-wrap break-all">{JSON.stringify(evidence.plan.actions[row.source_position - 1], null, 2)}</pre></li>)}</ol>
      <p className="text-sm text-warning">Simulation only. No external action is performed. This does not notify responders, create tickets, isolate hosts, block traffic or change accounts. Supported handlers are not configured live integrations. Recorded policy flags are not fresh permission or a safety check.</p>
      <p className="text-sm">This does change saved plan status and replaces saved action results in priority order. It is not a dry read. Unknown actions are recorded as skipped and make the plan partial. Existing results can be replaced; this review creates no backup. Target safety, ownership, reachability and rollback readiness are not validated.</p>
      <p className="text-xs text-surface-400">The server checks ownership, approved state, exact saved plan, approval metadata and handler registry fingerprint before running local handlers. Changed evidence requires a fresh review.</p>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" disabled={busy} checked={ack} onChange={event => setAck(event.target.checked)} />I reviewed the exact saved actions and understand that only local simulation results and plan status will change.</label><button type="button" disabled={busy || !ack} onClick={() => void simulate()} className="rounded bg-primary-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">Run reviewed local simulation</button>
    </>}
    <button type="button" disabled={busy} onClick={onCancel} className="rounded border border-surface-600 px-3 py-2 text-sm disabled:opacity-40">Close simulation review</button>
  </div></div>;
}
