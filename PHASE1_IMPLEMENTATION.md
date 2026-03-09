# OneAlert Phase 1 Implementation Guide
## Industrial Asset Intelligence Platform

**Date:** March 9, 2026  
**Status:** Phase 1 Complete (Network Discovery + ICS Feed Integration)

---

## 📋 What Was Implemented

### Core Features

#### 1. **OT/ICS Asset Model Extensions** (`backend/models/asset.py`)
Extended existing `Asset` model with industrial-specific fields:
- **OT Classification:** `is_ot_asset`, `network_zone` (Purdue model), `criticality` level
- **Industrial Protocols:** `primary_protocol`, `secondary_protocols` (Modbus, PROFINET, DNP3, etc.)
- **Device Metadata:** Serial #, firmware version, model #, manufacturer date
- **Discovery Tracking:** `discovery_method`, `last_known_ip`, risk factors
- **New Enums:** `NetworkZone`, `CommunicationProtocol`, `AssetType` extended with OT device types (PLC, HMI, RTU, IED, SCADA_SERVER, etc.)

**Migration Required:** Add columns to `assets` table
```sql
ALTER TABLE assets ADD COLUMN is_ot_asset BOOLEAN DEFAULT FALSE;
ALTER TABLE assets ADD COLUMN network_zone VARCHAR(50) DEFAULT 'unknown';
ALTER TABLE assets ADD COLUMN primary_protocol VARCHAR(50);
ALTER TABLE assets ADD COLUMN secondary_protocols TEXT;
ALTER TABLE assets ADD COLUMN serial_number VARCHAR(255);
ALTER TABLE assets ADD COLUMN firmware_version VARCHAR(255);
ALTER TABLE assets ADD COLUMN model_number VARCHAR(255);
ALTER TABLE assets ADD COLUMN manufacturer_date TIMESTAMP;
ALTER TABLE assets ADD COLUMN last_known_ip VARCHAR(45);
ALTER TABLE assets ADD COLUMN criticality VARCHAR(50) DEFAULT 'medium';
ALTER TABLE assets ADD COLUMN discovery_method VARCHAR(50);
```

---

#### 2. **Network Discovery Models** (`backend/models/discovered_device.py`)
New models for passive asset discovery:

##### `NetworkSensor` Model
- Name, type (snmp_poller, zeek, suricata, shodan, custom_agent)
- Endpoint URL, API token (encrypted)
- Location, network segment
- Heartbeat tracking, discovery count
- Per-sensor custom configuration (JSON)

##### `DiscoveredDevice` Model  
- IP address, MAC, hostname (network identifiers)
- Device fingerprint: manufacturer, model, firmware, serial
- OT classification: device type, industrial protocols detected
- Risk scoring: base score, risk factors, confidence level
- Correlation state: linked to managed `Asset` or uncorrelated
- Timestamps: first/last seen

**Pydantic Schemas:**
- `NetworkSensorCreate/Update/Response`
- `DiscoveredDeviceCreate/Update/Response`
- `DiscoveredDeviceListResponse` (paginated)

**Migration Required:** Create new tables
```sql
CREATE TABLE network_sensors (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    sensor_type VARCHAR(50) NOT NULL,
    endpoint_url VARCHAR(255),
    api_token VARCHAR(255),
    location VARCHAR(255),
    network_segment VARCHAR(255),
    enabled BOOLEAN DEFAULT TRUE,
    last_heartbeat TIMESTAMP,
    last_discovery_count INTEGER DEFAULT 0,
    configuration JSON,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE discovered_devices (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sensor_id INTEGER REFERENCES network_sensors(id) ON DELETE SET NULL,
    asset_id INTEGER REFERENCES assets(id) ON DELETE SET NULL,
    ip_address VARCHAR(45) NOT NULL,
    mac_address VARCHAR(17),
    hostname VARCHAR(255),
    device_class VARCHAR(100),
    manufacturer VARCHAR(255),
    model VARCHAR(255),
    firmware_version VARCHAR(255),
    serial_number VARCHAR(255),
    is_ot_device BOOLEAN DEFAULT FALSE,
    ot_device_type VARCHAR(50),
    ports_open JSON,
    services_detected JSON,
    protocols JSON,
    industrial_protocols JSON,
    confidence VARCHAR(50) DEFAULT 'medium',
    discovery_method VARCHAR(50) NOT NULL,
    risk_score FLOAT DEFAULT 0.0,
    risk_factors JSON,
    is_correlated BOOLEAN DEFAULT FALSE,
    correlation_score FLOAT,
    first_seen TIMESTAMP DEFAULT NOW(),
    last_seen TIMESTAMP DEFAULT NOW(),
    description TEXT,
    notes TEXT,
    tags JSON,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_discovered_devices_ip ON discovered_devices(ip_address);
CREATE INDEX idx_discovered_devices_user ON discovered_devices(user_id);
```

