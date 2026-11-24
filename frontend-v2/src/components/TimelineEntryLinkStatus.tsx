export function TimelineEntryLinkStatus({ id, invalid, loadedIds }: { id: number | null; invalid: boolean; loadedIds: number[] }) {
  if (invalid) return <p role="alert" className="mb-3 rounded-md border border-warning/40 p-3 text-xs text-warning">This timeline entry link is invalid. Use one positive whole entry ID without spaces, signs, leading zeros or duplicate note parameters. No entry was selected from this link; the loaded timeline is unchanged.</p>;
  if (id !== null && !loadedIds.includes(id)) return <p role="alert" className="mb-3 rounded-md border border-warning/40 p-3 text-xs text-warning">Linked entry #{id} is not present in this loaded investigation timeline. It may have changed or be unavailable. No other entry was selected in its place. This does not prove deletion or grant access to another investigation.</p>;
  return null;
}
