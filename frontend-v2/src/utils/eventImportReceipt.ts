import type { EventParserPreview } from './eventParserPreview';
export interface ImportReceipt {
  filename: string;
  parser: string;
  received_at: string;
  parser_preview?: EventParserPreview;
  preview_response_unverifiable?: boolean;
  result: { received?: number; ingested?: number; skipped?: number; redacted?: number; source_id?: number; skip_reasons?: Record<string, number> };
}
export const reasonLabels: Record<string, string> = {
  invalid_timestamp: 'Missing, invalid or ambiguous recorded timestamp',
  invalid_fields: 'Invalid normalized field types or values',
  invalid_record: 'Not a JSON object', unsupported_record: 'Unsupported source record', parse_error: 'Source parser error',
};
export function importResponseMetadata(value: unknown): ImportReceipt['result'] {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const output: ImportReceipt['result'] = {};
  for (const key of ['received', 'ingested', 'skipped', 'redacted', 'source_id'] as const) {
    const n = input[key];
    if (typeof n === 'number' && Number.isSafeInteger(n) && n >= 0) output[key] = n;
  }
  if (input.skip_reasons && typeof input.skip_reasons === 'object') {
    const reasons: Record<string, number> = {};
    for (const key of Object.keys(reasonLabels)) {
      const n = (input.skip_reasons as Record<string, unknown>)[key];
      if (typeof n === 'number' && Number.isSafeInteger(n) && n >= 0) reasons[key] = n;
    }
    if (Object.keys(reasons).length) output.skip_reasons = reasons;
  }
  return output;
}

