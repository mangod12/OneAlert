/* Saved JSON evidence is data. Do not invoke a recorded object's string-conversion fields. */
export function recordedValueText(value: unknown, missing = 'Not recorded'): string {
  if (value === null || value === undefined || value === '') return missing;
  if (typeof value === 'object') {
    try { return JSON.stringify(value) ?? missing; } catch { return 'Recorded value could not be rendered'; }
  }
  return String(value);
}
