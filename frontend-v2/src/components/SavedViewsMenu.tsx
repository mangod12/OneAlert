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
  const [open, setOpen] = useState(false);
  const [views, setViews] = useState<Array<SavedView<F>>>([]);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  const loadViews = useCallback(async () => {
    try {
      const resp = await apiClient.get<Array<SavedView<F>>>(basePath);
      setViews(resp.data);
    } catch {
      // The menu still opens; it just shows the last known list.
    }
  }, [basePath]);

  useEffect(() => {
    void loadViews();
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
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      const resp = await apiClient.post<SavedView<F>>(basePath, { name: trimmed, filters: currentFilters });
      setViews(current => [...current, resp.data]);
      setName('');
      toast(`Saved view "${resp.data.name}"`, 'success');
    } catch (error) {
      toast(getApiErrorMessage(error, 'Could not save the view'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const cancelRename = () => {
    setEditingId(null);
    setEditName('');
  };

  const renameView = async (view: SavedView<F>) => {
    const trimmed = editName.trim();
    if (!trimmed || trimmed === view.name) {
      cancelRename();
      return;
    }
    try {
      const resp = await apiClient.patch<SavedView<F>>(`${basePath}${view.id}`, { name: trimmed });
      setViews(current => current.map(entry => (entry.id === view.id ? resp.data : entry)));
      cancelRename();
      toast(`Renamed view to "${resp.data.name}"`, 'success');
    } catch (error) {
      toast(getApiErrorMessage(error, 'Could not rename the view'), 'error');
    }
  };

  const deleteView = async (view: SavedView) => {
    try {
      await apiClient.delete(`${basePath}${view.id}`);
      setViews(current => current.filter(entry => entry.id !== view.id));
    } catch (error) {
      toast(getApiErrorMessage(error, 'Could not delete the view'), 'error');
    }
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
        <div className="absolute left-0 top-full z-40 mt-2 w-72 overflow-hidden rounded-lg border border-surface-700 bg-surface-900 shadow-xl">
          <ul className="max-h-64 overflow-y-auto">
            {views.length === 0 && (
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
                      onClick={() => { onApply(view.filters); setOpen(false); }}
                      className="flex-1 truncate px-3 py-2.5 text-left text-sm text-surface-100"
                    >
                      {view.name}
                    </button>
                    <button
                      type="button"
                      aria-label={`Rename view ${view.name}`}
                      onClick={() => { setEditingId(view.id); setEditName(view.name); }}
                      className="grid h-7 w-7 shrink-0 place-items-center rounded text-surface-500 hover:bg-surface-700 hover:text-surface-100"
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete view ${view.name}`}
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
              value={name}
              maxLength={80}
              onChange={event => setName(event.target.value)}
              onKeyDown={event => { if (event.key === 'Enter') void saveCurrent(); }}
              className="min-w-0 flex-1 rounded-md border border-surface-600 bg-surface-800 px-2 py-1.5 text-xs text-surface-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            <button
              type="button"
              disabled={!name.trim() || saving}
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
