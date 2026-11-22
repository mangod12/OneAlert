export const MAX_EVENT_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_EVENT_FILE_RECORDS = 50_000;
export interface EventFileReview { format: string; records: number; sampleFields: string[]; }

const objectRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export function reviewEventText(text: string, sourceType = ''): EventFileReview {
  let document: unknown;
  let parsed = false;
  try { document = JSON.parse(text.replace(/^\uFEFF/, '')); parsed = true; } catch { /* Try strict newline-delimited JSON. */ }
  let records: unknown[];
  let format: string;
  if (parsed) {
    if (sourceType === 'aws_cloudtrail' && objectRecord(document) && Object.hasOwn(document, 'Records')) {
      if (Object.keys(document).length !== 1 || !Array.isArray(document.Records)) throw new Error('CloudTrail envelope must contain only a Records array.');
      records = document.Records; format = 'CloudTrail Records envelope';
    } else {
      records = Array.isArray(document) ? document : [document];
      format = Array.isArray(document) ? 'JSON array' : 'JSON object';
    }
    if (records.length > MAX_EVENT_FILE_RECORDS) throw new Error('File limit is 50,000 JSON records.');
    for (let index = 0; index < records.length; index++) if (!objectRecord(records[index])) throw new Error(`Record ${index + 1} must be a JSON object.`);
  } else {
    records = [];
    format = 'Newline-delimited JSON';
    const lines = text.replace(/^\uFEFF/, '').split('\n');
    for (let index = 0; index < lines.length; index++) {
      if (!lines[index].trim()) continue;
      let record: unknown;
      try { record = JSON.parse(lines[index]); } catch { throw new Error(`Invalid JSON on line ${index + 1}. No records will be imported.`); }
      if (!objectRecord(record)) throw new Error(`Line ${index + 1} must contain a JSON object.`);
      records.push(record);
      if (records.length > MAX_EVENT_FILE_RECORDS) throw new Error('File limit is 50,000 JSON records.');
    }
  }
  if (!records.length) throw new Error('No JSON records found in file.');
  const stack: { iterator: Iterator<unknown>; depth: number }[] = [{ iterator: records.values(), depth: 0 }];
  while (stack.length) {
    const frame = stack[stack.length - 1];
    const next = frame.iterator.next();
    if (next.done) { stack.pop(); continue; }
    if (typeof next.value === 'object' && next.value !== null) {
      if (frame.depth >= 64) throw new Error('JSON nesting exceeds 64 levels.');
      stack.push({ iterator: (Array.isArray(next.value) ? next.value : Object.values(next.value)).values(), depth: frame.depth + 1 });
    }
  }
  return { format, records: records.length, sampleFields: [...new Set(records.slice(0, 3).flatMap(record => Object.keys(record as Record<string, unknown>)))].slice(0, 20).map(field => field.length > 100 ? field.slice(0, 100) + '...' : field) };
}

export async function reviewEventFile(file: File, sourceType = ''): Promise<EventFileReview> {
  if (file.size > MAX_EVENT_FILE_BYTES) throw new Error('File exceeds the 10 MiB limit.');
  let bytes: ArrayBuffer;
  try {
    bytes = typeof file.arrayBuffer === 'function' ? await file.arrayBuffer() : await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => reader.result instanceof ArrayBuffer ? resolve(reader.result) : reject(new Error('Unreadable file'));
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file);
    });
  } catch { throw new Error('File could not be read. Choose it again.'); }
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { throw new Error('Event file must be valid UTF-8 JSON.'); }
  return reviewEventText(text, sourceType);
}
