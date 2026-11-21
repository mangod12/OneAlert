import { MitreCoverageBasis } from '../components/MitreCoverageBasis';
import { MitreReferenceExplorer } from '../components/MitreReferenceExplorer';
import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../api/client';
import { mitreCsv } from '../utils/mitreCsv';
import { Search, Download } from 'lucide-react';
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

interface TechniqueReferences {
  technique_id: string;
  technique_name: string;
  cases: Array<{ id: number; title: string; status: string }>;
  detection_rules: Array<{ id: number; name: string; enabled: boolean }>;
}

export function MitreMap() {
  const refsRequest = useRef(0);
  const [basisTechnique, setBasisTechnique] = useState('');
  const basisReferences = useRef<HTMLDivElement>(null);
  useEffect(() => { if (basisTechnique) basisReferences.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' }); }, [basisTechnique]);
  useEffect(() => () => { refsRequest.current += 1; }, []);
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [references, setReferences] = useState<TechniqueReferences | null>(null);
  const [refsLoading, setRefsLoading] = useState(false);
  const [refsError, setRefsError] = useState('');

  const toggleTechnique = (id: string) => {
    if (selectedId === id) {
      refsRequest.current += 1;
      setSelectedId(null); setReferences(null); setRefsError('');
      return;
    }
    void loadReferences(id);
  };

  const loadReferences = async (id: string) => {
    const request = ++refsRequest.current;
    setSelectedId(id);
    setReferences(null);
    setRefsError('');
    setRefsLoading(true);
    try {
      const res = await apiClient.get<TechniqueReferences>(`/mitre/techniques/${id}/references`);
      if (request === refsRequest.current) setReferences(res.data);
    } catch (err: unknown) {
      if (request !== refsRequest.current) return;
      setRefsError(getApiErrorMessage(err, 'Technique references could not be loaded.'));
    } finally {
      if (request === refsRequest.current) setRefsLoading(false);
    }
  };

  const fetchData = async () => {
    setLoading(true);
    setErrors([]);
    const [coverageResult, techniquesResult] = await Promise.allSettled([
      apiClient.get('/mitre/coverage'),
      apiClient.get('/mitre/techniques'),
    ]);
    const nextErrors: string[] = [];
    if (coverageResult.status === 'fulfilled') setCoverage(coverageResult.value.data.data);
    else { setCoverage(null); setGapsOnly(false); nextErrors.push(getApiErrorMessage(coverageResult.reason, 'Coverage data is unavailable')); }
    if (techniquesResult.status === 'fulfilled') setTechniques(techniquesResult.value.data);
    else { setTechniques([]); nextErrors.push(getApiErrorMessage(techniquesResult.reason, 'Technique catalog is unavailable')); }
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

  const exportFiltered = () => {
    if (!filteredTechniques.length || loading) return;
    const url = URL.createObjectURL(new Blob([mitreCsv(filteredTechniques, coverage?.covered_ids, search, gapsOnly)], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'mitre-filtered-techniques.csv'; link.click(); URL.revokeObjectURL(url);
  };

  if (loading) {
    return <LoadingSurface rows={6} label="Loading MITRE ATT&CK coverage" />;
  }

  if (!coverage && techniques.length === 0 && errors.length > 0) return <ErrorState title="ATT&CK coverage unavailable" description={errors.join(' · ')} action={<RetryButton onClick={() => void fetchData()} />} />;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Analyze" title="MITRE ATT&CK Coverage" description="Recorded associations across the embedded Enterprise and ICS technique catalog subset, not tested detection efficacy." actions={<button type="button" disabled={filteredTechniques.length === 0} onClick={exportFiltered} className="flex items-center gap-2 rounded border border-surface-600 px-3 py-2 text-xs text-surface-200 disabled:opacity-40"><Download className="h-4 w-4" aria-hidden="true" />Export filtered techniques</button>} />
      <p className="text-xs text-surface-400">{filteredTechniques.length} of {techniques.length} loaded techniques shown. CSV matches these filters and available coverage. Missing coverage is unknown, not a gap. Download stays on your device.</p>
      {errors.length > 0 && <DegradedBanner messages={errors} onRetry={() => void fetchData()} />}

      <MitreCoverageBasis onSelectTechnique={setBasisTechnique} />
      <div ref={basisReferences}><MitreReferenceExplorer key={basisTechnique} initialTechnique={basisTechnique} /></div>

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
            {coverage.covered_techniques} of {coverage.total_techniques} techniques with case or enabled-rule mappings
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
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-surface-50">Techniques</h2>
          <div className="flex min-w-0 flex-wrap items-center gap-3">
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
          {filteredTechniques.map(t => {
            const covered = coverage?.covered_ids ? coveredIds.has(t.id) : false;
            const expanded = selectedId === t.id;
            return (
              <div key={t.id} className="p-3 bg-surface-900/50 rounded-lg">
                {covered ? (
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-label={`Show what detects ${t.id} ${t.name}`}
                    onClick={() => void toggleTechnique(t.id)}
                    className="flex w-full items-center gap-2 text-left rounded-sm hover:bg-surface-800/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                  >
                    <span className="text-xs font-mono text-primary-400">{t.id}</span>
                    <span className="text-sm text-surface-50">{t.name}</span>
                    <StatusBadge tone="success">Detected</StatusBadge>
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-primary-400">{t.id}</span>
                    <span className="text-sm text-surface-50">{t.name}</span>
                    {coverage?.covered_ids && <StatusBadge tone="neutral">Gap</StatusBadge>}
                  </div>
                )}
                <p className="text-xs text-surface-500 mt-1">{t.description}</p>
                {expanded && refsLoading && (
                  <p className="mt-3 text-xs text-surface-500">Loading references…</p>
                )}
                {expanded && refsError && (
                  <div className="mt-3 space-y-2"><p role="alert" className="text-xs text-danger">{refsError}</p><button type="button" onClick={() => void loadReferences(t.id)} className="rounded border border-surface-600 px-2.5 py-1.5 text-xs text-primary-300 hover:border-primary-500">Retry technique references</button></div>
                )}
                {expanded && references && (
                  <div className="mt-3 space-y-3 border-t border-surface-700 pt-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-surface-400">Cases, latest 20</p>
                      {references.cases.length === 0 ? (
                        <p className="mt-1 text-xs text-surface-500">No cases reference this technique.</p>
                      ) : (
                        <ul className="mt-1 space-y-1">
                          {references.cases.map(c => (
                            <li key={c.id}>
                              <Link to={`/cases/${c.id}`} className="text-xs text-primary-300 hover:text-primary-200 hover:underline">
                                #{c.id} {c.title}
                              </Link>
                              <span className="ml-2 text-xs text-surface-500">{c.status}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-surface-400">Detection rules, latest 20</p>
                      {references.detection_rules.length === 0 ? (
                        <p className="mt-1 text-xs text-surface-500">No detection rules cover this technique.</p>
                      ) : (
                        <ul className="mt-1 space-y-1">
                          {references.detection_rules.map(r => (
                            <li key={r.id} className="text-xs text-surface-200">
                              <Link to="/hunt" className="text-primary-300 hover:text-primary-200 hover:underline">{r.name}</Link>
                              {!r.enabled && <span className="ml-2 text-surface-500">disabled</span>}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
