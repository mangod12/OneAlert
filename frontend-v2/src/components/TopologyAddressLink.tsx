import { validRecordedAddress } from '../utils/topologyAddress';
export function TopologyAddressLink({ address, side }: { address: string | null; side: 'source' | 'destination' }) {
  if (!validRecordedAddress(address)) return null;
  const params = new URLSearchParams({ node: address });
  return <a href={`/app/topology?${params}`} aria-label={`Review topology matches for ${side} ${address}`} className="mt-1 inline-block rounded border border-surface-600 px-2 py-1.5 font-sans text-xs text-primary-300">Topology matches</a>;
}
