// Feed bounded compressed chunks instead of queuing the complete archive into
// a native inflater before the expanded-byte budget can be checked.
export async function expandEventGzip(bytes: ArrayBuffer, limit: number): Promise<ArrayBuffer> {
  if (typeof DecompressionStream === 'undefined') throw Error('This browser cannot review gzip locally. Unzip the file first. No new preview or import was requested.');
  const input = new Uint8Array(bytes); let offset = 0;
  const source = new ReadableStream<BufferSource>({ pull(controller) {
    if (offset === input.length) { controller.close(); return; }
    controller.enqueue(input.subarray(offset, offset + 256)); offset = Math.min(input.length, offset + 256);
  } });
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try { reader = source.pipeThrough(new DecompressionStream('gzip')).getReader(); }
  catch { throw Error('CloudTrail gzip could not be reviewed locally. Unzip the file first. No new preview or import was requested.'); }
  const chunks: Uint8Array[] = []; let size = 0; let exceeded = false;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limit) { exceeded = true; await reader.cancel().catch(() => {}); break; }
      chunks.push(value);
    }
  } catch { throw Error('CloudTrail gzip is incomplete, corrupt or unsupported. No new preview or import was requested.'); }
  finally { reader.releaseLock(); }
  if (exceeded) throw Error('Expanded event file exceeds the 10 MiB limit. No new preview or import was requested.');
  const output = new Uint8Array(size); let position = 0;
  for (const chunk of chunks) { output.set(chunk, position); position += chunk.byteLength; }
  return output.buffer;
}
