import { useState, useEffect } from 'react';
import apiClient from '../api/client';
import { Search } from 'lucide-react';
import clsx from 'clsx';

interface TacticCoverage {
  name: string;
  total: number;
  covered: number;
  percentage: number;
}

interface Technique {
  id: string;
  name: string;
  tactics: string[];
  description: string;
}

export function MitreMap() {
  const [coverage, setCoverage] = useState<{
    total_techniques: number;
    covered_techniques: number;
    coverage_percentage: number;
    by_tactic: Record<string, TacticCoverage>;
  } | null>(null);
  const [techniques, setTechniques] = useState<Technique[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [covRes, techRes] = await Promise.all([
          apiClient.get('/mitre/coverage'),
          apiClient.get('/mitre/techniques'),
        ]);
        setCoverage(covRes.data.data);
        setTechniques(techRes.data);
      } catch (err) {
        console.error('Failed to load MITRE data', err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const filteredTechniques = search
    ? techniques.filter(t => t.name.toLowerCase().includes(search.toLowerCase()) || t.id.toLowerCase().includes(search.toLowerCase()))
    : techniques;

  if (loading) {
    return <div className="animate-pulse space-y-4">
      <div className="h-8 bg-surface-800 rounded w-1/3" />
      <div className="grid grid-cols-4 gap-4">{[1,2,3,4].map(i => <div key={i} className="h-24 bg-surface-800 rounded" />)}</div>
    </div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">MITRE ATT&CK Coverage</h1>
        <p className="text-surface-400 text-sm mt-1">Detection coverage mapped to the MITRE ATT&CK framework</p>
      </div>

      {/* Overall Coverage */}
      {coverage && (
        <div className="bg-surface-800/50 border border-surface-700 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">Overall Coverage</h2>
            <span className="text-3xl font-bold text-primary-400">{coverage.coverage_percentage}%</span>
          </div>
          <div className="w-full h-3 bg-surface-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary-500 rounded-full transition-all"
              style={{ width: `${coverage.coverage_percentage}%` }}
            />
          </div>
          <p className="text-sm text-surface-400 mt-2">
            {coverage.covered_techniques} of {coverage.total_techniques} techniques detected
          </p>
        </div>
      )}

      {/* Tactic Heatmap */}
      {coverage && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {Object.entries(coverage.by_tactic).map(([id, tactic]) => (
            <div
              key={id}
              className={clsx(
                'border rounded-xl p-4 transition-colors',
                tactic.covered > 0
                  ? 'bg-primary-600/10 border-primary-500/30'
                  : 'bg-surface-800/50 border-surface-700',
              )}
            >
              <p className="text-xs text-surface-500 font-mono">{id}</p>
              <p className="text-sm font-medium text-white mt-1">{tactic.name}</p>
              <div className="mt-2">
                <div className="w-full h-1.5 bg-surface-700 rounded-full overflow-hidden">
                  <div className="h-full bg-primary-500 rounded-full" style={{ width: `${tactic.percentage}%` }} />
                </div>
                <p className="text-xs text-surface-400 mt-1">{tactic.covered}/{tactic.total}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Technique Browser */}
      <div className="bg-surface-800/50 border border-surface-700 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">Techniques</h2>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-500" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search techniques..."
              className="pl-9 pr-4 py-2 bg-surface-900 border border-surface-600 rounded-lg text-white text-sm placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-96 overflow-y-auto">
          {filteredTechniques.map(t => (
            <div key={t.id} className="p-3 bg-surface-900/50 rounded-lg">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-primary-400">{t.id}</span>
                <span className="text-sm text-white">{t.name}</span>
              </div>
              <p className="text-xs text-surface-500 mt-1">{t.description}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
