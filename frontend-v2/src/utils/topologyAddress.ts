export function validRecordedAddress(address: string | null | undefined): address is string {
  return typeof address === 'string' && address.length > 0 && address.length <= 256 && address.trim() === address && !Array.from(address).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
}
export function recordedEndpoint(address: string | null, port: number | null) {
  if (!address) return port == null ? 'Not recorded' : `Address not recorded, port ${port}`;
  if (port == null) return address;
  return `${address.includes(':') ? `[${address}]` : address}:${port}`;
}
