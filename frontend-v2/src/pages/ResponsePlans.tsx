import { useState, useEffect } from 'react';
import apiClient from '../api/client';
import { CheckCircle, XCircle, Play, Clock, Shield } from 'lucide-react';
import clsx from 'clsx';
import { toast } from '../components/Toast';

interface ResponsePlan {
  id: number;
  case_id: number;
  actions: any[];
  status: string;
  autonomy_level: string;
  created_by: string;
  approved_by: number | null;
  approved_at: string | null;
  created_at: string;
}

interface PendingApproval {
  id: number;
  plan_id: number;
  case_id: number;
  status: string;
  reason: string;
  actions: any[];
  autonomy_level: string;
  created_at: string;
}

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-surface-600/20 text-surface-400',
  pending_approval: 'bg-amber-500/20 text-amber-400',
  approved: 'bg-green-500/20 text-green-400',
  executing: 'bg-blue-500/20 text-blue-400',
  completed: 'bg-emerald-500/20 text-emerald-400',
  rejected: 'bg-red-500/20 text-red-400',
  partial: 'bg-orange-500/20 text-orange-400',
};

export function ResponsePlans() {
  const [plans, setPlans] = useState<ResponsePlan[]>([]);
  const [pending, setPending] = useState<PendingApproval[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<ResponsePlan | null>(null);

  const fetchPlans = async () => {
    try {
      const res = await apiClient.get('/response-plans/');
      setPlans(res.data.data || []);
    } catch (err) { console.error(err); }
  };

  const fetchPending = async () => {
    try {
      const res = await apiClient.get('/response-plans/pending-approvals');
      setPending(res.data.data || []);
    } catch (err) { console.error(err); }
  };

  const approvePlan = async (planId: number) => {
    try {
      await apiClient.post(`/response-plans/${planId}/approve`);
      toast('Plan approved', 'success');
      await Promise.all([fetchPlans(), fetchPending()]);
    } catch (err) { console.error(err); toast('Failed to approve plan', 'error'); }
  };

  const rejectPlan = async (planId: number) => {
    try {
      await apiClient.post(`/response-plans/${planId}/reject`, { reason: 'Manual rejection' });
      toast('Plan rejected', 'warning');
      await Promise.all([fetchPlans(), fetchPending()]);
    } catch (err) { console.error(err); toast('Failed to reject plan', 'error'); }
  };

  const executePlan = async (planId: number) => {
    try {
      await apiClient.post(`/response-plans/${planId}/execute`);
      toast('Plan executed successfully', 'success');
      await fetchPlans();
    } catch (err) { console.error(err); toast('Execution failed', 'error'); }
  };

  useEffect(() => { fetchPlans(); fetchPending(); }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Response Plans</h1>
        <p className="text-surface-400 text-sm mt-1">AI-generated response plans with human approval workflow</p>
      </div>

      {/* Pending Approvals */}
      {pending.length > 0 && (
        <div className="bg-amber-500/5 border border-amber-500/30 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-amber-400 mb-4 flex items-center gap-2">
            <Clock className="w-5 h-5" />
            Pending Approvals ({pending.length})
          </h2>
          <div className="space-y-3">
            {pending.map(a => (
              <div key={a.id} className="bg-surface-900/50 rounded-lg p-4 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div className="flex-1">
                  <p className="text-sm text-white font-medium">Plan #{a.plan_id} — Case #{a.case_id}</p>
                  <p className="text-xs text-surface-400 mt-1">{a.reason}</p>
                  <p className="text-xs text-surface-500 mt-1">
                    {a.actions?.length || 0} actions · Level {a.autonomy_level}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => approvePlan(a.plan_id)}
                    className="flex items-center gap-1 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded text-xs font-medium transition-colors">
                    <CheckCircle className="w-3.5 h-3.5" /> Approve
                  </button>
                  <button onClick={() => rejectPlan(a.plan_id)}
                    className="flex items-center gap-1 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded text-xs font-medium transition-colors">
                    <XCircle className="w-3.5 h-3.5" /> Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Plans Table */}
      <div className="bg-surface-800/50 border border-surface-700 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4">All Response Plans</h2>
        {plans.length === 0 ? (
          <p className="text-surface-500 text-sm">No response plans yet. Run the agent pipeline to generate plans.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-700 text-surface-500 text-xs">
                  <th className="text-left p-3">ID</th>
                  <th className="text-left p-3">Case</th>
                  <th className="text-left p-3">Actions</th>
                  <th className="text-left p-3">Level</th>
                  <th className="text-left p-3">Status</th>
                  <th className="text-left p-3">Created</th>
                  <th className="text-left p-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {plans.map(p => (
                  <tr key={p.id} className="border-b border-surface-800 hover:bg-surface-800/50 cursor-pointer"
                    onClick={() => setSelectedPlan(selectedPlan?.id === p.id ? null : p)}>
                    <td className="p-3 text-surface-300">#{p.id}</td>
                    <td className="p-3 text-surface-300">Case #{p.case_id}</td>
                    <td className="p-3 text-surface-300">{p.actions?.length || 0}</td>
                    <td className="p-3"><span className="text-xs px-2 py-0.5 rounded bg-primary-500/20 text-primary-400">{p.autonomy_level}</span></td>
                    <td className="p-3">
                      <span className={clsx('text-xs px-2 py-0.5 rounded', STATUS_STYLES[p.status] || STATUS_STYLES.draft)}>
                        {p.status}
                      </span>
                    </td>
                    <td className="p-3 text-surface-500 text-xs">{new Date(p.created_at).toLocaleString()}</td>
                    <td className="p-3">
                      {p.status === 'approved' && (
                        <button onClick={e => { e.stopPropagation(); executePlan(p.id); }}
                          className="flex items-center gap-1 px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs transition-colors">
                          <Play className="w-3 h-3" /> Execute
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Plan Detail */}
      {selectedPlan && (
        <div className="bg-surface-800/50 border border-surface-700 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary-400" />
            Plan #{selectedPlan.id} Actions
          </h2>
          <div className="space-y-2">
            {selectedPlan.actions?.map((action: any, i: number) => (
              <div key={i} className="flex items-center gap-4 p-3 bg-surface-900/50 rounded-lg">
                <span className="text-xs font-mono text-surface-500 w-6">#{action.priority || i + 1}</span>
                <span className={clsx('text-xs px-2 py-0.5 rounded font-medium',
                  action.policy_check?.approved ? 'bg-green-500/20 text-green-400' : 'bg-amber-500/20 text-amber-400')}>
                  {action.action_type}
                </span>
                <span className="text-sm text-surface-300 flex-1">{action.target}</span>
                <span className="text-xs text-surface-500">{action.reason}</span>
                {action.execution_result && (
                  <span className={clsx('text-xs px-2 py-0.5 rounded',
                    action.execution_result.status === 'completed' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400')}>
                    {action.execution_result.status}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