---

#### 3. **OT Router** (`backend/routers/ot.py`)
RESTful endpoints for OT asset management:

**Network Sensor Endpoints:**
- `POST /api/v1/ot/sensors` - Register new sensor
- `GET /api/v1/ot/sensors` - List all sensors
- `GET /api/v1/ot/sensors/{sensor_id}` - Get sensor details
- `PATCH /api/v1/ot/sensors/{sensor_id}` - Update sensor config
- `DELETE /api/v1/ot/sensors/{sensor_id}` - Remove sensor

**Discovered Device Endpoints:**
- `POST /api/v1/ot/discovered-devices` - Ingest discovered device
- `GET /api/v1/ot/discovered-devices` - List (filterable: IP, OT-only, risk score, correlation status)
- `GET /api/v1/ot/discovered-devices/{device_id}` - Get device details
- `PATCH /api/v1/ot/discovered-devices/{device_id}` - Update device metadata
- `POST /api/v1/ot/discovered-devices/{device_id}/correlate/{asset_id}` - Link to managed asset
- `POST /api/v1/ot/discovered-devices/{device_id}/promote-to-asset` - Convert to managed asset

**Analytics Endpoints:**
- `GET /api/v1/ot/summary` - OT dashboard stats (managed OT count, discovered devices, high-risk, uncorrelated)
- `GET /api/v1/ot/devices-by-zone` - Devices grouped by Purdue model zone
- `GET /api/v1/ot/devices-by-protocol` - Devices grouped by protocol

---

#### 4. **Sensor Data Ingestion Router** (`backend/routers/sensor_ingest.py`)
Endpoints for bulk sensor data import:

**Batch Ingestion:**
- `POST /api/v1/ot/ingest/batch` - Import multiple discovered devices
  - Deduplicates by IP/MAC
  - Calculates risk scores
  - Updates heartbeat on sensor
  
**Single Device:**
- `POST /api/v1/ot/ingest/single` - Real-time single device update

**Risk Calculation** (inline):
- Exposed insecure services (SSH, Telnet, HTTP on OT = +25 points each)
- Industrial protocol exposure (Modbus/DNP3 without encryption = +15 points)
- Outdated firmware (version < 2.0 = +20 points)
- Missing security protocols (+10-15 points)

**Risk Factors Identified:**
- `exposed_insecure_remote_access` - Telnet/FTP on OT device
- `unencrypted_web_service` - HTTP ports on OT
- `unencrypted_protocols` - Clear-text protocols
- `industrial_protocol_without_encryption` - Modbus/DNP3 unprotected
- `possible_default_credentials` - Device model suggests defaults

---

#### 5. **ICS-CERT / CISA Feed Service** (`backend/services/ics_cert_feed.py`)
Industrial vulnerability feed aggregation:

**Data Sources:**
- CISA Known Exploited Vulnerabilities (KEV) catalog (JSON)
- ICS-CERT advisory RSS feeds
- Industrial vendor feeds (Siemens, Rockwell, Honeywell, ABB, Schneider, GE, etc.)

**Advisory Structure:**
- Advisory ID (ICSA-26-001-01 format)
- Title, description, remediation
- Affected products: vendor, product, version ranges
- CVE list, CVSS severity
- CISA KEV flag (known to be actively exploited)
- Published/updated dates, source URL

**Current Implementation:**
- Direct fetch of CISA KEV (JSON endpoint)
- Sample industrial CVEs (Siemens S7-1200, Rockwell FactoryTalk examples)
- Extensible for vendor RSS feeds and NVD filtering

**Mock Data Included:**
- ICSA-26-053-01: Siemens S7-1200 RCE (critical, actively exploited)
- ICSA-26-042-02: Rockwell FactoryTalk info disclosure (high)

---

#### 6. **OT Risk Scorer Service** (`backend/services/ot_risk_scorer.py`)
Industrial asset risk assessment engine:

**Scoring Formula:**
```
Risk = (Vulnerability Score × 0.40) +
        (Exposure Score × 0.35) +
        (Criticality Score × 0.25)
```

**Vulnerability Score (0-100):**
- 25 points per critical CVE
- 15 points per high CVE
- 5 points per medium CVE
- 10× points for unpatched >30 days
- CVSS boost: ×1.2 if avg CVSS ≥ 9.0, ×0.8 if < 7.0

**Exposure Score (0-100):**
- Network zone: field (10) → control (25) → supervisory (35) → safety system (40)
- Protocol security: modbus (0%) → HTTPS (90%) → VPN (95%)
- Upstream network detection (+15)
- Dangerous service patterns (+10-35 each)

