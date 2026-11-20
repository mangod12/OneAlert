import type { Asset } from '../api/types';
export const assetComparisonFields = [
  ['name', 'Name'], ['asset_type', 'Asset type'], ['vendor', 'Vendor'], ['product', 'Product'], ['version', 'Version'],
  ['cpe_string', 'CPE identifier'], ['description', 'Recorded description'], ['is_ot_asset', 'Recorded OT classification'],
  ['criticality', 'Criticality'], ['network_zone', 'Network zone'], ['primary_protocol', 'Primary protocol'],
  ['secondary_protocols', 'Secondary protocols'], ['last_known_ip', 'Last known IP'], ['serial_number', 'Serial number'],
  ['firmware_version', 'Firmware version'], ['model_number', 'Model number'], ['manufacturer_date', 'Manufactured'],
  ['discovery_method', 'Discovery method'], ['created_at', 'Created'], ['updated_at', 'Last updated'],
  ['open_alert_count', 'Returned open alert count'], ['risk_score', 'Computed risk score'], ['risk_level', 'Computed risk level'],
] as const satisfies ReadonlyArray<readonly [keyof Asset, string]>;
export function assetValue(value: unknown): string { return value === undefined ? '(field not returned)' : value === null ? '(null: not recorded)' : value === '' ? '(empty text)' : String(value); }
export function validComparisonAsset(value: unknown, id: number): value is Asset {
  if (!value || typeof value !== 'object') return false;
  const asset = value as Asset;
  if (asset.id !== id || ['name', 'asset_type', 'vendor', 'product', 'created_at'].some(key => typeof asset[key as keyof Asset] !== 'string') || typeof asset.is_ot_asset !== 'boolean') return false;
  return assetComparisonFields.every(([key]) => {
    const value = asset[key];
    if (key === 'is_ot_asset') return typeof value === 'boolean';
    if (key === 'risk_score') return value === undefined || value === null || (typeof value === 'number' && Number.isFinite(value));
    if (key === 'open_alert_count') return value === undefined || value === null || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0);
    return value === undefined || value === null || typeof value === 'string';
  });
}
