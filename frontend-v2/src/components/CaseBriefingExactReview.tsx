import { CaseBriefingCurrentSources } from './CaseBriefingCurrentSources';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { BriefingDraftView } from './CaseBriefingDrafts';
import { briefingEvidencePayload, verifySavedBriefing, type SavedBriefing } from '../utils/caseBriefingEvidence';

export function CaseBriefingExactReview({ caseId, canOpen }: { caseId: number; canOpen: boolean | null }) {
  const [params] = useSearchParams(); const location = useLocation(), navigate = useNavigate();
  const values = params.getAll('briefing'), raw = values.length === 1 ? values[0] : '';
  const id = /^[1-9][0-9]*$/.test(raw) && Number.isSafeInteger(Number(raw)) ? Number(raw) : null;
  const [row, setRow] = useState<SavedBriefing | null>(null), [retrievedAt, setRetrievedAt] = useState('');
  const [error, setError] = useState(''), [loading, setLoading] = useState(false), [retry, setRetry] = useState(0);
  const [copied, setCopied] = useState(false), [actionError, setActionError] = useState(''), [downloaded, setDownloaded] = useState(false);
  const copyRevision = useRef(0), panel = useRef<HTMLElement>(null);
  useEffect(() => {
    let active = true; copyRevision.current++; const invalidate = () => { copyRevision.current++; };
    setRow(null); setRetrievedAt(''); setError(''); setCopied(false); setDownloaded(false); setActionError(''); setLoading(false);
    if (id !== null && canOpen === true) {
      setLoading(true);
      void apiClient.get(`/cases/${caseId}/briefing-drafts/${id}`).then(({ data }) => {
        if (!active) return;
        if (data?.case_id !== caseId || data.record?.timeline_id !== id || !verifySavedBriefing(data.record, caseId)
          || typeof data.retrieved_at !== 'string' || !Number.isFinite(Date.parse(data.retrieved_at))) throw new Error('The saved briefing did not match this exact case and draft.');
        setRow(data.record); setRetrievedAt(data.retrieved_at);
      }).catch(err => { if (active) setError(getApiErrorMessage(err, 'This saved briefing could not be loaded. No draft was generated.')); })
        .finally(() => { if (active) setLoading(false); });
    }
    return () => { active = false; invalidate(); };
  }, [caseId, id, canOpen, retry]);
  useEffect(() => { if (row) panel.current?.scrollIntoView?.({ block: 'start' }); }, [row]);
  const currentRow = row?.briefing.case_id === caseId && row.timeline_id === id ? row : null;
  const close = () => { const next = new URLSearchParams(params); next.delete('briefing'); navigate({ pathname: location.pathname, search: next.toString(), hash: location.hash }, { replace: true }); };
  const copy = async () => {
    if (!currentRow || !id) return;
    const version = ++copyRevision.current; setCopied(false); setActionError('');
    try {
      const url = new URL(`/app/cases/${caseId}`, window.location.origin); url.searchParams.set('briefing', String(id));
      await navigator.clipboard.writeText(url.toString()); if (version === copyRevision.current) setCopied(true);
    } catch { if (version === copyRevision.current) setActionError('The exact briefing link could not be copied.'); }
  };
  const download = () => {
    if (!currentRow || !id) return;
    setDownloaded(false); setActionError(''); let url: string | undefined;
    try {
      const payload = briefingEvidencePayload(currentRow, retrievedAt, new Date().toISOString());
      url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' }));
      const link = document.createElement('a'); link.href = url; link.download = `case-${caseId}-briefing-${id}-evidence.json`;
      document.body.appendChild(link); link.click(); link.remove(); setDownloaded(true);
    } catch { setActionError('The briefing evidence download could not be prepared.'); }
    finally { if (url) URL.revokeObjectURL(url); }
  };
  if (!values.length) return null;
  return <section ref={panel} aria-label="Exact saved briefing review" className="oa-panel scroll-mt-24 space-y-3 p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold text-surface-100">Exact saved briefing review{id ? ` #${id}` : ''}</h2><button type="button" onClick={close} className="rounded border border-surface-600 p-2 text-xs text-primary-300">Close exact briefing</button></div>
    <p className="text-xs text-surface-400">Reads one saved draft, including older drafts outside the latest history page. This link does not regenerate a report, refresh its original inputs, run an agent or grant access. Case timeline permissions still apply independently.</p>
    {id === null ? <p role="alert" className="text-xs text-danger">Invalid briefing link. Use exactly one positive whole-number briefing ID. No draft was loaded from this link.</p> : canOpen === null ? <p role="status" className="text-xs text-surface-400">Checking briefing access...</p> : !canOpen ? <p role="alert" className="text-xs text-danger">Exact briefing review is available to the investigation owner. No private draft was loaded.</p> : loading ? <p role="status" className="text-xs text-surface-400">Loading exact saved briefing...</p> : error ? <div className="space-y-2"><p role="alert" className="break-words text-xs text-danger">{error}</p><button type="button" onClick={() => setRetry(n => n + 1)} className="rounded border border-surface-600 p-2 text-xs text-primary-300">Retry exact briefing read</button></div> : currentRow && <>
      <p className="text-xs text-surface-400">Saved draft read at {retrievedAt}. Downloading keeps this displayed read, not a newer source snapshot. The JSON includes draft text and shortened source excerpts that may name people or systems. Keep it private; downloaded copies have no application access controls. Nothing is sent to another person.</p>
      <div className="flex flex-wrap gap-2"><button type="button" onClick={() => void copy()} className="rounded border border-surface-600 p-2 text-xs text-primary-300">Copy exact briefing link</button><button type="button" onClick={download} className="rounded border border-surface-600 p-2 text-xs text-primary-300">Download displayed briefing evidence (JSON)</button></div>
      {copied && <p role="status" className="text-xs text-primary-300">Exact briefing link copied. It does not grant access.</p>}{downloaded && <p role="status" className="text-xs text-primary-300">Briefing evidence download prepared. This does not confirm where your browser saved it.</p>}{actionError && <p role="alert" className="text-xs text-danger">{actionError}</p>}
      <BriefingDraftView row={currentRow} offerOpen={false} />
      <CaseBriefingCurrentSources key={`${caseId}:${currentRow.timeline_id}`} row={currentRow} />
    </>}
  </section>;
}
