import { useState, useEffect } from 'react';
import apiClient from '../api/client';
import { Search } from 'lucide-react';
import clsx from 'clsx';
import { getApiErrorMessage } from '../api/errors';
import { DegradedBanner, ErrorState, LoadingSurface, RetryButton } from '../components/ui/AsyncState';
import { PageHeader } from '../components/ui/PageHeader';
import { StatusBadge } from '../components/ui/StatusBadge';

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
    covered_ids?: string[];
  } | null>(null);
  const [techniques, setTechniques] = useState<Technique[]>([]);
  const [search, setSearch] = useState('');
  const [gapsOnly, setGapsOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);

  const fetchData = async () => {
    setLoading(true);
    setErrors([]);
    const [coverageResult, techniquesResult] = await Promise.allSettled([
      apiClient.get('/mitre/coverage'),
      apiClient.get('/mitre/techniques'),
    ]);
    const nextErrors: string[] = [];
    if (coverageResult.status === 'fulfilled') setCoverage(coverageResult.value.data.data);
    else nextErrors.push(getApiErrorMessage(coverageResult.reason, 'Coverage data is unavailable'));
    if (techniquesResult.status === 'fulfilled') setTechniques(techniquesResult.value.data);
    else nextErrors.push(getApiErrorMessage(techniquesResult.reason, 'Technique catalog is unavailable'));
    setErrors(nextErrors);
    setLoading(false);
  };

  useEffect(() => {
    void fetchData();
  }, []);

  const coveredIds = new Set(coverage?.covered_ids ?? []);
  const filteredTechniques = techniques.filter(t => {
    if (gapsOnly && coveredIds.has(t.id)) return false;
    if (!search) return true;
    return t.name.toLowerCase().includes(search.toLowerCase()) || t.id.toLowerCase().includes(search.toLowerCase());
  });

  if (loading) {
    return <LoadingSurface rows={6} label="Loading MITRE ATT&CK coverage" />;
  }

  if (!coverage && techniques.length === 0 && errors.length > 0) return <ErrorState title="ATT&CK coverage unavailable" description={errors.join(' · ')} action={<RetryButton onClick={() => void fetchData()} />} />;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Analyze" title="MITRE ATT&CK Coverage" description="Detection coverage mapped to enterprise and industrial ATT&CK techniques." />
      {errors.length > 0 && <DegradedBanner messages={errors} onRetry={() => void fetchData()} />}

      {/* Overall Coverage */}
      {coverage && (
        <div className="oa-panel p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-surface-50">Overall Coverage</h2>
            <span className="text-3xl font-bold text-primary-400">{coverage.coverage_percentage}%</span>
          </div>
          <div
            className="w-full h-3 bg-surface-700 rounded-full overflow-hidden"
            role="progressbar"
            aria-label="Overall ATT&CK coverage"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={coverage.coverage_percentage}
          >
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
                'border rounded-md p-4 transition-colors',
                tactic.covered > 0
                  ? 'bg-primary-600/10 border-primary-500/30'
                  : 'bg-surface-800/50 border-surface-700',
              )}
            >
              <p className="text-xs text-surface-500 font-mono">{id}</p>
              <p className="text-sm font-medium text-surface-50 mt-1">{tactic.name}</p>
              <div className="mt-2">
                <div
                  className="w-full h-1.5 bg-surface-700 rounded-full overflow-hidden"
                  role="progressbar"
                  aria-label={`${tactic.name} coverage`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={tactic.percentage}
                >
                  <div className="h-full bg-primary-500 rounded-full" style={{ width: `${tactic.percentage}%` }} />
                </div>
                <p className="text-xs text-surface-400 mt-1">{tactic.covered}/{tactic.total}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Technique Browser */}
      <div className="oa-panel p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-surface-50">Techniques</h2>
          <div className="flex items-center gap-3">
            {coverage?.covered_ids && (
              <label className="flex items-center gap-2 text-xs text-surface-300">
                <input
                  type="checkbox"
                  checked={gapsOnly}
                  onChange={e => setGapsOnly(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-surface-600 bg-surface-800 text-primary-500 focus:ring-primary-500"
                />
                Gaps only
              </label>
            )}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-500" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search techniques..."
                aria-label="Search techniques"
                className="pl-9 pr-4 py-2 bg-surface-900 border border-surface-600 rounded-lg text-surface-50 text-sm placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-96 overflow-y-auto">
          {filteredTechniques.map(t => (
            <div key={t.id} className="p-3 bg-surface-900/50 rounded-lg">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-primary-400">{t.id}</span>
                <span className="text-sm text-surface-50">{t.name}</span>
                {coverage?.covered_ids && (
                  coveredIds.has(t.id)
                    ? <StatusBadge tone="success">Detected</StatusBadge>
                    : <StatusBadge tone="neutral">Gap</StatusBadge>
                )}
              </div>
              <p className="text-xs text-surface-500 mt-1">{t.description}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