**Criticality Score (0-100):**
- Device type risk: historian (1.3×) → HMI (1.8×) → PLC (2.0×) → SCADA (2.5×) → SIS (3.0×)
- Zone multiplier: field (1.0×) → control (1.5×) → supervisory (2.0×) → safety (3.0×)
- User-assigned criticality override

**For Discovered Devices:**
- Uses exposure + device profile (lower confidence baseline)
- Fingerprint-based risk assessment (no vulnerability data yet)

---

#### 7. **Enhanced Alert Checker** (`backend/services/alert_checker.py`)

**New Capabilities:**
- `_process_ics_advisories()` - Process ICS advisories alongside CVEs
- `_find_ot_assets_affected_by_advisory()` - Match OT devices by vendor/product/version
- `_create_alert_from_ics_advisory()` - Generate ICS-specific alerts
- CISA KEV detection: 🚨 emoji prefix for actively exploited vulnerabilities
- Severity mapping for industrial advisories

**Integration Points:**
- Imports `ics_cert_feed_service`, `ot_risk_scorer`
- Checks both managed assets (`Asset`) and discovered devices
- Deduplicates by advisory ID (prevents duplicate alerts)

---

#### 8. **Scheduler Updates** (`backend/scheduler/cron.py`)

**New Job:**
- `_run_ot_risk_rescore()` - Runs every 12 hours
  - Recalculates risk scores for all OT assets
  - Considers latest alerts and vulnerability data
  - Logs risk breakdowns for analytics

**Integration with Main Vulnerability Check:**
- ICS advisories fetched alongside CVEs/vendor advisories
- Scheduled every 6 hours (configurable via `SCRAPER_INTERVAL_HOURS`)

---

#### 9. **FastAPI Router Registration** (`backend/main.py`)

**New Routes:**
```python
app.include_router(ot.router, prefix="/api/v1/ot", tags=["OT/ICS"])
app.include_router(sensor_ingest.router, prefix="/api/v1/ot", tags=["OT/ICS"])
```

---

## 🚀 Getting Started

### 1. Database Migration
Run the SQL scripts above to create new tables. Alternatively, the app will auto-create on first run if using `Base.metadata.create_all()`.

### 2. Register a Network Sensor
```bash
curl -X POST http://localhost:8000/api/v1/ot/sensors \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Plant A Network Monitor",
    "sensor_type": "passive_snmp",
    "endpoint_url": "https://nms.example.com",
    "location": "Control Room 1",
    "network_segment": "192.168.10.0/24"
  }'
```

### 3. Ingest Discovered Devices
```bash
curl -X POST http://localhost:8000/api/v1/ot/ingest/batch \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "sensor_id": 1,
    "discovery_method": "passive_snmp",
    "timestamp": "2026-03-09T14:30:00Z",
    "devices": [
      {
        "ip_address": "192.168.1.50",
        "hostname": "PLC-001",
        "manufacturer": "Siemens",
        "model": "S7-1200",
        "firmware_version": "4.2.0",
        "is_ot_device": true,
        "ot_device_type": "plc",
        "ports_open": [502, 80],
        "services_detected": ["modbus", "http"],
        "protocols": ["modbus", "http"],
        "industrial_protocols": ["modbus"],
        "confidence": "high"
      }
    ]
  }'
```

### 4. Create OT Asset Manually
```bash
curl -X POST http://localhost:8000/api/v1/assets \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Production Line 1 PLC",
    "asset_type": "plc",
    "vendor": "Siemens",
    "product": "SIMATIC S7-1200",
    "version": "4.2.0",
    "is_ot_asset": true,
    "network_zone": "control",
    "primary_protocol": "modbus",
    "serial_number": "SN123456",
    "criticality": "high"
  }'
```

### 5. Promote Discovered Device to Asset
```bash
curl -X POST http://localhost:8000/api/v1/ot/discovered-devices/1/promote-to-asset \
  -H "Authorization: Bearer <token>"
```

### 6. View OT Summary
```bash
curl -X GET http://localhost:8000/api/v1/ot/summary \
  -H "Authorization: Bearer <token>"
```

---

