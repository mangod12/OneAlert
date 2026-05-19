"""
Database seeding — realistic OT/ICS manufacturing environment.

Seeds a complete demo environment representing a mid-size water treatment plant
with PLCs, HMIs, SCADA servers, network sensors, discovered devices, and alerts.
"""

import asyncio
from datetime import datetime, timedelta, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from backend.database.db import AsyncSessionLocal
from backend.models.user import User
from backend.models.asset import Asset
from backend.models.alert import Alert, AlertStatus, Severity
from backend.models.discovered_device import NetworkSensor, DiscoveredDevice
from backend.models.network_connection import NetworkConnection
from backend.services.auth_service import get_password_hash
import logging

logger = logging.getLogger(__name__)

NOW = datetime.now(timezone.utc)


async def create_demo_user(session: AsyncSession) -> User:
    """Create demo admin user for water treatment plant."""
    existing = await session.get(User, 1)
    if existing:
        logger.info(f"Demo user '{existing.email}' already exists.")
        return existing

    user = User(
        email="admin@example.com",
        hashed_password=get_password_hash("password123"),
        full_name="Admin User",
        company="AquaPure Water Treatment Ltd.",
        is_active=True,
        is_verified=True,
        role="admin",
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    logger.info(f"Created demo user: {user.email}")
    return user


async def create_assets(session: AsyncSession, user_id: int) -> list:
    """Create realistic OT/IT assets for a water treatment plant."""
    result = await session.execute(select(Asset).where(Asset.user_id == user_id).limit(1))
    if result.scalar_one_or_none():
        logger.info("Assets already seeded.")
        return []

    assets_data = [
        # === Level 0 — Field Devices (Sensors/Actuators) ===
        {
            "name": "Endress+Hauser Promag 400 Flow Meter",
            "asset_type": "hardware",
            "vendor": "Endress+Hauser",
            "product": "Promag 400",
            "version": "FW 3.02.00",
            "description": "Electromagnetic flow meter on raw water intake pipe. Measures flow rate for chlorine dosing PID loop.",
            "cpe_string": "cpe:2.3:h:endress_hauser:promag_400:-:*:*:*:*:*:*:*",
            "is_ot_asset": True,
            "network_zone": "field",
            "primary_protocol": "hart",
            "criticality": "high",
            "last_known_ip": "10.1.0.11",
            "serial_number": "EH-PM400-2019-0447",
        },
        {
            "name": "Siemens SIPART PS2 Valve Positioner",
            "asset_type": "hardware",
            "vendor": "Siemens",
            "product": "SIPART PS2",
            "version": "FW 5.0",
            "description": "Smart valve positioner controlling chlorine injection valve V-201.",
            "is_ot_asset": True,
            "network_zone": "field",
            "primary_protocol": "profibus",
            "criticality": "high",
            "last_known_ip": "10.1.0.15",
            "serial_number": "SI-PS2-2020-1182",
        },
        # === Level 1 — Basic Control (PLCs/RTUs) ===
        {
            "name": "Allen-Bradley ControlLogix 5580",
            "asset_type": "plc",
            "vendor": "Rockwell Automation",
            "product": "ControlLogix 5580",
            "version": "V33.011",
            "description": "Primary PLC controlling filtration process (Zone A). Manages backwash sequences, filter bed valves, and turbidity monitoring.",
            "cpe_string": "cpe:2.3:h:rockwellautomation:controllogix_5580:-:*:*:*:*:*:*:*",
            "is_ot_asset": True,
            "network_zone": "control",
            "primary_protocol": "ethernet_ip",
            "criticality": "critical",
            "last_known_ip": "10.2.1.10",
            "serial_number": "RA-CL5580-2021-A003",
            "firmware_version": "V33.011",
        },
        {
            "name": "Siemens S7-1500 CPU 1516-3 PN/DP",
            "asset_type": "plc",
            "vendor": "Siemens",
            "product": "S7-1500 CPU 1516-3",
            "version": "V2.9.4",
            "description": "PLC controlling chemical dosing subsystem — coagulant (alum), pH adjustment, and disinfection (chlorine/UV).",
            "cpe_string": "cpe:2.3:h:siemens:simatic_s7-1500:-:*:*:*:*:*:*:*",
            "is_ot_asset": True,
            "network_zone": "control",
            "primary_protocol": "profinet",
            "criticality": "critical",
            "last_known_ip": "10.2.1.20",
            "serial_number": "SI-S7-1516-2022-0891",
            "firmware_version": "V2.9.4",
        },
        {
            "name": "Schneider Electric Modicon M340",
            "asset_type": "plc",
            "vendor": "Schneider Electric",
            "product": "Modicon M340",
            "version": "V3.60",
            "description": "PLC managing pump station and sludge handling. Controls VFDs for raw water pumps P-101 through P-104.",
            "cpe_string": "cpe:2.3:h:schneider-electric:modicon_m340:-:*:*:*:*:*:*:*",
            "is_ot_asset": True,
            "network_zone": "control",
            "primary_protocol": "modbus",
            "criticality": "high",
            "last_known_ip": "10.2.1.30",
            "serial_number": "SE-M340-2019-3321",
            "firmware_version": "V3.60",
        },
        # === Level 2 — Supervisory (HMI/Engineering Workstations) ===
        {
            "name": "AVEVA InTouch HMI — Control Room A",
            "asset_type": "hmi",
            "vendor": "AVEVA",
            "product": "InTouch",
            "version": "2023 R2",
            "description": "Primary operator HMI in Control Room A. Displays real-time process graphics for filtration, dosing, and distribution.",
            "cpe_string": "cpe:2.3:a:aveva:intouch:2023:*:*:*:*:*:*:*",
            "is_ot_asset": True,
            "network_zone": "supervisory",
            "primary_protocol": "opc_ua",
            "criticality": "high",
            "last_known_ip": "10.3.1.10",
            "serial_number": "AV-IT-2023-001",
        },
        {
            "name": "Siemens WinCC SCADA Server",
            "asset_type": "scada_server",
            "vendor": "Siemens",
            "product": "WinCC Professional",
            "version": "V18.0",
            "description": "Central SCADA server aggregating data from all PLCs. Runs on Windows Server 2022. Handles alarming, trending, and recipe management.",
            "cpe_string": "cpe:2.3:a:siemens:wincc:18.0:*:*:*:*:*:*:*",
            "is_ot_asset": True,
            "network_zone": "supervisory",
            "primary_protocol": "opc_ua",
            "criticality": "critical",
            "last_known_ip": "10.3.1.5",
            "serial_number": "SI-WCC-2024-SVR1",
        },
        {
            "name": "OSIsoft PI Historian",
            "asset_type": "historian",
            "vendor": "AVEVA (OSIsoft)",
            "product": "PI Data Archive",
            "version": "2023",
            "description": "Process historian archiving 15,000+ tags at 1-second intervals. Critical for regulatory compliance reporting and trend analysis.",
            "cpe_string": "cpe:2.3:a:osisoft:pi_data_archive:2023:*:*:*:*:*:*:*",
            "is_ot_asset": True,
            "network_zone": "supervisory",
            "primary_protocol": "https",
            "criticality": "high",
            "last_known_ip": "10.3.1.20",
        },
        # === Level 3 — DMZ ===
        {
            "name": "Fortinet FortiGate 200F",
            "asset_type": "hardware",
            "vendor": "Fortinet",
            "product": "FortiGate 200F",
            "version": "FortiOS 7.4.3",
            "description": "OT/IT DMZ firewall separating corporate network from SCADA zone. Enforces whitelisted traffic rules.",
            "cpe_string": "cpe:2.3:o:fortinet:fortios:7.4.3:*:*:*:*:*:*:*",
            "is_ot_asset": False,
            "network_zone": "dmz",
            "primary_protocol": "https",
            "criticality": "critical",
            "last_known_ip": "10.4.0.1",
            "firmware_version": "7.4.3",
        },
        # === Level 4/5 — Enterprise IT ===
        {
            "name": "Windows Server 2022 — Active Directory",
            "asset_type": "operating_system",
            "vendor": "Microsoft",
            "product": "Windows Server",
            "version": "2022",
            "description": "Domain controller managing user authentication for both IT and OT workstation access.",
            "cpe_string": "cpe:2.3:o:microsoft:windows_server_2022:-:*:*:*:*:*:*:*",
            "is_ot_asset": False,
            "network_zone": "it",
            "primary_protocol": "https",
            "criticality": "high",
            "last_known_ip": "10.5.0.10",
        },
        {
            "name": "Cisco Catalyst 9300 Switch",
            "asset_type": "hardware",
            "vendor": "Cisco",
            "product": "Catalyst 9300",
            "version": "IOS-XE 17.9.4",
            "description": "Core switch connecting OT VLAN to DMZ. Enforces 802.1X and VLAN segmentation between process zones.",
            "cpe_string": "cpe:2.3:o:cisco:ios_xe:17.9.4:*:*:*:*:*:*:*",
            "is_ot_asset": False,
            "network_zone": "it",
            "primary_protocol": "https",
            "criticality": "high",
            "last_known_ip": "10.5.0.1",
            "firmware_version": "17.9.4",
        },
    ]

    assets = []
    for data in assets_data:
        asset = Asset(user_id=user_id, **data)
        session.add(asset)
        assets.append(asset)

    await session.commit()
    for a in assets:
        await session.refresh(a)
    logger.info(f"Created {len(assets)} demo assets.")
    return assets


async def create_alerts(session: AsyncSession, user_id: int, assets: list):
    """Create realistic vulnerability alerts."""
    result = await session.execute(select(Alert).where(Alert.user_id == user_id).limit(1))
    if result.scalar_one_or_none():
        logger.info("Alerts already seeded.")
        return

    # Map assets by name prefix for easy lookup
    asset_map = {a.name: a for a in assets}
    s7 = asset_map.get("Siemens S7-1500 CPU 1516-3 PN/DP")
    cl = asset_map.get("Allen-Bradley ControlLogix 5580")
    m340 = asset_map.get("Schneider Electric Modicon M340")
    wincc = asset_map.get("Siemens WinCC SCADA Server")
    forti = asset_map.get("Fortinet FortiGate 200F")
    pi = asset_map.get("OSIsoft PI Historian")

    alerts_data = [
        {
            "asset_id": s7.id if s7 else 1,
            "cve_id": "CVE-2023-44373",
            "title": "Siemens S7-1500 CPU — Pre-Auth Remote Code Execution via Memory Corruption",
            "description": "A vulnerability in the webserver of SIMATIC S7-1500 CPUs allows an unauthenticated attacker to crash the device or execute arbitrary code. The affected firmware processes HTTP requests without proper bounds checking.",
            "severity": Severity.CRITICAL.value,
            "cvss_score": 9.8,
            "remediation": "Update firmware to V2.9.7 or later. Apply Siemens Advisory SSA-711309. As immediate mitigation, disable the web server interface and restrict network access to the PLC.",
            "source_url": "https://cert-portal.siemens.com/productcert/html/ssa-711309.html",
            "status": AlertStatus.PENDING.value,
            "created_at": NOW - timedelta(hours=6),
        },
        {
            "asset_id": cl.id if cl else 1,
            "cve_id": "CVE-2024-6242",
            "title": "Rockwell ControlLogix — CIP Protocol Authentication Bypass",
            "description": "A flaw in Rockwell Automation ControlLogix and GuardLogix controllers allows an attacker to bypass the Trusted Slot feature via crafted CIP requests, potentially modifying PLC logic without authentication.",
            "severity": Severity.CRITICAL.value,
            "cvss_score": 9.1,
            "remediation": "Apply firmware update V33.017+. Enable CIP Security with TLS mutual authentication. Restrict CIP traffic to authorized engineering workstations only.",
            "source_url": "https://www.cisa.gov/news-events/ics-advisories/icsa-24-214-09",
            "status": AlertStatus.PENDING.value,
            "created_at": NOW - timedelta(hours=2),
        },
        {
            "asset_id": m340.id if m340 else 1,
            "cve_id": "CVE-2024-8936",
            "title": "Schneider Modicon M340 — Unencrypted Modbus/TCP Credential Exposure",
            "description": "Authentication credentials for Schneider Electric Modicon M340 PLCs are transmitted in cleartext over Modbus/TCP. An attacker with network access can intercept credentials and gain full control of the PLC.",
            "severity": Severity.HIGH.value,
            "cvss_score": 8.1,
            "remediation": "Deploy encrypted VPN overlay for Modbus traffic. Segment PLC network behind firewall with strict ACLs. Plan upgrade path to M580 with native encrypted communication.",
            "source_url": "https://www.cisa.gov/news-events/ics-advisories/icsa-24-352-04",
            "status": AlertStatus.ACKNOWLEDGED.value,
            "acknowledged_at": NOW - timedelta(hours=1),
            "created_at": NOW - timedelta(days=3),
        },
        {
            "asset_id": wincc.id if wincc else 1,
            "cve_id": "CVE-2024-30321",
            "title": "Siemens WinCC — SQL Injection in Web-Based Management Interface",
            "description": "The web-based management interface of SIMATIC WinCC contains an SQL injection vulnerability. An authenticated attacker can extract database contents including process variable histories and user credentials.",
            "severity": Severity.HIGH.value,
            "cvss_score": 7.6,
            "remediation": "Apply WinCC update to V18.0 Update 4. Restrict web management interface access to dedicated management VLAN.",
            "source_url": "https://cert-portal.siemens.com/productcert/html/ssa-240789.html",
            "status": AlertStatus.PENDING.value,
            "created_at": NOW - timedelta(days=1),
        },
        {
            "asset_id": forti.id if forti else 1,
            "cve_id": "CVE-2024-21762",
            "title": "FortiOS — Out-of-Bound Write in SSL VPN (CISA KEV)",
            "description": "A critical out-of-bounds write vulnerability in FortiOS SSL VPN allows unauthenticated remote code execution. This vulnerability is being actively exploited in the wild and is listed in CISA's Known Exploited Vulnerabilities catalog.",
            "severity": Severity.CRITICAL.value,
            "cvss_score": 9.6,
            "remediation": "IMMEDIATE: Upgrade FortiOS to 7.4.4 or 7.2.8. If patching is not immediately possible, disable SSL VPN as an emergency workaround. Monitor for indicators of compromise.",
            "source_url": "https://www.cisa.gov/known-exploited-vulnerabilities-catalog",
            "status": AlertStatus.PENDING.value,
            "created_at": NOW - timedelta(hours=1),
        },
        {
            "asset_id": pi.id if pi else 1,
            "cve_id": "CVE-2023-34348",
            "title": "AVEVA PI Server — Improper Access Control Allows Unauthorized Data Reads",
            "description": "AVEVA PI Server allows unauthenticated users to read process data via the PI Web API if default trust settings are not hardened. Exposes 15,000+ process tags to network-adjacent attackers.",
            "severity": Severity.MEDIUM.value,
            "cvss_score": 5.3,
            "remediation": "Disable anonymous access to PI Web API. Configure PI Identity mappings to require Windows authentication. Enable PI audit logging.",
            "source_url": "https://www.cisa.gov/news-events/ics-advisories/icsa-23-220-01",
            "status": AlertStatus.ACKNOWLEDGED.value,
            "acknowledged_at": NOW - timedelta(days=2),
            "created_at": NOW - timedelta(days=7),
        },
    ]

    for data in alerts_data:
        alert = Alert(user_id=user_id, **data)
        session.add(alert)

    await session.commit()
    logger.info(f"Created {len(alerts_data)} demo alerts.")


async def create_network_sensors(session: AsyncSession, user_id: int):
    """Create network monitoring sensors."""
    result = await session.execute(select(NetworkSensor).where(NetworkSensor.user_id == user_id).limit(1))
    if result.scalar_one_or_none():
        logger.info("Sensors already seeded.")
        return

    sensors = [
        NetworkSensor(
            user_id=user_id,
            name="Plant A — SPAN Port Sensor (Control Network)",
            sensor_type="zeek",
            location="Control Room A — Network Rack 2",
            network_segment="10.2.1.0/24",
            enabled=True,
            last_heartbeat=NOW - timedelta(minutes=5),
            last_discovery_count=8,
        ),
        NetworkSensor(
            user_id=user_id,
            name="DMZ Perimeter — Suricata IDS",
            sensor_type="suricata",
            location="Server Room — DMZ Rack",
            network_segment="10.4.0.0/24",
            enabled=True,
            last_heartbeat=NOW - timedelta(minutes=2),
            last_discovery_count=3,
        ),
    ]

    for s in sensors:
        session.add(s)
    await session.commit()
    logger.info(f"Created {len(sensors)} network sensors.")


async def create_discovered_devices(session: AsyncSession, user_id: int):
    """Create discovered (unmanaged) devices found by passive scanning."""
    result = await session.execute(select(DiscoveredDevice).where(DiscoveredDevice.user_id == user_id).limit(1))
    if result.scalar_one_or_none():
        logger.info("Discovered devices already seeded.")
        return

    devices = [
        DiscoveredDevice(
            user_id=user_id,
            ip_address="10.2.1.50",
            mac_address="00:1B:1B:A7:33:4C",
            hostname="PLC-BACKUP-01",
            device_class="PLC",
            manufacturer="Rockwell Automation",
            model="CompactLogix 5380",
            firmware_version="V32.014",
            is_ot_device=True,
            ot_device_type="plc",
            ports_open=[44818, 80, 443],
            protocols=["ethernet_ip", "http"],
            industrial_protocols=["ethernet_ip", "cip"],
            risk_score=72.0,
            risk_factors=["unpatched_firmware", "no_authentication_enabled", "exposed_web_interface"],
            discovery_method="passive_network_scan",
            confidence="high",
            is_correlated=False,
            description="Backup PLC discovered on control network — not in asset inventory. Running outdated firmware.",
        ),
        DiscoveredDevice(
            user_id=user_id,
            ip_address="10.2.1.99",
            mac_address="00:80:F4:12:AB:01",
            hostname=None,
            device_class="RTU",
            manufacturer="Honeywell",
            model="RTU2020",
            firmware_version="R400.1",
            is_ot_device=True,
            ot_device_type="rtu",
            ports_open=[502, 20000],
            protocols=["modbus", "dnp3"],
            industrial_protocols=["modbus", "dnp3"],
            risk_score=85.0,
            risk_factors=["unencrypted_protocol", "no_authentication", "high_criticality_zone", "unknown_device"],
            discovery_method="modbus_scan",
            confidence="medium",
            is_correlated=False,
            description="Unknown RTU responding to Modbus queries on control network. Not in asset inventory — potential rogue device or undocumented legacy equipment.",
        ),
        DiscoveredDevice(
            user_id=user_id,
            ip_address="10.3.1.88",
            mac_address="B8:27:EB:44:55:66",
            hostname="raspberrypi",
            device_class="Server",
            manufacturer="Raspberry Pi Foundation",
            model="Raspberry Pi 4 Model B",
            is_ot_device=False,
            ot_device_type=None,
            ports_open=[22, 80, 3000, 9090],
            protocols=["ssh", "http"],
            industrial_protocols=[],
            risk_score=90.0,
            risk_factors=["unauthorized_device", "multiple_services_exposed", "scada_zone_violation", "default_hostname"],
            discovery_method="passive_network_scan",
            confidence="high",
            is_correlated=False,
            description="Unauthorized Raspberry Pi detected in SCADA network zone. Running SSH, HTTP, Grafana (3000), and Prometheus (9090). Potential shadow IT or attacker implant.",
        ),
        DiscoveredDevice(
            user_id=user_id,
            ip_address="10.1.0.44",
            mac_address="00:0C:29:3E:8A:11",
            hostname="VFD-PUMP-P103",
            device_class="VFD",
            manufacturer="ABB",
            model="ACS580",
            firmware_version="8.12",
            is_ot_device=True,
            ot_device_type="other_ot",
            ports_open=[502, 80],
            protocols=["modbus", "http"],
            industrial_protocols=["modbus"],
            risk_score=45.0,
            risk_factors=["unencrypted_protocol", "web_interface_exposed"],
            discovery_method="modbus_scan",
            confidence="high",
            is_correlated=False,
            description="ABB variable frequency drive for raw water pump P-103. Modbus interface accessible without authentication.",
        ),
    ]

    for d in devices:
        session.add(d)
    await session.commit()
    logger.info(f"Created {len(devices)} discovered devices.")


async def create_network_connections(session: AsyncSession, user_id: int):
    """Create network topology connections."""
    result = await session.execute(select(NetworkConnection).where(NetworkConnection.user_id == user_id).limit(1))
    if result.scalar_one_or_none():
        logger.info("Network connections already seeded.")
        return

    connections = [
        # PLC ↔ SCADA
        NetworkConnection(user_id=user_id, source_ip="10.2.1.10", target_ip="10.3.1.5", protocol="ethernet_ip", port=44818, is_encrypted=False, bytes_transferred=5242880),
        NetworkConnection(user_id=user_id, source_ip="10.2.1.20", target_ip="10.3.1.5", protocol="profinet", port=102, is_encrypted=False, bytes_transferred=3145728),
        NetworkConnection(user_id=user_id, source_ip="10.2.1.30", target_ip="10.3.1.5", protocol="modbus", port=502, is_encrypted=False, bytes_transferred=1048576),
        # HMI ↔ SCADA
        NetworkConnection(user_id=user_id, source_ip="10.3.1.10", target_ip="10.3.1.5", protocol="opc_ua", port=4840, is_encrypted=True, bytes_transferred=8388608),
        # SCADA ↔ Historian
        NetworkConnection(user_id=user_id, source_ip="10.3.1.5", target_ip="10.3.1.20", protocol="https", port=443, is_encrypted=True, bytes_transferred=15728640),
        # SCADA ↔ DMZ Firewall
        NetworkConnection(user_id=user_id, source_ip="10.3.1.5", target_ip="10.4.0.1", protocol="https", port=443, is_encrypted=True, bytes_transferred=2097152),
        # Rogue Pi talking to SCADA (suspicious)
        NetworkConnection(user_id=user_id, source_ip="10.3.1.88", target_ip="10.3.1.5", protocol="http", port=80, is_encrypted=False, bytes_transferred=524288),
        # Unknown RTU talking Modbus to PLC
        NetworkConnection(user_id=user_id, source_ip="10.2.1.99", target_ip="10.2.1.30", protocol="modbus", port=502, is_encrypted=False, bytes_transferred=65536),
        # VFD to PLC
        NetworkConnection(user_id=user_id, source_ip="10.1.0.44", target_ip="10.2.1.30", protocol="modbus", port=502, is_encrypted=False, bytes_transferred=131072),
        # Firewall to Corporate AD
        NetworkConnection(user_id=user_id, source_ip="10.4.0.1", target_ip="10.5.0.10", protocol="https", port=443, is_encrypted=True, bytes_transferred=4194304),
    ]

    for c in connections:
        session.add(c)
    await session.commit()
    logger.info(f"Created {len(connections)} network connections.")


async def create_security_events(session: AsyncSession, user_id: int):
    """Create a realistic multi-stage attack scenario in security events.

    Scenario: Attacker compromises VPN → lateral movement to engineering
    workstation → attempts PLC modification → detected by Suricata/Zeek.
    """
    from backend.models.security_event import SecurityEvent, EventSource

    result = await session.execute(select(SecurityEvent).where(SecurityEvent.user_id == user_id).limit(1))
    if result.scalar_one_or_none():
        logger.info("Security events already seeded.")
        return

    # Create event sources
    suricata_src = EventSource(user_id=user_id, name="DMZ Suricata IDS", source_type="suricata", status="active", event_count=0)
    zeek_src = EventSource(user_id=user_id, name="Control Net Zeek Sensor", source_type="zeek", status="active", event_count=0)
    session.add(suricata_src)
    session.add(zeek_src)
    await session.flush()

    # Attack timeline (multi-stage intrusion scenario)
    events = [
        # Stage 1: Initial Access — VPN brute force from external IP
        SecurityEvent(user_id=user_id, source_id=suricata_src.id, timestamp=NOW - timedelta(hours=8),
                      event_type="alert", severity="medium", signature="ET SCAN Potential VPN Brute Force",
                      signature_id="2024501", category="Attempted Information Leak",
                      source_ip="203.0.113.42", dest_ip="10.4.0.1", dest_port=443, protocol="tcp",
                      action="allowed", source_type="suricata"),
        SecurityEvent(user_id=user_id, source_id=suricata_src.id, timestamp=NOW - timedelta(hours=7, minutes=55),
                      event_type="alert", severity="high", signature="ET POLICY Successful VPN Login After Multiple Failures",
                      signature_id="2024502", category="Potentially Bad Traffic",
                      source_ip="203.0.113.42", dest_ip="10.4.0.1", dest_port=443, protocol="tcp",
                      action="allowed", source_type="suricata"),

        # Stage 2: Reconnaissance — internal port scanning
        SecurityEvent(user_id=user_id, source_id=zeek_src.id, timestamp=NOW - timedelta(hours=7, minutes=30),
                      event_type="conn", severity="info", category="network_connection",
                      source_ip="10.5.0.50", dest_ip="10.3.1.5", dest_port=445, protocol="tcp",
                      source_type="zeek"),
        SecurityEvent(user_id=user_id, source_id=zeek_src.id, timestamp=NOW - timedelta(hours=7, minutes=29),
                      event_type="conn", severity="info", category="network_connection",
                      source_ip="10.5.0.50", dest_ip="10.3.1.10", dest_port=3389, protocol="tcp",
                      source_type="zeek"),
        SecurityEvent(user_id=user_id, source_id=suricata_src.id, timestamp=NOW - timedelta(hours=7, minutes=25),
                      event_type="alert", severity="high", signature="ET SCAN Nmap SYN Scan — Multiple Ports",
                      signature_id="2024100", category="Attempted Information Leak",
                      source_ip="10.5.0.50", dest_ip="10.2.1.0", dest_port=None, protocol="tcp",
                      action="allowed", source_type="suricata"),

        # Stage 3: Lateral Movement — RDP to engineering workstation
        SecurityEvent(user_id=user_id, source_id=zeek_src.id, timestamp=NOW - timedelta(hours=6, minutes=45),
                      event_type="conn", severity="medium", category="network_connection",
                      source_ip="10.5.0.50", dest_ip="10.3.1.10", dest_port=3389, protocol="tcp",
                      bytes_in=2048000, bytes_out=512000, source_type="zeek", action="SF"),

        # Stage 4: SMB access to historian
        SecurityEvent(user_id=user_id, source_id=zeek_src.id, timestamp=NOW - timedelta(hours=6, minutes=20),
                      event_type="conn", severity="medium", category="network_connection",
                      source_ip="10.3.1.10", dest_ip="10.3.1.20", dest_port=445, protocol="tcp",
                      bytes_in=50000000, bytes_out=1024, source_type="zeek"),

        # Stage 5: Suspicious DNS — C2 beacon
        SecurityEvent(user_id=user_id, source_id=suricata_src.id, timestamp=NOW - timedelta(hours=6),
                      event_type="dns", severity="high", signature="ET TROJAN DNS Query for Suspected C2 Domain",
                      signature_id="2024600", category="A Network Trojan was detected",
                      source_ip="10.3.1.10", dest_ip="8.8.8.8", domain="update.systempatch-cdn.xyz",
                      source_type="suricata"),
        SecurityEvent(user_id=user_id, source_id=zeek_src.id, timestamp=NOW - timedelta(hours=5, minutes=50),
                      event_type="dns", severity="info", category="dns_a",
                      source_ip="10.3.1.10", dest_ip="8.8.8.8", domain="update.systempatch-cdn.xyz",
                      source_type="zeek"),

        # Stage 6: Attempt to reach PLC subnet (BLOCKED by firewall rule)
        SecurityEvent(user_id=user_id, source_id=suricata_src.id, timestamp=NOW - timedelta(hours=5, minutes=30),
                      event_type="alert", severity="critical",
                      signature="ET EXPLOIT Modbus TCP Unauthorized Write — From Non-Engineering Source",
                      signature_id="2024700", category="Attempted Admin Privilege Gain",
                      source_ip="10.3.1.10", dest_ip="10.2.1.30", dest_port=502, protocol="tcp",
                      action="blocked", source_type="suricata"),
        SecurityEvent(user_id=user_id, source_id=suricata_src.id, timestamp=NOW - timedelta(hours=5, minutes=29),
                      event_type="alert", severity="critical",
                      signature="ET EXPLOIT CIP Protocol — Unauthorized Program Upload Attempt",
                      signature_id="2024701", category="Attempted Admin Privilege Gain",
                      source_ip="10.3.1.10", dest_ip="10.2.1.10", dest_port=44818, protocol="tcp",
                      action="blocked", source_type="suricata"),

        # Stage 7: Data exfiltration attempt
        SecurityEvent(user_id=user_id, source_id=suricata_src.id, timestamp=NOW - timedelta(hours=5),
                      event_type="alert", severity="high",
                      signature="ET POLICY Large Outbound Data Transfer — Possible Exfiltration",
                      signature_id="2024800", category="Potential Corporate Privacy Violation",
                      source_ip="10.3.1.10", dest_ip="203.0.113.42", dest_port=443, protocol="tcp",
                      action="allowed", bytes_out=75000000, source_type="suricata"),

        # Normal baseline traffic (to show contrast)
        SecurityEvent(user_id=user_id, source_id=zeek_src.id, timestamp=NOW - timedelta(hours=4),
                      event_type="conn", severity="info", category="network_connection",
                      source_ip="10.2.1.10", dest_ip="10.3.1.5", dest_port=44818, protocol="tcp",
                      bytes_in=1024, bytes_out=2048, source_type="zeek"),
        SecurityEvent(user_id=user_id, source_id=zeek_src.id, timestamp=NOW - timedelta(hours=3),
                      event_type="conn", severity="info", category="network_connection",
                      source_ip="10.2.1.20", dest_ip="10.3.1.5", dest_port=102, protocol="tcp",
                      bytes_in=512, bytes_out=1024, source_type="zeek"),
        SecurityEvent(user_id=user_id, source_id=zeek_src.id, timestamp=NOW - timedelta(hours=2),
                      event_type="http", severity="info", category="http_get",
                      source_ip="10.3.1.10", dest_ip="10.3.1.20", dest_port=443, protocol="tcp",
                      hostname="pi-historian.local", url="/api/streams/default", source_type="zeek"),
    ]

    for e in events:
        session.add(e)

    suricata_src.event_count = sum(1 for e in events if e.source_type == "suricata")
    zeek_src.event_count = sum(1 for e in events if e.source_type == "zeek")
    suricata_src.last_event_at = NOW
    zeek_src.last_event_at = NOW

    await session.commit()
    logger.info(f"Created {len(events)} demo security events (attack scenario).")


async def create_demo_case(session: AsyncSession, user_id: int):
    """Create a pre-built AI investigation case from the attack scenario."""
    from backend.models.case import Case, CaseTimeline

    result = await session.execute(select(Case).where(Case.user_id == user_id).limit(1))
    if result.scalar_one_or_none():
        logger.info("Demo case already seeded.")
        return

    case = Case(
        user_id=user_id,
        title="Multi-Stage OT Intrusion: VPN Compromise → Lateral Movement → PLC Access Attempt",
        summary="Attacker brute-forced VPN access from 203.0.113.42, pivoted to engineering workstation via RDP, "
                "accessed historian data via SMB, established C2 beacon to systempatch-cdn.xyz, then attempted "
                "unauthorized Modbus write to M340 PLC and CIP program upload to ControlLogix. PLC attacks were "
                "blocked by firewall rules. Data exfiltration of ~75MB detected.",
        severity="critical",
        status="investigating",
        confidence_score=0.92,
        mitre_tactics=["TA0001", "TA0007", "TA0008", "TA0011", "TA0009", "TA0010", "TA0107"],
        mitre_techniques=[
            {"id": "T1133", "name": "External Remote Services", "confidence": 0.95},
            {"id": "T1110", "name": "Brute Force", "confidence": 0.88},
            {"id": "T1046", "name": "Network Service Discovery", "confidence": 0.90},
            {"id": "T1021.001", "name": "Remote Desktop Protocol", "confidence": 0.92},
            {"id": "T1021.002", "name": "SMB/Windows Admin Shares", "confidence": 0.85},
            {"id": "T1071.004", "name": "DNS (C2)", "confidence": 0.78},
            {"id": "T0855", "name": "Unauthorized Command Message", "confidence": 0.95},
            {"id": "T1041", "name": "Exfiltration Over C2 Channel", "confidence": 0.82},
        ],
        attack_narrative=(
            "A sophisticated multi-stage attack targeting the water treatment plant's OT infrastructure was detected.\n\n"
            "**Stage 1 — Initial Access (T-8h):** The attacker conducted a brute force attack against the SSL VPN "
            "endpoint on the DMZ firewall (10.4.0.1) from external IP 203.0.113.42. After approximately 5 minutes "
            "of attempts, a successful login was observed.\n\n"
            "**Stage 2 — Reconnaissance (T-7.5h):** From an internal IP (10.5.0.50, likely VPN-assigned), the attacker "
            "performed an Nmap SYN scan targeting the SCADA and control networks, probing ports 445, 3389, 102, 502, and 44818.\n\n"
            "**Stage 3 — Lateral Movement (T-6.75h):** RDP session established from 10.5.0.50 to the AVEVA InTouch HMI "
            "workstation (10.3.1.10) in the supervisory zone.\n\n"
            "**Stage 4 — Collection (T-6.3h):** Large SMB data transfer (~50MB) from the PI Historian (10.3.1.20) to "
            "the compromised HMI workstation. Process data and historian archives likely exfiltrated.\n\n"
            "**Stage 5 — C2 Communication (T-6h):** DNS queries to suspicious domain 'update.systempatch-cdn.xyz' "
            "from the compromised HMI. Likely a command-and-control beacon.\n\n"
            "**Stage 6 — OT Attack Attempt (T-5.5h):** CRITICAL — Unauthorized Modbus write command attempted against "
            "the Schneider M340 PLC (10.2.1.30:502) and CIP program upload attempted against the Rockwell ControlLogix "
            "(10.2.1.10:44818). Both were BLOCKED by firewall rules preventing direct HMI-to-PLC traffic without "
            "engineering workstation authorization.\n\n"
            "**Stage 7 — Exfiltration (T-5h):** ~75MB outbound data transfer from the compromised HMI to the "
            "attacker's external IP (203.0.113.42:443) over HTTPS."
        ),
        created_by="agent",
    )
    session.add(case)
    await session.flush()

    # Timeline entries
    timeline = [
        CaseTimeline(case_id=case.id, timestamp=NOW - timedelta(hours=8),
                     entry_type="event", content="VPN brute force detected from 203.0.113.42 → 10.4.0.1:443", source="system"),
        CaseTimeline(case_id=case.id, timestamp=NOW - timedelta(hours=7, minutes=55),
                     entry_type="alert", content="Successful VPN login after multiple failures — credential compromise confirmed", source="system"),
        CaseTimeline(case_id=case.id, timestamp=NOW - timedelta(hours=7, minutes=25),
                     entry_type="alert", content="Nmap SYN scan from 10.5.0.50 targeting SCADA/control subnets", source="system"),
        CaseTimeline(case_id=case.id, timestamp=NOW - timedelta(hours=6, minutes=45),
                     entry_type="event", content="RDP lateral movement: 10.5.0.50 → 10.3.1.10 (HMI workstation)", source="system"),
        CaseTimeline(case_id=case.id, timestamp=NOW - timedelta(hours=6, minutes=20),
                     entry_type="event", content="SMB data collection: 50MB transferred from PI Historian to compromised HMI", source="system"),
        CaseTimeline(case_id=case.id, timestamp=NOW - timedelta(hours=6),
                     entry_type="alert", content="C2 beacon detected: DNS query to update.systempatch-cdn.xyz", source="system"),
        CaseTimeline(case_id=case.id, timestamp=NOW - timedelta(hours=5, minutes=30),
                     entry_type="alert", content="CRITICAL: Unauthorized Modbus write to M340 PLC — BLOCKED by firewall", source="system"),
        CaseTimeline(case_id=case.id, timestamp=NOW - timedelta(hours=5, minutes=29),
                     entry_type="alert", content="CRITICAL: Unauthorized CIP program upload to ControlLogix — BLOCKED", source="system"),
        CaseTimeline(case_id=case.id, timestamp=NOW - timedelta(hours=5),
                     entry_type="alert", content="Data exfiltration: 75MB outbound to attacker IP 203.0.113.42", source="system"),
        CaseTimeline(case_id=case.id, timestamp=NOW - timedelta(hours=4, minutes=50),
                     entry_type="ai_analysis",
                     content="AI Triage Agent correlated 15 events across 7 MITRE ATT&CK techniques into a single multi-stage intrusion case. Confidence: 92%.",
                     source="agent",
                     metadata_json={"confidence": 0.92, "model": "claude-sonnet-4-20250514"}),
        CaseTimeline(case_id=case.id, timestamp=NOW - timedelta(hours=4, minutes=45),
                     entry_type="action",
                     content="Recommended: Revoke VPN session for compromised credentials immediately",
                     source="agent"),
        CaseTimeline(case_id=case.id, timestamp=NOW - timedelta(hours=4, minutes=44),
                     entry_type="action",
                     content="Recommended: Isolate HMI workstation 10.3.1.10 from network",
                     source="agent"),
        CaseTimeline(case_id=case.id, timestamp=NOW - timedelta(hours=4, minutes=43),
                     entry_type="action",
                     content="Recommended: Block external IP 203.0.113.42 at perimeter firewall",
                     source="agent"),
        CaseTimeline(case_id=case.id, timestamp=NOW - timedelta(hours=4, minutes=42),
                     entry_type="action",
                     content="Recommended: Preserve forensic images of HMI workstation and historian logs",
                     source="agent"),
    ]

    for t in timeline:
        session.add(t)

    await session.commit()
    logger.info("Created demo investigation case with attack timeline.")


async def seed_database():
    """Seed complete demo environment."""
    logger.info("Seeding demo database...")
    async with AsyncSessionLocal() as session:
        try:
            user = await create_demo_user(session)
            assets = await create_assets(session, user.id)
            if assets:
                await create_alerts(session, user.id, assets)
            await create_network_sensors(session, user.id)
            await create_discovered_devices(session, user.id)
            await create_network_connections(session, user.id)
            await create_security_events(session, user.id)
            await create_demo_case(session, user.id)
            logger.info("Database seeding complete.")
        except Exception as e:
            logger.error(f"Seeding error: {e}", exc_info=True)
            await session.rollback()
            raise


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(seed_database())
