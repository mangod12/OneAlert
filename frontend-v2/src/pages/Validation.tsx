import { useState, useEffect } from 'react';
import apiClient from '../api/client';
import { Play, Plus, ShieldCheck, Target, CheckCircle, XCircle } from 'lucide-react';
import clsx from 'clsx';
import { toast } from '../components/Toast';

interface ValidationRun {
  id: number;
  name: string;
  description: string | null;
  status: string;
  mode: string;
  mitre_techniques: string[];
  results_summary: { tested: number; detected: number; missed: number; detection_rate: number } | null;
  created_at: string;
}

const AVAILABLE_TECHNIQUES = [
  { id: 'T1059', name: 'Command and Scripting Interpreter' },
  { id: 'T1071', name: 'Application Layer Protocol' },
  { id: 'T1110', name: 'Brute Force' },
  { id: 'T1190', name: 'Exploit Public-Facing Application' },
  { id: 'T1078', name: 'Valid Accounts' },
  { id: 'T1021', name: 'Remote Services' },
  { id: 'T1046', name: 'Network Service Discovery' },
  { id: 'T1486', name: 'Data Encrypted for Impact' },
];

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-surface-600/20 text-surface-400',
  running: 'bg-blue-500/20 text-blue-400',
  completed: 'bg-green-500/20 text-green-400',
  failed: 'bg-red-500/20 text-red-400',
};

