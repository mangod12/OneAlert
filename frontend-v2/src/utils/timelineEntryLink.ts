export function timelineEntryLink(search: URLSearchParams): { id: number | null; invalid: boolean } {
  const values = search.getAll('note');
  if (!values.length) return { id: null, invalid: false };
  if (values.length !== 1 || !/^[1-9]\d*$/.test(values[0]) || !Number.isSafeInteger(Number(values[0]))) return { id: null, invalid: true };
  return { id: Number(values[0]), invalid: false };
}
