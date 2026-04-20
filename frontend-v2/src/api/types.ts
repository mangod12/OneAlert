export interface User {
  id: number;
  email: string;
  full_name: string | null;
  company: string | null;
  role: string;
  is_active: boolean;
  is_verified: boolean;
  mfa_enabled: boolean;
  created_at: string;
}

export interface Token {
  access_token: string;
  token_type: string;
}

export interface Alert {
  id: number;
  cve_id: string;
  title: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  status: 'pending' | 'acknowledged' | 'resolved' | 'dismissed';
  source: string;
  cvss_score: number | null;
  asset_id: number;
  asset_name: string;
  asset_vendor: string;
  asset_product: string;
  remediation: string | null;
  created_at: string;
  acknowledged_at: string | null;
}

export interface AlertListResponse {
  alerts: Alert[];
  total: number;
  page: number;
  size: number;
  pages: number;
}

export interface AlertStats {
  total_alerts: number;
  critical_alerts: number;
  high_alerts: number;
  medium_alerts: number;
  low_alerts: number;
  pending_alerts: number;
  acknowledged_alerts: number;
}

export interface Asset {
  id: number;
  name: string;
  asset_type: string;
  vendor: string;
  product: string;
  version: string | null;
  cpe_string: string | null;
  description: string | null;
  is_ot_asset: boolean;
  network_zone: string | null;
  primary_protocol: string | null;
  criticality: string | null;
  created_at: string;
}

export interface AssetCreate {
  name: string;
  asset_type: string;
  vendor: string;
  product: string;
  version?: string;
  cpe_string?: string;
  description?: string;
  is_ot_asset?: boolean;
  network_zone?: string;
  primary_protocol?: string;
  criticality?: string;
}

export interface AssetListResponse {
  assets: Asset[];
  total: number;
  page: number;
  size: number;
}

export interface OTSummary {
  managed_ot_assets: number;
  discovered_ot_devices: number;
  high_risk_devices: number;
  uncorrelated_devices: number;
  discovery_gap: number;
}

export interface DiscoveredDevice {
  id: number;
  ip_address: string;
  mac_address: string | null;
  hostname: string | null;
  manufacturer: string | null;
  model: string | null;
  firmware_version: string | null;
  is_ot_device: boolean;
  ot_device_type: string | null;
  risk_score: number;
  is_correlated: boolean;
  protocols: string[];
  industrial_protocols: string[];
  last_seen: string;
}

export interface DiscoveredDeviceListResponse {
  devices: DiscoveredDevice[];
  total: number;
  page: number;
  size: number;
}

export interface ZoneData {
  zone: string;
  count: number;
}

export interface ProtocolData {
  protocol: string;
  count: number;
}