export function Validation() {
  const [runs, setRuns] = useState<ValidationRun[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedRun, setSelectedRun] = useState<any>(null);
  const [newRun, setNewRun] = useState({ name: '', description: '', techniques: [] as string[] });
  const [creating, setCreating] = useState(false);

  const fetchRuns = async () => {
    try {
      const res = await apiClient.get('/validation/runs');
      setRuns(res.data.data || []);
    } catch (err) { console.error(err); }
  };

  const createRun = async () => {
    if (!newRun.name.trim() || newRun.techniques.length === 0) return;
    setCreating(true);
    try {
      await apiClient.post('/validation/runs', {
        name: newRun.name,
        description: newRun.description,
        mode: 'dry_run',
        mitre_techniques: newRun.techniques,
      });
      setShowCreate(false);
      setNewRun({ name: '', description: '', techniques: [] });
      toast('Validation run created', 'success');
      await fetchRuns();
    } catch (err) { console.error(err); toast('Failed to create run', 'error'); }
    finally { setCreating(false); }
  };

  const executeRun = async (runId: number) => {
    try {
      await apiClient.post(`/validation/runs/${runId}/execute`);
      toast('Validation complete', 'success');
      await fetchRuns();
      await viewRun(runId);
    } catch (err) { console.error(err); toast('Execution failed', 'error'); }
  };

  const viewRun = async (runId: number) => {
    try {
      const res = await apiClient.get(`/validation/runs/${runId}`);
      setSelectedRun(res.data.data);
    } catch (err) { console.error(err); }
  };

  const toggleTechnique = (techId: string) => {
    setNewRun(prev => ({
      ...prev,
      techniques: prev.techniques.includes(techId)
        ? prev.techniques.filter(t => t !== techId)
        : [...prev.techniques, techId],
    }));
  };

  useEffect(() => { fetchRuns(); }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Purple-Team Validation</h1>
          <p className="text-surface-400 text-sm mt-1">Test detection controls against simulated ATT&CK techniques</p>
        </div>
        <button onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm font-medium transition-colors">
          <Plus className="w-4 h-4" /> New Validation
        </button>
      </div>

      {/* Create Form */}
      {showCreate && (
        <div className="bg-surface-800/50 border border-surface-700 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Create Validation Run</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-surface-300 mb-1">Name</label>
              <input type="text" value={newRun.name} onChange={e => setNewRun({ ...newRun, name: e.target.value })}
                placeholder="e.g. Weekly Detection Coverage Test"
                className="w-full px-4 py-2 bg-surface-900 border border-surface-600 rounded-lg text-white placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-surface-300 mb-2">ATT&CK Techniques</label>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {AVAILABLE_TECHNIQUES.map(t => (
                  <button key={t.id} onClick={() => toggleTechnique(t.id)}
                    className={clsx('p-2 rounded-lg text-left text-xs border transition-colors',
                      newRun.techniques.includes(t.id)
                        ? 'border-primary-500 bg-primary-500/10 text-primary-300'
                        : 'border-surface-700 bg-surface-900/50 text-surface-400 hover:border-surface-600')}>
                    <span className="font-mono font-medium">{t.id}</span>
                    <p className="text-xs mt-0.5 truncate">{t.name}</p>
                  </button>
                ))}
              </div>
            </div>
            <button onClick={createRun} disabled={creating || !newRun.name.trim() || newRun.techniques.length === 0}
              className="px-6 py-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors">
              {creating ? 'Creating...' : 'Create Run'}
            </button>
          </div>
        </div>
      )}

      {/* Runs List */}
      <div className="bg-surface-800/50 border border-surface-700 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Validation Runs</h2>
        {runs.length === 0 ? (
          <p className="text-surface-500 text-sm">No validation runs yet. Create one to test your detection coverage.</p>
        ) : (
          <div className="space-y-3">
            {runs.map(r => (
              <div key={r.id} className="flex items-center gap-4 p-4 bg-surface-900/50 rounded-lg cursor-pointer hover:bg-surface-900/80 transition-colors"
                onClick={() => viewRun(r.id)}>
                <ShieldCheck className="w-5 h-5 text-primary-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white font-medium">{r.name}</p>
                  <p className="text-xs text-surface-500">
                    {r.mitre_techniques?.length || 0} techniques · {r.mode} · {new Date(r.created_at).toLocaleDateString()}
                  </p>
                </div>
                {r.results_summary && (
                  <div className="text-right">
                    <p className={clsx('text-lg font-bold', r.results_summary.detection_rate >= 70 ? 'text-green-400' : r.results_summary.detection_rate >= 40 ? 'text-amber-400' : 'text-red-400')}>
                      {r.results_summary.detection_rate}%
                    </p>
                    <p className="text-xs text-surface-500">{r.results_summary.detected}/{r.results_summary.tested} detected</p>
                  </div>
                )}
                <span className={clsx('text-xs px-2 py-0.5 rounded', STATUS_STYLES[r.status] || STATUS_STYLES.pending)}>
                  {r.status}
                </span>
                {r.status === 'pending' && (
                  <button onClick={e => { e.stopPropagation(); executeRun(r.id); }}
                    className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-medium transition-colors">
                    <Play className="w-3 h-3" /> Run
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Run Detail */}
      {selectedRun && (
        <div className="bg-surface-800/50 border border-surface-700 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Target className="w-5 h-5 text-primary-400" />
            {selectedRun.name} — Results
          </h2>

          {selectedRun.results_summary && (
            <div className="grid grid-cols-4 gap-4 mb-6">
              <div className="bg-surface-900/50 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-white">{selectedRun.results_summary.tested}</p>
                <p className="text-xs text-surface-500">Tests Run</p>
              </div>
              <div className="bg-surface-900/50 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-green-400">{selectedRun.results_summary.detected}</p>
                <p className="text-xs text-surface-500">Detected</p>
              </div>
              <div className="bg-surface-900/50 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-red-400">{selectedRun.results_summary.missed}</p>
                <p className="text-xs text-surface-500">Missed</p>
              </div>
              <div className="bg-surface-900/50 rounded-lg p-3 text-center">
                <p className={clsx('text-2xl font-bold', selectedRun.results_summary.detection_rate >= 70 ? 'text-green-400' : 'text-amber-400')}>
                  {selectedRun.results_summary.detection_rate}%
                </p>
                <p className="text-xs text-surface-500">Detection Rate</p>
              </div>
            </div>
          )}

          {selectedRun.steps?.length > 0 && (
            <div className="space-y-2">
              {selectedRun.steps.map((step: any) => (
                <div key={step.id} className="flex items-center gap-4 p-3 bg-surface-900/30 rounded-lg">
                  {step.actual_result === 'detected' ? (
                    <CheckCircle className="w-4 h-4 text-green-400 shrink-0" />
                  ) : (
                    <XCircle className="w-4 h-4 text-red-400 shrink-0" />
                  )}
                  <span className="font-mono text-xs text-primary-400 w-12">{step.technique_id}</span>
                  <span className="text-sm text-surface-300 flex-1">{step.test_name}</span>
                  <span className={clsx('text-xs px-2 py-0.5 rounded',
                    step.actual_result === 'detected' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400')}>
                    {step.actual_result}
                  </span>
                  <span className="text-xs text-surface-500">{step.duration_ms}ms</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
