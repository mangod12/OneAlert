export interface PersonalToken { id: number; name: string; prefix: string; created_at: string; last_used_at: string | null; expires_at: string | null; revoked_at: string | null; read_only: boolean }
export interface TokenOwner { id: number; orgId: number | null; role: string }
export interface TokenInventory { owner: TokenOwner; tokens: PersonalToken[] }
export interface TokenProposal { name: string; expires_in_days: number | null; read_only: boolean }
const fail = () => Error('Personal token details could not be verified.');
const record = (value: unknown): Record<string, unknown> => { if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail(); return value as Record<string, unknown>; };
const id = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const label = (value: unknown, max: number): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= max && ![...value].some(char => char.codePointAt(0)! < 32 || char.codePointAt(0) === 127);
export function tokenTime(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z?$/.test(value)) throw fail();
  const normalized = value.replace(/Z$/, '') + 'Z', time = Date.parse(normalized);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 19) !== value.slice(0, 19)) throw fail();
  return time;
}
export const tokenDate = (value: string | null) => value === null ? 'Not set' : new Date(tokenTime(value)).toISOString().replace('T', ' ').replace('Z', ' UTC');
export function checkedPersonalToken(value: unknown): PersonalToken {
  const row = record(value);
  if (!id(row.id) || !label(row.name, 80) || typeof row.prefix !== 'string' || !/^oa_[A-Za-z0-9_-]{9}$/.test(row.prefix) || typeof row.read_only !== 'boolean') throw fail();
  tokenTime(row.created_at);
  for (const key of ['last_used_at', 'expires_at', 'revoked_at']) if (row[key] !== null) tokenTime(row[key]);
  return { id: row.id, name: row.name, prefix: row.prefix, created_at: row.created_at as string, last_used_at: row.last_used_at as string | null, expires_at: row.expires_at as string | null, revoked_at: row.revoked_at as string | null, read_only: row.read_only };
}
export function checkedTokenInventory(identity: unknown, rows: unknown): TokenInventory {
  const who = record(identity);
  if (!id(who.id) || who.org_id !== null && !id(who.org_id) || who.is_active !== true || !['admin', 'analyst', 'viewer'].includes(who.role as string) || !Array.isArray(rows) || rows.length > 10000) throw fail();
  const tokens = rows.map(checkedPersonalToken);
  if (new Set(tokens.map(token => token.id)).size !== tokens.length) throw fail();
  return { owner: { id: who.id, orgId: who.org_id as number | null, role: who.role as string }, tokens };
}
export function checkedTokenProposal(name: string, expiry: string, readOnly: boolean): TokenProposal {
  const clean = name.trim();
  if (!label(clean, 80) || !['', '7', '30', '90', '365'].includes(expiry) || typeof readOnly !== 'boolean') throw fail();
  return { name: clean, expires_in_days: expiry === '' ? null : Number(expiry), read_only: readOnly };
}
export const sameTokenOwner = (a: TokenOwner, b: TokenOwner) => a.id === b.id && a.orgId === b.orgId && a.role === b.role;
export function sameTokenMetadata(a: PersonalToken, b: PersonalToken) {
  // Authentication can update last_used_at while a review is open.
  return a.id === b.id && a.name === b.name && a.prefix === b.prefix && a.created_at === b.created_at && a.expires_at === b.expires_at && a.revoked_at === b.revoked_at && a.read_only === b.read_only;
}
export function sameTokenInventory(a: TokenInventory, b: TokenInventory) {
  return sameTokenOwner(a.owner, b.owner) && a.tokens.length === b.tokens.length && a.tokens.every(token => { const other = b.tokens.find(row => row.id === token.id); return !!other && sameTokenMetadata(token, other); });
}
export function checkedCreatedToken(value: unknown, proposal: TokenProposal, before: TokenInventory): { metadata: PersonalToken; raw: string } {
  const row = record(value), metadata = checkedPersonalToken(value);
  if (metadata.name !== proposal.name || metadata.read_only !== proposal.read_only || metadata.revoked_at !== null || before.tokens.some(token => token.id === metadata.id) || typeof row.token !== 'string' || !/^oa_[A-Za-z0-9_-]{43}$/.test(row.token) || !row.token.startsWith(metadata.prefix)) throw fail();
  if (proposal.expires_in_days === null ? metadata.expires_at !== null : metadata.expires_at === null || Math.abs(tokenTime(metadata.expires_at) - tokenTime(metadata.created_at) - proposal.expires_in_days * 86400000) > 60000) throw fail();
  return { metadata, raw: row.token };
}
export const tokenCapability = (readOnly: boolean) => readOnly ? 'Read-only: GET, HEAD and OPTIONS requests only, with your current permissions.' : 'Read and write: API actions allowed by your current account permissions, including changes and deletions.';