## 📊 Data Flow & Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ NETWORK LAYER                                               │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  SNMP Poller    Zeek    Suricata    Custom Agent  Shodan    │
│        │         │         │           │          │        │
│        └─────────┴─────────┴───────────┴──────────┘        │
│                         │                                   │
│                         ▼                                   │
│              POST /api/v1/ot/ingest/batch                  │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
        ┌──────────────────────────────────────┐
        │ SENSOR INGESTION ROUTER              │
        │ - Deduplication                      │
        │ - Risk scoring (inline)              │
        │ - Device fingerprinting              │
        └──────────────────────────────────────┘
                          │
                          ▼
        ┌──────────────────────────────────────┐
        │ DiscoveredDevice Table               │
        │ (Passive inventory)                  │
        └──────────────────────────────────────┘
                   │            │
                   │            ▼
                   │    User Correlation / Promotion
                   │            │
                   │            ▼
                   │    ┌────────────────────┐
                   │    │ Asset Table        │
                   │    │ (Managed assets)   │
                   │    └────────────────────┘
                   │            │
                   └────────────┤
                        │       │
                        ▼       ▼
              ┌─────────────────────────────┐
              │ Vulnerability Checker       │
              │ ├─ NVD CVEs                 │
              │ ├─ Vendor advisories        │
              │ └─ ICS-CERT/CISA KEV ◄─────┼── NEW
              └─────────────────────────────┘
                        │
                        ▼
              ┌─────────────────────────────┐
              │ OT Risk Scorer              │
              │ (Vulnerability +            │
              │  Exposure +                 │
              │  Criticality)               │
              └─────────────────────────────┘
                        │
                        ▼
              ┌─────────────────────────────┐
              │ Alert Table                 │
              │ (Matched to assets)         │
              └─────────────────────────────┘
                        │
                        ▼
              ┌─────────────────────────────┐
              │ Notification Services       │
              │ ├─ Email                    │
              │ ├─ Slack                    │
              │ └─ Webhooks                 │
              └─────────────────────────────┘
```

---

## 🔧 Configuration & Deployment

### Environment Variables
```env
# Existing
DATABASE_URL=postgresql://user:pass@localhost/cybersec_alerts
SECRET_KEY=your-secret-key

# New (optional for Phase 1)
# OT_DISCOVERY_INTERVAL=6  # Hours between risk rescoring
# SENSOR_HEARTBEAT_TIMEOUT=3600  # Seconds
```

### Docker / Cloud Run
No changes to Dockerfile or Cloud Build config needed. New models/routes are automatically picked up.

### Database Auto-Migration
On startup, `Base.metadata.create_all()` in `main.py` will create missing tables:
- `network_sensors`
- `discovered_devices`

Existing `assets`, `users`, `alerts` tables will have OT columns added via migration script (manual step for production).

---

## 🛣️ Next Steps (Phase 2+)

### Immediate Priorities
1. **Real OT Protocol Detection**
   - Modbus/TCP scanner
   - PROFINET device discovery
   - DNP3 enumeration
   - Automatically populate discovered devices

2. **Asset Correlation Engine**
   - Fuzzy matching (hostname, MAC, fingerprints)
   - Auto-correlate discovered → managed assets
   - Correlation confidence scoring

3. **Frontend OT Dashboard**
   - Network topology visualizer (Purdue zones)
   - Risk heat map by protocol/zone
   - Discovered devices unmatched view
   - Bulk device import UI

4. **Compliance Reporting**
   - NERC CIP compliance check
   - IEC 62443 SIL assessment
   - NIST SP 800-82 gap analysis

### Medium-term (Phase 3)
5. **Anomaly Detection**
   - Behavioral baseline for OT protocols
   - Modbus/DNP3 traffic analysis
   - Unauthorized command detection

6. **Incident Response**
   - Automated playbooks for OT incidents
   - Network isolation recommendations
   - Communication templates

7. **Multi-tenant Industrial SaaS**
   - Customer isolation
   - Billing per sensor/asset
   - White-label dashboards

---

## 📝 Testing Checklist

- [ ] OT router endpoints respond with 200 OK
- [ ] Sensor registration creates database record
- [ ] Device ingestion deduplicates by IP
- [ ] Risk scores calculated (0-100 range)
- [ ] ICS advisories fetched (CISA KEV)
- [ ] Alerts created for OT asset + advisory matches
- [ ] Scheduler runs risk rescore job every 12 hours
- [ ] Discovered devices filterable by risk/zone/protocol
- [ ] Device promotion to asset works
- [ ] Device-asset correlation tracked
- [ ] Summary endpoint returns correct counts

---

## 🔗 API Documentation

Full OpenAPI/Swagger docs available at:
```
http://localhost:8000/docs
```

Search for endpoints with tags: `OT/ICS`

---

## 📚 References

- **Purdue Model:** ISA-95 network hierarchy
- **IEC 62443:** Industrial automation security standard
- **NERC CIP:** Bulk power system cyber security
- **CISA:** https://www.cisa.gov/known-exploited-vulnerabilities-catalog
- **NVD ICS:** https://nvd.nist.gov/

---

**Implementation by:** GitHub Copilot  
**Status:** ✅ Phase 1 Complete  
**Next Phase:** Network protocol scanning + topology mapping
