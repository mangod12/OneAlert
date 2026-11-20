import { expect, it } from 'vitest';
import { assetComparisonFields, assetValue, validComparisonAsset } from './assetComparison';
const asset = { id: 7, name: 'Gateway', asset_type: 'hardware', vendor: 'Vendor', product: 'Device', created_at: '2026-11-20T18:00:00Z', is_ot_asset: false };
it('keeps missing, null, empty, false and zero values distinct', () => {
  expect([undefined, null, '', false, 0].map(assetValue)).toEqual(['(field not returned)', '(null: not recorded)', '(empty text)', 'false', '0']);
});
it('accepts a matching record without inventing missing optional metadata', () => {
  expect(validComparisonAsset(asset, 7)).toBe(true); expect(validComparisonAsset({ ...asset, risk_score: 0, open_alert_count: 0 }, 7)).toBe(true);
  expect(new Set(assetComparisonFields.map(([key]) => key)).size).toBe(assetComparisonFields.length);
});
it.each([{ id: 8 }, { is_ot_asset: 'false' }, { name: null }, { risk_score: Infinity }, { open_alert_count: -1 }, { open_alert_count: 1.5 }, { description: {} }, { secondary_protocols: ['modbus'] }])('rejects malformed or wrong-identity records %j', override => {
  expect(validComparisonAsset({ ...asset, ...override }, 7)).toBe(false);
});
