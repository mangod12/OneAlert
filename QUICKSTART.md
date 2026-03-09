# Phase 1 Quick Start Guide

## 5-Minute Setup

### Step 1: Database Migration
Copy and run this SQL script against your OneAlert database:

```sql
-- Create NetworkSensor table
CREATE TABLE IF NOT EXISTS network_sensors (
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
    configuration JSONB,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create DiscoveredDevice table
CREATE TABLE IF NOT EXISTS discovered_devices (
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
    ports_open JSONB,
    services_detected JSONB,
    protocols JSONB,
    industrial_protocols JSONB,
    confidence VARCHAR(50) DEFAULT 'medium',
    discovery_method VARCHAR(50) NOT NULL,
    risk_score FLOAT DEFAULT 0.0,
    risk_factors JSONB,
    is_correlated BOOLEAN DEFAULT FALSE,
    correlation_score FLOAT,
    first_seen TIMESTAMP DEFAULT NOW(),
    last_seen TIMESTAMP DEFAULT NOW(),
    description TEXT,
    notes TEXT,
    tags JSONB,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Add OT fields to assets table
ALTER TABLE assets ADD COLUMN IF NOT EXISTS is_ot_asset BOOLEAN DEFAULT FALSE;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS network_zone VARCHAR(50) DEFAULT 'unknown';
ALTER TABLE assets ADD COLUMN IF NOT EXISTS primary_protocol VARCHAR(50);
ALTER TABLE assets ADD COLUMN IF NOT EXISTS secondary_protocols TEXT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS serial_number VARCHAR(255);
ALTER TABLE assets ADD COLUMN IF NOT EXISTS firmware_version VARCHAR(255);
ALTER TABLE assets ADD COLUMN IF NOT EXISTS model_number VARCHAR(255);
ALTER TABLE assets ADD COLUMN IF NOT EXISTS manufacturer_date TIMESTAMP;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS last_known_ip VARCHAR(45);
ALTER TABLE assets ADD COLUMN IF NOT EXISTS criticality VARCHAR(50) DEFAULT 'medium';
ALTER TABLE assets ADD COLUMN IF NOT EXISTS discovery_method VARCHAR(50);

-- Create indices for performance
CREATE INDEX IF NOT EXISTS idx_discovered_devices_ip ON discovered_devices(ip_address);
CREATE INDEX IF NOT EXISTS idx_discovered_devices_user ON discovered_devices(user_id);
CREATE INDEX IF NOT EXISTS idx_discovered_devices_risk ON discovered_devices(risk_score DESC);
CREATE INDEX IF NOT EXISTS idx_network_sensors_user ON network_sensors(user_id);
```

### Step 2: Verify Deployment
```bash
# Test API is running
curl http://localhost:8000/health

# Should include OT routers
curl http://localhost:8000/docs | grep -i "ot/ics"
```

### Step 3: Authenticate
Get a JWT token (same as before):
```bash
# Replace demo@example.com with your user
curl -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=admin@example.com&password=password123"

# Returns: {"access_token": "eyJ0eXAi...", "token_type": "bearer"}
```

### Step 4: Register a Sensor
```bash
TOKEN="<your_jwt_token_here>"

curl -X POST http://localhost:8000/api/v1/ot/sensors \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Plant Floor SNMP",
    "sensor_type": "passive_snmp",
    "endpoint_url": "https://nms.example.com",
    "location": "Building 1, Control Room",
    "network_segment": "10.1.0.0/24"
  }'

# Returns: {"id": 1, "name": "Plant Floor SNMP", ...}
```

### Step 5: Ingest Discovered Devices
```bash
SENSOR_ID=1

curl -X POST http://localhost:8000/api/v1/ot/ingest/batch \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "sensor_id": 1,
    "discovery_method": "passive_snmp",
    "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
    "devices": [
      {
        "ip_address": "10.1.50.20",
        "mac_address": "00:1a:2b:3c:4d:5e",
        "hostname": "PLC-001",
        "manufacturer": "Siemens",
        "model": "S7-1200",
        "firmware_version": "4.2.0",
        "serial_number": "S123456789",
        "is_ot_device": true,
        "ot_device_type": "plc",
        "ports_open": [502, 80],
        "services_detected": ["modbus", "http"],
        "protocols": ["modbus", "http"],
        "industrial_protocols": ["modbus"],
        "confidence": "high"
      },
      {
        "ip_address": "10.1.50.21",
        "hostname": "HMI-001",
        "manufacturer": "Siemens",
        "model": "Comfort Panel",
        "is_ot_device": true,
        "ot_device_type": "hmi",
        "ports_open": [80],
        "services_detected": ["http"],
        "protocols": ["http"],
        "confidence": "medium"
      }
    ]
  }'

# Returns: {"status": "success", "summary": {"processed": 2, "created": 2, "updated": 0, "skipped": 0}}
```

### Step 6: View Discovered Devices
```bash
curl -X GET "http://localhost:8000/api/v1/ot/discovered-devices?ot_only=true" \
  -H "Authorization: Bearer $TOKEN"

# Returns paginated list of discovered OT devices with risk scores
```

### Step 7: Create Managed OT Asset
```bash
curl -X POST http://localhost:8000/api/v1/assets \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Plant 1 Main PLC",
    "asset_type": "plc",
    "vendor": "Siemens",
    "product": "SIMATIC S7-1200",
    "version": "4.2.0",
    "is_ot_asset": true,
    "network_zone": "control",
    "primary_protocol": "modbus",
    "serial_number": "S123456789",
    "criticality": "high",
    "discovery_method": "passive",
    "description": "Primary process controller for production line"
  }'

# Returns: {"id": 1, "name": "Plant 1 Main PLC", ...}
```

