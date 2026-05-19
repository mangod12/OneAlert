import { useState, useEffect } from 'react';
import apiClient from '../api/client';
import { Play, FileCode, Clock } from 'lucide-react';
import clsx from 'clsx';

interface HuntSession {
  id: number;
  hypothesis: string;
  status: string;
  queries_run: number;
  findings_count: number;
  sigma_rule: string | null;
  created_at: string;
}

export function HuntLab() {
  const [hypothesis, setHypothesis] = useState('');
  const [sessions, setSessions] = useState<HuntSession[]>([]);
  const [activeResult, setActiveResult] = useState<any>(null);
  const [hunting, setHunting] = useState(false);
  const fetchSessions = async () => {
    try {
      const res = await apiClient.get('/hunt/');
      setSessions(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  const startHunt = async () => {
    if (!hypothesis.trim()) return;
    setHunting(true);
    setActiveResult(null);
    try {
      const res = await apiClient.post('/hunt/', { hypothesis });
      setActiveResult(res.data.data);
      await fetchSessions();
    } catch (err) {
      console.error(err);
    } finally {
      setHunting(false);
    }
  };

  useEffect(() => { fetchSessions(); }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Threat Hunt Lab</h1>
        <p className="text-surface-400 text-sm mt-1">Natural-language threat hunting with AI-generated queries</p>
      </div>

      {/* Hunt Input */}
      <div className="bg-surface-800/50 border border-surface-700 rounded-xl p-6">
        <label className="block text-sm font-medium text-surface-300 mb-2">Hunting Hypothesis</label>
        <div className="flex gap-3">
          <input
            type="text"
            value={hypothesis}
            onChange={e => setHypothesis(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && startHunt()}
            placeholder="e.g. Look for lateral movement from engineering workstation to PLC subnet"
            className="flex-1 px-4 py-3 bg-surface-900 border border-surface-600 rounded-lg text-white placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <button
            onClick={startHunt}
            disabled={hunting || !hypothesis.trim()}
            className="flex items-center gap-2 px-6 py-3 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
          >
            <Play className="w-4 h-4" />
            {hunting ? 'Hunting...' : 'Hunt'}
          </button>
        </div>
        <div className="flex gap-2 mt-3">
          {['Port scan from 10.0.0.0/24', 'DNS tunneling to external domains', 'Modbus write commands to PLCs',
            'Failed auth attempts across multiple hosts'].map(example => (
            <button
              key={example}
              onClick={() => setHypothesis(example)}
              className="px-3 py-1 text-xs bg-surface-700 text-surface-400 rounded-full hover:bg-surface-600 hover:text-surface-300 transition-colors"
            >
              {example}
            </button>
          ))}
        </div>
      </div>

      {/* Active Result */}
      {activeResult && (
        <div className="space-y-4">
          <div className="bg-surface-800/50 border border-surface-700 rounded-xl p-6">
            <h2 className="text-lg font-semibold text-white mb-3">Hunt Results</h2>
            {activeResult.explanation && (
              <p className="text-surface-300 text-sm mb-4">{activeResult.explanation}</p>
            )}

            {activeResult.query_results?.map((qr: any, i: number) => (
              <div key={i} className="mb-4 last:mb-0">
                <div className="flex items-center gap-2 mb-2">
                  <FileCode className="w-4 h-4 text-primary-400" />
                  <span className="text-sm font-medium text-white">{qr.query?.description}</span>
                  <span className="text-xs text-surface-500">{qr.row_count} results</span>
                </div>
                <pre className="bg-surface-900 p-3 rounded-lg text-xs text-surface-400 overflow-x-auto mb-2">
                  {qr.query?.sql}
                </pre>
                {qr.rows?.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-surface-700">
                          {Object.keys(qr.rows[0]).map(key => (
                            <th key={key} className="text-left p-2 text-surface-500">{key}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {qr.rows.slice(0, 20).map((row: any, j: number) => (
                          <tr key={j} className="border-b border-surface-800">
                            {Object.values(row).map((val: any, k: number) => (
                              <td key={k} className="p-2 text-surface-300 truncate max-w-xs">{String(val ?? '—')}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {qr.error && <p className="text-red-400 text-xs mt-1">{qr.error}</p>}
              </div>
            ))}
          </div>

          {activeResult.sigma_rule && (
            <div className="bg-surface-800/50 border border-surface-700 rounded-xl p-6">
              <h3 className="text-sm font-semibold text-white mb-2 flex items-center gap-2">
                <FileCode className="w-4 h-4 text-primary-400" />
                Generated Sigma Rule
              </h3>
              <pre className="bg-surface-900 p-4 rounded-lg text-xs text-green-400 overflow-x-auto whitespace-pre-wrap">
                {activeResult.sigma_rule}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Past Sessions */}
      <div className="bg-surface-800/50 border border-surface-700 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Hunt History</h2>
        {sessions.length === 0 ? (
          <p className="text-surface-500 text-sm">No hunt sessions yet. Enter a hypothesis above to start.</p>
        ) : (
          <div className="space-y-2">
            {sessions.map(s => (
              <div key={s.id} className="flex items-center gap-4 p-3 bg-surface-900/50 rounded-lg">
                <Clock className="w-4 h-4 text-surface-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">{s.hypothesis}</p>
                  <p className="text-xs text-surface-500">
                    {s.queries_run} queries · {s.findings_count} findings · {new Date(s.created_at).toLocaleDateString()}
                  </p>
                </div>
                <span className={clsx('text-xs px-2 py-0.5 rounded',
                  s.status === 'completed' ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400')}>
                  {s.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
