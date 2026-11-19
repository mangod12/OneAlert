import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import apiClient from '../api/client';
import type { Alert, AlertListResponse } from '../api/types';
import { AlertDetail } from '../components/AlertDetail';
import { SavedViewsMenu, type SavedViewFilters } from '../components/SavedViewsMenu';
import { Search, Filter, CheckCircle, ChevronRight, Download } from 'lucide-react';
import { getApiErrorMessage } from '../api/errors';
import { PageHeader } from '../components/ui/PageHeader';
import { StatusBadge } from '../components/ui/StatusBadge';
import { alertSeverityTones, alertStatusTones } from '../components/ui/tones';
import { ErrorState, LoadingSurface, RetryButton } from '../components/ui/AsyncState';
import { toast } from '../components/Toast';

export function Alerts() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [searchParams, setSearchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null);
  const [severityFilter, setSeverityFilter] = useState<string>(() => {
    const value = searchParams.get('severity') ?? '';
    return ['critical', 'high', 'medium', 'low'].includes(value) ? value : '';
  });
  const [statusFilter, setStatusFilter] = useState<string>(() => {
    const value = searchParams.get('status') ?? '';
    return ['pending', 'acknowledged', 'resolved'].includes(value) ? value : '';
  });
  const [ageFilter, setAgeFilter] = useState<string>('');
  const [cveSearch, setCveSearch] = useState('');
  const [assetFilter, setAssetFilter] = useState<string>(() => {
    const value = searchParams.get('asset_id') ?? '';
    return /^\d+$/.test(value) ? value : '';
  });
  const [assignedFilter, setAssignedFilter] = useState('');
  const [assetOptions, setAssetOptions] = useState<{ id: number; name: string }[]>([]);
  const [sort, setSort] = useState('created_at_desc');
  const [showSnoozedOnly, setShowSnoozedOnly] = useState(false);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [todayStr, setTodayStr] = useState<string | null>(null);
  useEffect(() => {
    setTodayStr(new Date().toISOString().slice(0, 10));
  }, []);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [pendingIds, setPendingIds] = useState<Set<number>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [epssScores, setEpssScores] = useState<Record<string, { score: number; percentile: number }>>({});
  const [kevEntries, setKevEntries] = useState<Record<string, { date_added: string | null; due_date: string | null; known_ransomware_campaign_use: string | null }>>({});
  const [members, setMembers] = useState<Array<{ id: number; email: string; is_active: boolean }>>([]);
  const [bulkAssigning, setBulkAssigning] = useState(false);
  const [bulkDueApplying, setBulkDueApplying] = useState(false);

  // Deep link: /alerts?alert=<id> opens the detail drawer for that alert.
  useEffect(() => {
    const alertParam = searchParams.get('alert');
    if (!alertParam) return;
    const alertId = Number(alertParam);
    setSearchParams(prev => { const next = new URLSearchParams(prev); next.delete('alert'); return next; }, { replace: true });
    if (!Number.isInteger(alertId) || alertId <= 0) return;
    if (selectedAlert?.id === alertId) return;
    void (async () => {
      try {
        const res = await apiClient.get<Alert>(`/alerts/${alertId}`);
        setSelectedAlert(res.data);
      } catch (err: unknown) {
        toast(getApiErrorMessage(err, 'The linked alert could not be opened.'), 'error');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const exportCsv = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const params: Record<string, string | number> = {};
      if (severityFilter) params.severity = severityFilter;
      if (statusFilter) params.status = statusFilter;
      if (cveSearch) params.search = cveSearch;
      if (assetFilter) params.asset_id = Number(assetFilter);
      if (assignedFilter === 'watching') params.watching = 'me';
      else if (assignedFilter) params.assigned = assignedFilter;
      if (showSnoozedOnly) params.snoozed = 'only';
      if (ageFilter === 'lt1') params.max_age_days = 1;
      else if (ageFilter === '1to7') { params.min_age_days = 1; params.max_age_days = 7; }
      else if (ageFilter === 'gt7') params.min_age_days = 7;
      if (overdueOnly) params.overdue = 'true';
      const res = await apiClient.get('/alerts/export', { params, responseType: 'blob' });
      const url = URL.createObjectURL(res.data as Blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'alerts.csv';
      link.click();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      toast(getApiErrorMessage(err, 'The export could not be downloaded.'), 'error');
    } finally {
      setExporting(false);
    }
  };

  const fetchAlerts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string | number> = { page, size: 15 };
      if (severityFilter) params.severity = severityFilter;
      if (statusFilter) params.status = statusFilter;
      if (cveSearch) params.search = cveSearch;
      if (assetFilter) params.asset_id = Number(assetFilter);
      if (assignedFilter === 'watching') params.watching = 'me';
      else if (assignedFilter) params.assigned = assignedFilter;
      if (showSnoozedOnly) params.snoozed = 'only';
      if (ageFilter === 'lt1') params.max_age_days = 1;
      else if (ageFilter === '1to7') { params.min_age_days = 1; params.max_age_days = 7; }
      else if (ageFilter === 'gt7') params.min_age_days = 7;
      if (overdueOnly) params.overdue = 'true';
      params.sort = sort;

      const res = await apiClient.get<AlertListResponse>('/alerts/', { params });
      setAlerts(res.data.alerts);
      setTotal(res.data.total);
      setPages(res.data.pages);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Alerts could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, [page, severityFilter, statusFilter, cveSearch, assetFilter, assignedFilter, showSnoozedOnly, overdueOnly, ageFilter, sort]);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  // Fetch EPSS exploit probabilities for the visible CVEs in one batch call.
  // Decorative triage signal: failures are ignored so the list still renders.
  useEffect(() => {
    const cveIds = Array.from(new Set(alerts.map(a => a.cve_id).filter(Boolean)));
    if (cveIds.length === 0) {
      setEpssScores({});
      setKevEntries({});
      return;
    }
    let cancelled = false;
    apiClient.get('/alerts/epss-batch', { params: { cve_ids: cveIds.join(',') } })
      .then(res => { if (!cancelled) setEpssScores(res.data.scores ?? {}); })
      .catch(() => { if (!cancelled) setEpssScores({}); });
    apiClient.get('/alerts/kev-batch', { params: { cve_ids: cveIds.join(',') } })
      .then(res => { if (!cancelled) setKevEntries(res.data.entries ?? {}); })
      .catch(() => { if (!cancelled) setKevEntries({}); });
    return () => { cancelled = true; };
  }, [alerts]);

  useEffect(() => {
    apiClient.get('/assets/', { params: { size: 100 } })
      .then(res => setAssetOptions((res.data.assets ?? []).map((a: { id: number; name: string }) => ({ id: a.id, name: a.name }))))
      .catch(() => {});
  }, []);

  useEffect(() => {
    apiClient.get<Array<{ id: number; email: string; is_active: boolean }>>('/orgs/me/members')
      .then(res => setMembers((res.data ?? []).filter(m => m.is_active)))
      .catch(() => setMembers([]));
  }, []);

  const handleAcknowledge = async (alertId: number) => {
    if (pendingIds.has(alertId)) return;
    setPendingIds(current => new Set(current).add(alertId));
    try {
      await apiClient.post(`/alerts/${alertId}/acknowledge`);
      await fetchAlerts();
      setSelectedAlert(null);
    } catch (err: unknown) {
      toast(getApiErrorMessage(err, 'Alert could not be acknowledged.'), 'error');
    } finally {
      setPendingIds(current => { const next = new Set(current); next.delete(alertId); return next; });
    }
  };

  const handleAssigned = (alertId: number, assigneeId: number | null, assigneeEmail: string | null) => {
    setAlerts(current => current.map(a => a.id === alertId ? { ...a, assigned_to_id: assigneeId, assigned_to_email: assigneeEmail } : a));
    setSelectedAlert(current => current && current.id === alertId ? { ...current, assigned_to_id: assigneeId, assigned_to_email: assigneeEmail } : current);
    toast(assigneeEmail ? `Alert assigned to ${assigneeEmail}.` : 'Alert unassigned.', 'success');
  };

  const handleDueDateChange = (alertId: number, dueDate: string | null) => {
    setAlerts(current => current.map(a => a.id === alertId ? { ...a, due_date: dueDate } : a));
    setSelectedAlert(current => current && current.id === alertId ? { ...current, due_date: dueDate } : current);
    toast(dueDate ? `Triage due date set to ${dueDate}.` : 'Triage due date cleared.', 'success');
  };

  const isAlertOverdue = (a: Alert) =>
    !!a.due_date && todayStr !== null && a.due_date < todayStr && a.status !== 'resolved';

  const handleBulkAcknowledge = async () => {
    const ids = Array.from(selectedIds).filter(id => !pendingIds.has(id));
    if (ids.length === 0) return;
    setPendingIds(current => new Set([...current, ...ids]));
    const results = await Promise.allSettled(ids.map(id => apiClient.post(`/alerts/${id}/acknowledge`)));
    const failedIds = ids.filter((_, index) => results[index].status === 'rejected');
    setSelectedIds(new Set(failedIds));
    setPendingIds(current => { const next = new Set(current); ids.forEach(id => next.delete(id)); return next; });
    await fetchAlerts();
    if (failedIds.length > 0) toast(`${failedIds.length} alerts could not be acknowledged and remain selected.`, 'error');
    else toast(`${ids.length} alerts acknowledged.`, 'success');
  };

  const handleSnooze = async (alertId: number, hours: number | null) => {
    if (pendingIds.has(alertId)) return;
    setPendingIds(current => new Set(current).add(alertId));
    try {
      if (hours === null) {
        await apiClient.delete(`/alerts/${alertId}/snooze`);
        toast('Snooze cleared.', 'success');
      } else {
        await apiClient.post(`/alerts/${alertId}/snooze`, { hours });
        toast(`Alert snoozed for ${hours >= 24 ? `${hours / 24} day${hours > 24 ? 's' : ''}` : `${hours} hour${hours > 1 ? 's' : ''}`}.`, 'success');
      }
      await fetchAlerts();
      setSelectedAlert(null);
    } catch (err: unknown) {
      toast(getApiErrorMessage(err, 'Alert could not be snoozed.'), 'error');
    } finally {
      setPendingIds(current => { const next = new Set(current); next.delete(alertId); return next; });
    }
  };

  const handleResolve = async (alertId: number) => {
    if (pendingIds.has(alertId)) return;
    setPendingIds(current => new Set(current).add(alertId));
    try {
      await apiClient.post(`/alerts/${alertId}/resolve`);
      await fetchAlerts();
      setSelectedAlert(null);
    } catch (err: unknown) {
      toast(getApiErrorMessage(err, 'Alert could not be resolved.'), 'error');
    } finally {
      setPendingIds(current => { const next = new Set(current); next.delete(alertId); return next; });
    }
  };

  const handleReopen = async (alertId: number) => {
    if (pendingIds.has(alertId)) return;
    setPendingIds(current => new Set(current).add(alertId));
    try {
      await apiClient.post(`/alerts/${alertId}/reopen`);
      await fetchAlerts();
      setSelectedAlert(null);
    } catch (err: unknown) {
      toast(getApiErrorMessage(err, 'Alert could not be reopened.'), 'error');
    } finally {
      setPendingIds(current => { const next = new Set(current); next.delete(alertId); return next; });
    }
  };

  const handleBulkResolve = async () => {
    const ids = Array.from(selectedIds).filter(id => !pendingIds.has(id));
    if (ids.length === 0) return;
    setPendingIds(current => new Set([...current, ...ids]));
    const results = await Promise.allSettled(ids.map(id => apiClient.post(`/alerts/${id}/resolve`)));
    const failedIds = ids.filter((_, index) => results[index].status === 'rejected');
    setSelectedIds(new Set(failedIds));
    setPendingIds(current => { const next = new Set(current); ids.forEach(id => next.delete(id)); return next; });
    await fetchAlerts();
    if (failedIds.length > 0) toast(`${failedIds.length} alerts could not be resolved and remain selected.`, 'error');
    else toast(`${ids.length} alerts resolved.`, 'success');
  };

  const handleBulkWatch = async (watch: boolean) => {
    const ids = Array.from(selectedIds).filter(id => !pendingIds.has(id));
    if (ids.length === 0) return;
    setPendingIds(current => new Set([...current, ...ids]));
    const results = await Promise.allSettled(ids.map(id =>
      watch ? apiClient.post(`/alerts/${id}/watch`) : apiClient.delete(`/alerts/${id}/watch`)
    ));
    const failedIds = ids.filter((_, index) => results[index].status === 'rejected');
    setSelectedIds(new Set(failedIds));
    setPendingIds(current => { const next = new Set(current); ids.forEach(id => next.delete(id)); return next; });
    await fetchAlerts();
    const verb = watch ? 'watched' : 'unwatched';
    if (failedIds.length > 0) toast(`${failedIds.length} alerts could not be ${verb} and remain selected.`, 'error');
    else toast(`${ids.length} alerts ${verb}.`, 'success');
  };

  const handleBulkDueDate = async (value: string) => {
    if (value === '') return;
    if (bulkDueApplying) return;
    const ids = Array.from(selectedIds).filter(id => !pendingIds.has(id));
    if (ids.length === 0) return;
    const dueDate = value === 'clear'
      ? null
      : new Date(Date.now() + Number(value) * 86400000).toISOString().slice(0, 10);
    setBulkDueApplying(true);
    setPendingIds(current => new Set([...current, ...ids]));
    const results = await Promise.allSettled(ids.map(id =>
      apiClient.patch(`/alerts/${id}`, { due_date: dueDate })
    ));
    const failedIds = ids.filter((_, index) => results[index].status === 'rejected');
    setSelectedIds(new Set(failedIds));
    setPendingIds(current => { const next = new Set(current); ids.forEach(id => next.delete(id)); return next; });
    await fetchAlerts();
    setBulkDueApplying(false);
    const verb = dueDate === null ? 'cleared' : `set to ${dueDate}`;
    if (failedIds.length > 0) toast(`${failedIds.length} alerts could not be updated and remain selected.`, 'error');
    else toast(`Triage due date ${verb} for ${ids.length} alerts.`, 'success');
  };

  const handleBulkSnooze = async (value: string) => {
    if (value === '') return;
    const hours = Number(value);
    const ids = Array.from(selectedIds).filter(id => !pendingIds.has(id));
    if (ids.length === 0) return;
    setPendingIds(current => new Set([...current, ...ids]));
    const results = await Promise.allSettled(ids.map(id => apiClient.post(`/alerts/${id}/snooze`, { hours })));
    const failedIds = ids.filter((_, index) => results[index].status === 'rejected');
    setSelectedIds(new Set(failedIds));
    setPendingIds(current => { const next = new Set(current); ids.forEach(id => next.delete(id)); return next; });
    await fetchAlerts();
    const label = hours >= 24 ? `${hours / 24} day${hours > 24 ? 's' : ''}` : `${hours} hour${hours > 1 ? 's' : ''}`;
    if (failedIds.length > 0) toast(`${failedIds.length} alerts could not be snoozed and remain selected.`, 'error');
    else toast(`${ids.length} alerts snoozed for ${label}.`, 'success');
  };

  const handleBulkAssign = async (value: string) => {
    if (value === '' || bulkAssigning) return;
    if (value === 'auto') {
      const ids = Array.from(selectedIds).filter(id => !pendingIds.has(id));
      if (ids.length === 0) return;
      setBulkAssigning(true);
      setPendingIds(current => new Set([...current, ...ids]));
      try {
        const { data } = await apiClient.post('/alerts/auto-assign', { alert_ids: ids });
        const assignedCount = Object.keys(data.assigned ?? {}).length;
        setSelectedIds(new Set());
        await fetchAlerts();
        const noun = assignedCount === 1 ? 'alert' : 'alerts';
        toast(assignedCount === ids.length
          ? `${assignedCount} ${noun} auto-assigned across your organization.`
          : `${assignedCount} of ${ids.length} alerts auto-assigned (resolved alerts were skipped).`, 'success');
      } catch (err) {
        toast(getApiErrorMessage(err, 'Alerts could not be auto-assigned.'), 'error');
      } finally {
        setPendingIds(current => { const next = new Set(current); ids.forEach(id => next.delete(id)); return next; });
        setBulkAssigning(false);
      }
      return;
    }
    const assigneeId = value === 'none' ? null : Number(value);
    const member = members.find(m => m.id === assigneeId) ?? null;
    const ids = Array.from(selectedIds).filter(id => !pendingIds.has(id));
    if (ids.length === 0) return;
    setBulkAssigning(true);
    setPendingIds(current => new Set([...current, ...ids]));
    const results = await Promise.allSettled(ids.map(id => apiClient.patch(`/alerts/${id}`, { assigned_to_id: assigneeId })));
    const failedIds = ids.filter((_, index) => results[index].status === 'rejected');
    setSelectedIds(new Set(failedIds));
    setPendingIds(current => { const next = new Set(current); ids.forEach(id => next.delete(id)); return next; });
    await fetchAlerts();
    setBulkAssigning(false);
    const target = member ? member.email : 'Unassigned';
    if (failedIds.length > 0) toast(`${failedIds.length} alerts could not be assigned and remain selected.`, 'error');
    else toast(assigneeId === null ? `${ids.length} alerts unassigned.` : `${ids.length} alerts assigned to ${target}.`, 'success');
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Observe" title="Alerts" description={`${total} vulnerability and threat alerts across the monitored estate.`} actions={
        selectedIds.size > 0 ? (
          <div className="flex flex-wrap items-center gap-2 xl:justify-end">
            {members.length > 0 && (
              <select
                aria-label="Assign selected alerts"
                value=""
                disabled={bulkAssigning}
                onChange={(e) => { void handleBulkAssign(e.target.value); }}
                className="min-h-9 rounded-md border border-surface-600 bg-surface-800 px-2.5 text-sm text-surface-200 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50"
              >
                <option value="" disabled>Assign {selectedIds.size} selected...</option>
                {members.map(m => (
                  <option key={m.id} value={m.id}>{m.email}</option>
                ))}
                <option value="none">Unassign</option>
                <option value="auto">Auto: least loaded</option>
              </select>
            )}
            <select
              aria-label="Snooze selected alerts"
              value=""
              onChange={(e) => { void handleBulkSnooze(e.target.value); }}
              className="min-h-9 rounded-md border border-surface-600 bg-surface-800 px-2.5 text-sm text-surface-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="" disabled>Snooze {selectedIds.size} selected...</option>
              <option value="24">24 hours</option>
              <option value="168">7 days</option>
              <option value="720">30 days</option>
            </select>
            <select
              aria-label="Set due date for selected alerts"
              value=""
              disabled={bulkDueApplying}
              onChange={(e) => { void handleBulkDueDate(e.target.value); }}
              className="min-h-9 rounded-md border border-surface-600 bg-surface-800 px-2.5 text-sm text-surface-200 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50"
            >
              <option value="" disabled>Due date for {selectedIds.size} selected...</option>
              <option value="3">Due in 3 days</option>
              <option value="7">Due in 7 days</option>
              <option value="30">Due in 30 days</option>
              <option value="clear">Clear due date</option>
            </select>
            <button
              onClick={() => void handleBulkWatch(true)}
              disabled={Array.from(selectedIds).some(id => pendingIds.has(id))}
              className="flex min-h-9 items-center gap-2 rounded-md border border-surface-600 px-3.5 text-sm font-semibold text-surface-200 hover:border-primary-500/50 disabled:opacity-50"
            >
              Watch ({selectedIds.size})
            </button>
            <button
              onClick={() => void handleBulkWatch(false)}
              disabled={Array.from(selectedIds).some(id => pendingIds.has(id))}
              className="flex min-h-9 items-center gap-2 rounded-md border border-surface-600 px-3.5 text-sm font-semibold text-surface-200 hover:border-primary-500/50 disabled:opacity-50"
            >
              Unwatch ({selectedIds.size})
            </button>
            <button
              onClick={handleBulkAcknowledge}
              disabled={Array.from(selectedIds).some(id => pendingIds.has(id))}
              className="flex min-h-9 items-center gap-2 rounded-md bg-primary-500 px-3.5 text-sm font-semibold text-surface-950 hover:bg-primary-400 disabled:opacity-50"
            >
              <CheckCircle className="w-4 h-4" />
              Acknowledge ({selectedIds.size})
            </button>
            <button
              onClick={handleBulkResolve}
              disabled={Array.from(selectedIds).some(id => pendingIds.has(id))}
              className="flex min-h-9 items-center gap-2 rounded-md border border-surface-600 px-3.5 text-sm font-semibold text-success hover:border-success/50 disabled:opacity-50"
            >
              <CheckCircle className="w-4 h-4" />
              Resolve ({selectedIds.size})
            </button>
          </div>
        ) : undefined
      } />

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <SavedViewsMenu
          currentFilters={{
            ...(severityFilter ? { severity: severityFilter } : {}),
            ...(statusFilter ? { status: statusFilter } : {}),
            ...(cveSearch ? { search: cveSearch } : {}),
            ...(assetFilter ? { asset_id: Number(assetFilter) } : {}),
            ...(assignedFilter ? { assigned: assignedFilter } : {}),
            ...(ageFilter ? { age: ageFilter } : {}),
            sort,
          }}
          onApply={(filters: SavedViewFilters) => {
            setSeverityFilter(filters.severity ?? '');
            setStatusFilter(filters.status ?? '');
            setCveSearch(filters.search ?? '');
            setAssetFilter(filters.asset_id != null ? String(filters.asset_id) : '');
            setAssignedFilter(filters.assigned ?? '');
            setAgeFilter(filters.age ?? '');
            setSort(filters.sort ?? 'created_at_desc');
            setPage(1);
          }}
        />
        <button
          type="button"
          aria-pressed={showSnoozedOnly}
          onClick={() => { setShowSnoozedOnly(current => !current); setPage(1); }}
          className={`px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 ${showSnoozedOnly ? 'bg-primary-500/15 border-primary-500/40 text-primary-300' : 'bg-surface-800 border-surface-600 text-surface-50 hover:bg-surface-700'}`}
        >
          Snoozed
        </button>
        <button
          type="button"
          aria-pressed={overdueOnly}
          onClick={() => { setOverdueOnly(current => !current); setPage(1); }}
          className={`px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 ${overdueOnly ? 'bg-danger/15 border-danger/40 text-danger' : 'bg-surface-800 border-surface-600 text-surface-50 hover:bg-surface-700'}`}
        >
          Overdue
        </button>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-500" />
          <input
            type="text"
            aria-label="Search by CVE or title"
            placeholder="Search CVE or title..."
            value={cveSearch}
            onChange={(e) => { setCveSearch(e.target.value); setPage(1); }}
            className="pl-9 pr-4 py-2 bg-surface-800 border border-surface-600 rounded-lg text-sm text-surface-50 placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>
        <select
          aria-label="Filter by severity"
          value={severityFilter}
          onChange={(e) => { setSeverityFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 bg-surface-800 border border-surface-600 rounded-lg text-sm text-surface-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
        >
          <option value="">All Severities</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        {assetOptions.length > 0 && (
          <select
            aria-label="Filter by asset"
            value={assetFilter}
            onChange={(e) => { setAssetFilter(e.target.value); setPage(1); }}
            className="px-3 py-2 bg-surface-800 border border-surface-600 rounded-lg text-sm text-surface-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="">All assets</option>
            {assetOptions.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        )}
        <select
          aria-label="Filter by status"
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 bg-surface-800 border border-surface-600 rounded-lg text-sm text-surface-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
        >
          <option value="">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="acknowledged">Acknowledged</option>
          <option value="resolved">Resolved</option>
        </select>
        <select
          aria-label="Filter by assignee"
          value={assignedFilter}
          onChange={(e) => { setAssignedFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 bg-surface-800 border border-surface-600 rounded-lg text-sm text-surface-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
        >
          <option value="">Anyone</option>
          <option value="me">Assigned to me</option>
          <option value="unassigned">Unassigned</option>
          <option value="watching">Watched by me</option>
        </select>
        <select
          aria-label="Filter by age"
          value={ageFilter}
          onChange={(e) => { setAgeFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 bg-surface-800 border border-surface-600 rounded-lg text-sm text-surface-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
        >
          <option value="">Any age</option>
          <option value="lt1">Last 24 hours</option>
          <option value="1to7">1-7 days old</option>
          <option value="gt7">Older than 7 days</option>
        </select>
        <select
          aria-label="Sort alerts"
          value={sort}
          onChange={(e) => { setSort(e.target.value); setPage(1); }}
          className="px-3 py-2 bg-surface-800 border border-surface-600 rounded-lg text-sm text-surface-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
        >
          <option value="created_at_desc">Newest first</option>
          <option value="created_at_asc">Oldest first</option>
          <option value="cvss_desc">Highest CVSS</option>
          <option value="cvss_asc">Lowest CVSS</option>
          <option value="severity_desc">Highest severity</option>
          <option value="severity_asc">Lowest severity</option>
        </select>
        <button
          type="button"
          onClick={() => { void exportCsv(); }}
          disabled={exporting}
          className="ml-auto flex items-center gap-2 px-3 py-2 bg-surface-800 hover:bg-surface-700 border border-surface-600 rounded-lg text-sm text-surface-200 transition-colors disabled:opacity-50"
        >
          <Download className="w-4 h-4" aria-hidden="true" />
          {exporting ? 'Exporting...' : 'Export CSV'}
        </button>
      </div>

      {/* Table */}
      {error ? <ErrorState title="Alerts unavailable" description={error} action={<RetryButton onClick={() => void fetchAlerts()} />} /> : <div className="oa-panel overflow-x-auto">
        {loading ? (
          <div className="p-4">
            <LoadingSurface rows={5} label="Loading alerts" />
          </div>
        ) : alerts.length === 0 ? (
          <div className="p-8 text-center text-surface-500">
            <Filter className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>No alerts found</p>
          </div>
        ) : (
          <table className="w-full text-sm min-w-[500px]">
            <thead>
              <tr className="border-b border-surface-700 text-surface-400">
                <th className="px-4 py-3 text-left w-8 hidden sm:table-cell">
                  <input
                    type="checkbox"
                    onChange={(e) => {
                      if (e.target.checked) setSelectedIds(new Set(alerts.map((a) => a.id)));
                      else setSelectedIds(new Set());
                    }}
                    className="rounded border-surface-600"
                    aria-label="Select all alerts"
                  />
                </th>
                <th className="px-4 py-3 text-left">CVE</th>
                <th className="px-4 py-3 text-left">Severity</th>
                <th className="px-4 py-3 text-left">Asset</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left hidden md:table-cell">Date</th>
                <th className="px-4 py-3 w-10" aria-label="Open alert" />
              </tr>
            </thead>
            <tbody>
              {alerts.map((alert) => (
                <tr
                  key={alert.id}
                  tabIndex={0}
                  onClick={() => setSelectedAlert(alert)}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setSelectedAlert(alert);
                    }
                  }}
                  className="group border-b border-surface-700/50 hover:bg-surface-800 cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary-500"
                >
                  <td className="px-4 py-3 hidden sm:table-cell" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(alert.id)}
                      onChange={() => toggleSelect(alert.id)}
                      className="rounded border-surface-600"
                      aria-label={`Select alert ${alert.cve_id}`}
                    />
                  </td>
                  <td className="px-4 py-3 font-mono text-primary-300">
                    {alert.cve_id}
                    {alert.cve_id && epssScores[alert.cve_id] && (
                      <span
                        className={`mt-0.5 block text-xs font-sans ${epssScores[alert.cve_id].score >= 0.5 ? 'text-danger' : epssScores[alert.cve_id].score >= 0.2 ? 'text-warning' : 'text-surface-500'}`}
                        title={`EPSS exploit probability ${(epssScores[alert.cve_id].score * 100).toFixed(1)}%, ${(epssScores[alert.cve_id].percentile * 100).toFixed(0)}th percentile (FIRST.org)`}
                      >
                        EPSS {(epssScores[alert.cve_id].score * 100).toFixed(0)}%
                      </span>
                    )}
                    {alert.cve_id && kevEntries[alert.cve_id] && (
                      <span
                        className="mt-0.5 block text-xs font-sans font-semibold text-danger"
                        title={`Listed in CISA's Known Exploited Vulnerabilities catalog on ${kevEntries[alert.cve_id].date_added ?? 'unknown date'}${kevEntries[alert.cve_id].due_date ? `, remediation due ${kevEntries[alert.cve_id].due_date}` : ''}${kevEntries[alert.cve_id].known_ransomware_campaign_use === 'Known' ? '; used in ransomware campaigns' : ''}`}
                      >
                        KEV listed
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge tone={alertSeverityTones[alert.severity] ?? 'neutral'}>{alert.severity}</StatusBadge>
                  </td>
                  <td className="px-4 py-3 text-surface-300">
                    {alert.asset_name}
                    {alert.assigned_to_email && (
                      <span className="block text-xs text-surface-500 mt-0.5">Assigned to {alert.assigned_to_email}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge tone={alertStatusTones[alert.status] ?? 'neutral'}>{alert.status}</StatusBadge>
                    {isAlertOverdue(alert) && (
                      <span className="mt-1 block text-xs font-sans font-semibold text-danger">
                        Overdue · due {alert.due_date}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-surface-500 hidden md:table-cell">
                    {new Date(alert.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <ChevronRight className="ml-auto w-4 h-4 text-surface-500 opacity-0 transition-opacity group-hover:opacity-100" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>}

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 bg-surface-800 border border-surface-600 rounded text-sm text-surface-300 disabled:opacity-50"
          >
            Previous
          </button>
          <span className="text-sm text-surface-400">
            Page {page} of {pages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(pages, p + 1))}
            disabled={page === pages}
            className="px-3 py-1.5 bg-surface-800 border border-surface-600 rounded text-sm text-surface-300 disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}

      {/* Detail Panel */}
      {selectedAlert && (
        <AlertDetail
          alert={selectedAlert}
          highlightNoteId={Number(searchParams.get('note')) || null}
          onClose={() => setSelectedAlert(null)}
          onAcknowledge={handleAcknowledge}
          onResolve={handleResolve}
          onReopen={handleReopen}
          onSnooze={handleSnooze}
          onAssigned={handleAssigned}
          onDueDateChange={handleDueDateChange}
        />
      )}
    </div>
  );
}