### Step 8: Correlate Discovered Device to Asset
```bash
DEVICE_ID=1
ASSET_ID=1

curl -X POST "http://localhost:8000/api/v1/ot/discovered-devices/$DEVICE_ID/correlate/$ASSET_ID" \
  -H "Authorization: Bearer $TOKEN"

# Now alerts will match against this asset
```

### Step 9: View OT Dashboard
```bash
curl -X GET http://localhost:8000/api/v1/ot/summary \
  -H "Authorization: Bearer $TOKEN"

# Returns:
# {
#   "managed_ot_assets": 1,
#   "discovered_ot_devices": 2,
#   "high_risk_devices": 0,
#   "uncorrelated_devices": 1,
#   "discovery_gap": 1
# }
```

### Step 10: Check for ICS Alerts
Next scheduler run (every 6 hours) will:
1. Fetch CISA KEV vulnerabilities
2. Match against your OT assets
3. Create high-priority alerts for known exploited CVEs
4. Send Slack/email notifications

Monitor logs:
```bash
# Docker / Cloud Run logs
docker logs <container> | grep "ICS"
# or
gcloud run logs read cybersec-saas --tail 50 | grep "ICS"
```

---

## 🎯 Common Tasks

### List All Sensors
```bash
curl -X GET http://localhost:8000/api/v1/ot/sensors \
  -H "Authorization: Bearer $TOKEN"
```

### Search Discovered Devices by Risk
```bash
# High risk only
curl -X GET "http://localhost:8000/api/v1/ot/discovered-devices?risk_min=70" \
  -H "Authorization: Bearer $TOKEN"

# By protocol
curl -X GET "http://localhost:8000/api/v1/ot/devices-by-protocol" \
  -H "Authorization: Bearer $TOKEN"

# By zone
curl -X GET "http://localhost:8000/api/v1/ot/devices-by-zone" \
  -H "Authorization: Bearer $TOKEN"
```

### Promote Discovered Device to Asset
```bash
DEVICE_ID=1

curl -X POST "http://localhost:8000/api/v1/ot/discovered-devices/$DEVICE_ID/promote-to-asset" \
  -H "Authorization: Bearer $TOKEN"

# Automatically creates Asset + correlation
```

### Update Device Metadata
```bash
DEVICE_ID=1

curl -X PATCH "http://localhost:8000/api/v1/ot/discovered-devices/$DEVICE_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "hostname": "PLC-PROD-001",
    "notes": "Critical production controller",
    "tags": ["priority", "scada", "pdl"]
  }'
```

### View All Alerts for OT Asset
```bash
ASSET_ID=1

curl -X GET "http://localhost:8000/api/v1/alerts?asset_id=$ASSET_ID" \
  -H "Authorization: Bearer $TOKEN"
```

---

## 📊 Sample Data

Pre-populate with test devices:

```bash
#!/bin/bash
TOKEN="$1"

# Batch ingest 5 test OT devices
curl -X POST http://localhost:8000/api/v1/ot/ingest/batch \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "sensor_id": 1,
    "discovery_method": "passive_snmp",
    "devices": [
      {
        "ip_address": "10.1.1.50",
        "hostname": "PLC-01",
        "manufacturer": "Siemens",
        "model": "S7-1200",
        "firmware_version": "4.2.0",
        "is_ot_device": true,
        "ot_device_type": "plc",
        "ports_open": [502, 80],
        "services_detected": ["modbus", "http"],
        "industrial_protocols": ["modbus"],
        "confidence": "high",
        "risk_factors": ["unencrypted_web_service", "industrial_protocol_without_encryption"]
      },
      {
        "ip_address": "10.1.1.51",
        "hostname": "HMI-01",
        "manufacturer": "Siemens",
        "model": "Comfort Panel",
        "is_ot_device": true,
        "ot_device_type": "hmi",
        "ports_open": [80],
        "services_detected": ["http"],
        "confidence": "high"
      },
      {
        "ip_address": "10.1.1.52",
        "hostname": "RTU-01",
        "manufacturer": "ABB",
        "model": "RTU520",
        "firmware_version": "1.8",
        "is_ot_device": true,
        "ot_device_type": "rtu",
        "ports_open": [20000],
        "services_detected": ["dnp3"],
        "industrial_protocols": ["dnp3"],
        "confidence": "high",
        "risk_factors": ["outdated_firmware"]
      },
      {
        "ip_address": "10.1.1.53",
        "hostname": "HISTORIAN-01",
        "manufacturer": "FactoryTalk",
        "model": "Historian 7.0",
        "is_ot_device": true,
        "ot_device_type": "historian",
        "ports_open": [5000],
        "services_detected": ["fthistorian"],
        "confidence": "high"
      },
      {
        "ip_address": "10.1.1.54",
        "hostname": "GATEWAY-01",
        "manufacturer": "Cisco",
        "model": "Industrial Ethernet Switch",
        "is_ot_device": false,
        "ports_open": [23, 80],
        "services_detected": ["telnet", "http"],
        "confidence": "high",
        "risk_factors": ["exposed_insecure_remote_access"]
      }
    ]
  }'
```

---

## 🔄 Next Steps

1. **Deploy to staging** and run full integration tests
2. **Test ICS alerts** - wait for scheduler job (6 hours) or trigger manually
3. **Integrate SNMP/Zeek** sensor data
4. **Build frontend** OT dashboard
5. **Document playbooks** for high-risk alerts

---

## 📖 Full Documentation

See `PHASE1_IMPLEMENTATION.md` for comprehensive details on:
- Database schema
- API endpoint details
- Risk scoring formulas
- Configuration options
- Testing checklist
- Roadmap

---

**Ready to go!** 🚀
