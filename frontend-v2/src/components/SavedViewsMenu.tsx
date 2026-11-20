import { useCallback, useEffect, useRef, useState } from 'react';
import { Bookmark, Pencil, Trash2 } from 'lucide-react';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { toast } from './Toast';

export interface SavedViewFilters {
  severity?: string;
  status?: string;
  search?: string;
  asset_id?: number;
  assigned?: string;
  age?: string;
  sort?: string;
}

interface SavedView<F = SavedViewFilters> {
  id: number;
  name: string;
  filters: F;
  created_at: string;
}

interface SavedViewsMenuProps<F> {
  basePath?: string;
  currentFilters: F;
  onApply: (filters: F) => void;
}

export function SavedViewsMenu<F extends object = SavedViewFilters>({ basePath = '/alerts/views/', currentFilters, onApply }: SavedViewsMenuProps<F>) {
  const [loading, setLoading] = useState(true), [loadError, setLoadError] = useState(''), [mutating, setMutating] = useState(false);
  const loadId = useRef(0), generation = useRef(0), operation = useRef(false);
  const [open, setOpen] = useState(false);
  const [views, setViews] = useState<Array<SavedView<F>>>([]);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  const loadViews = useCallback(async () => {
    const id = ++loadId.current; setLoading(true); setLoadError(''); setViews([]);
    try {
      const resp = await apiClient.get<Array<SavedView<F>>>(basePath);
      if (!Array.isArray(resp.data)) throw new Error('Saved views returned an invalid list. Retry before using them.');
      if (loadId.current === id) setViews(resp.data);
    } catch (err) {
      if (loadId.current === id) setLoadError(getApiErrorMessage(err, 'Saved views could not be loaded. Existing views are unknown, not empty.'));
    } finally { if (loadId.current === id) setLoading(false); }
  }, [basePath]);

  useEffect(() => {
    generation.current += 1; operation.current = false; setMutating(false); setSaving(false); setEditingId(null); setName('');
    void loadViews();
    return () => { loadId.current += 1; generation.current += 1; };
  }, [loadViews]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const saveCurrent = async () => {
    const trimmed = name.trim();
    if (!trimmed || loading || loadError || operation.current) return;
    operation.current = true; const token = generation.current; setMutating(true); setSaving(true);
    try {
      const resp = await apiClient.post<SavedView<F>>(basePath, { name: trimmed, filters: currentFilters });
      if (generation.current !== token) return;
      setViews(current => [...current, resp.data]);
      setName('');
      toast(`Saved view "${resp.data.name}"`, 'success');
    } catch (error) {
      if (generation.current === token) toast(getApiErrorMessage(error, 'Could not save the view'), 'error');
    } finally {
      if (generation.current === token) { operation.current = false; setMutating(false); setSaving(false); }
    }
  };

  const cancelRename = () => {
    setEditingId(null);
    setEditName('');
  };

  const renameView = async (view: SavedView<F>) => {
    if (loading || loadError || operation.current) return;
    const trimmed = editName.trim();
    if (!trimmed || trimmed === view.name) {
      cancelRename();
      return;
    }
    operation.current = true; const token = generation.current; setMutating(true);
    try {
      const resp = await apiClient.patch<SavedView<F>>(`${basePath}${view.id}`, { name: trimmed });
      if (generation.current !== token) return;
      setViews(current => current.map(entry => (entry.id === view.id ? resp.data : entry)));
      cancelRename();
      toast(`Renamed view to "${resp.data.name}"`, 'success');
    } catch (error) {
      if (generation.current === token) toast(getApiErrorMessage(error, 'Could not rename the view'), 'error');
    } finally { if (generation.current === token) { operation.current = false; setMutating(false); } }
  };

  const deleteView = async (view: SavedView<F>) => {
    if (loading || loadError || operation.current) return;
    operation.current = true; const token = generation.current; setMutating(true);
    try {
      await apiClient.delete(`${basePath}${view.id}`);
      if (generation.current !== token) return;
      setViews(current => current.filter(entry => entry.id !== view.id));
    } catch (error) {
      if (generation.current === token) toast(getApiErrorMessage(error, 'Could not delete the view'), 'error');
    } finally { if (generation.current === token) { operation.current = false; setMutating(false); } }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label="Saved views"
        aria-expanded={open}
        onClick={() => setOpen(current => !current)}
        className="flex items-center gap-2 px-3 py-2 bg-surface-800 border border-surface-600 rounded-lg text-sm text-surface-50 hover:bg-surface-700 focus:outline-none focus:ring-2 focus:ring-primary-500"
      >
        <Bookmark className="w-4 h-4 text-surface-400" aria-hidden="true" />
        Views
      </button>
      {open && (
        <div className="absolute left-0 top-full z-40 mt-2 w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-surface-700 bg-surface-900 shadow-xl">
          {loading && <p role="status" className="px-3 py-3 text-xs text-surface-400">Loading saved views...</p>}
          {loadError && <div className="space-y-2 p-3"><p role="alert" className="text-xs text-danger">{loadError}</p><button type="button" className="rounded border border-surface-600 px-2 py-1 text-xs text-primary-300" onClick={() => void loadViews()}>Retry saved views</button></div>}
          <ul className="max-h-64 overflow-y-auto">
            {!loading && !loadError && views.length === 0 && (
              <li className="px-3 py-3 text-center text-xs text-surface-500">No saved views yet</li>
            )}
            {views.map(view => (
              <li key={view.id} className="flex items-center gap-1 pr-1 hover:bg-surface-800">
                {editingId === view.id ? (
                  <input
                    type="text"
                    aria-label={`New name for view ${view.name}`}
                    value={editName}
                    maxLength={80}
                    disabled={mutating}
                    autoFocus
                    onChange={event => setEditName(event.target.value)}
                    onKeyDown={event => {
                      if (event.key === 'Enter') void renameView(view);
                      if (event.key === 'Escape') cancelRename();
                    }}
                    onBlur={cancelRename}
                    className="min-w-0 flex-1 rounded-md border border-surface-600 bg-surface-800 px-2 py-1.5 mx-1 my-1 text-sm text-surface-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={mutating || loading}
                      onClick={() => { onApply(view.filters); setOpen(false); }}
                      className="min-w-0 flex-1 break-words px-3 py-2.5 text-left [overflow-wrap:anywhere] text-sm text-surface-100"
                    >
                      {view.name}
                    </button>
                    <button
                      type="button"
                      aria-label={`Rename view ${view.name}`}
                      disabled={mutating || loading}
                      onClick={() => { setEditingId(view.id); setEditName(view.name); }}
                      className="grid h-7 w-7 shrink-0 place-items-center rounded text-surface-500 hover:bg-surface-700 hover:text-surface-100"
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete view ${view.name}`}
                      disabled={mutating || loading}
                      onClick={() => void deleteView(view)}
                      className="grid h-7 w-7 shrink-0 place-items-center rounded text-surface-500 hover:bg-surface-700 hover:text-danger"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-2 border-t border-surface-700 p-2">
            <input
              type="text"
              aria-label="Name for the saved view"
              placeholder="Save current filters as..."
              disabled={mutating || loading || !!loadError}
              value={name}
              maxLength={80}
              onChange={event => setName(event.target.value)}
              onKeyDown={event => { if (event.key === 'Enter') void saveCurrent(); }}
              className="min-w-0 flex-1 rounded-md border border-surface-600 bg-surface-800 px-2 py-1.5 text-xs text-surface-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            <button
              type="button"
              disabled={!name.trim() || saving || mutating || loading || !!loadError}
              onClick={() => void saveCurrent()}
              className="shrink-0 rounded-md bg-primary-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-primary-500 disabled:opacity-40"
            >
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
