"""
OT/ICS Risk scoring engine for industrial assets.

Calculates risk scores based on:
1. Vulnerability factors (CVE/advisory presence, CVSS, exploit availability)
2. Asset criticality (network zone, device type, production impact)
3. Exposure factors (protocols, services, access controls)
4. Operational factors (patch management, monitoring, segmentation)

Formula:
    Risk = (Vulnerability Score × Vulnerability Weight) +
            (Exposure Score × Exposure Weight) +
            (Criticality Factor × Criticality Weight)

Scoring designed for industrial environments where:
- Legacy > 10 years without updates (common in SCADA)
- Downtime is prohibitively expensive
- Segmentation reduces risk significantly
- Some legacy protocols have no encryption by design
"""

import logging
from typing import List, Dict, Optional, Tuple
from datetime import datetime, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from backend.models.asset import Asset
from backend.models.discovered_device import DiscoveredDevice
from backend.models.alert import Alert, Severity

logger = logging.getLogger(__name__)


class OTRiskScorer:
    """Industrial OT/ICS asset risk scoring engine."""
    
    # Risk weights (must sum to 1.0)
    WEIGHTS = {
        "vulnerability": 0.40,  # 40% - CVEs, exploits, advisories
        "exposure": 0.35,       # 35% - Services, protocols, access
        "criticality": 0.25     # 25% - Business impact, zone classification
    }
    
    # Zone criticality multipliers (Purdue model)
    ZONE_CRITICALITY = {
        "field": 1.0,           # Sensors/actuators - moderate risk
        "control": 1.5,         # PLCs/RTUs - higher risk if compromised
        "supervisory": 2.0,     # SCADA/MES - critical
        "safety_system": 3.0,   # SIS/ESD - highest criticality
        "dmz": 0.5,            # DMZ - lower risk due to isolation
        "it": 0.3              # Enterprise IT - lowest risk for ICS
    }
    
    # Device type risk profiles
    DEVICE_RISK_PROFILES = {
        "plc": 2.0,            # High - core process control
        "hmi": 1.8,            # High - operator interface
        "rtu": 2.0,            # High - field data aggregation
        "ied": 1.5,            # Moderate - electrical intelligence
        "scada_server": 2.5,   # Very High - system central
        "historian": 1.3,      # Moderate - data collection
        "engineering_workstation": 1.2,  # Low-Moderate
        "safety_system": 3.0   # Extreme - safety critical
    }
    
    # Protocol security level (0-1, lower = less secure)
    PROTOCOL_SECURITY = {
        "modbus": 0.0,          # No auth, no encryption
        "profibus": 0.1,        # Minimal security
        "dnp3": 0.2,           # Minimal, some auth
        "ethernet_ip": 0.3,    # Some segmentation support
        "profinet": 0.4,       # Better security in newer versions
        "opc_ua": 0.7,         # Strong encryption & auth
        "https": 0.9,          # Encrypted
        "vpn": 0.95,           # Encrypted tunnel
        "http": 0.1,           # Clear text
        "ssh": 0.8,            # Encrypted remote access
        "telnet": 0.0          # Clear text remote access
    }
    
    # Dangerous port/service combinations for OT
    DANGEROUS_PATTERNS = {
        "telnet": {"risk": 25, "reason": "Unencrypted remote access"},
        "ssh_ot": {"risk": 10, "reason": "SSH on OT device (unusual, may indicate misconfiguration)"},
        "modbus_internet": {"risk": 30, "reason": "Modbus exposed to untrusted network"},
        "plc_unmanaged": {"risk": 20, "reason": "PLC with no configuration management"},
        "no_network_segmentation": {"risk": 25, "reason": "OT on same network as IT"},
        "default_credentials": {"risk": 35, "reason": "Device may have default credentials"}
    }
    
    async def score_managed_asset(
        self, 
        asset: Asset, 
        alerts: List[Alert],
        db: AsyncSession
    ) -> Tuple[float, Dict[str, str]]:
        """
        Calculate risk score for a managed asset.
        
        Returns:
            (risk_score: 0-100, risk_breakdown: dict of factors)
        """
        
        score_breakdown = {}
        
        # Component 1: Vulnerability Score (0-100)
        vuln_score = await self._calculate_vulnerability_score(asset, alerts, db)
        score_breakdown["vulnerability_score"] = f"{vuln_score:.1f}"
        
        # Component 2: Exposure Score (0-100)
        exposure_score = self._calculate_exposure_score(asset)
        score_breakdown["exposure_score"] = f"{exposure_score:.1f}"
        
        # Component 3: Criticality Score (0-100)
        criticality_score = self._calculate_criticality_score(asset)
        score_breakdown["criticality_score"] = f"{criticality_score:.1f}"
        
        # Weighted combination
        total_risk = (
            vuln_score * self.WEIGHTS["vulnerability"] +
            exposure_score * self.WEIGHTS["exposure"] +
            criticality_score * self.WEIGHTS["criticality"]
        )
        
        # Cap at 100
        total_risk = min(total_risk, 100.0)
        
        score_breakdown["total_risk"] = f"{total_risk:.1f}"
        logger.debug(f"Asset {asset.id} risk breakdown: {score_breakdown}")
        
        return total_risk, score_breakdown
    
    async def score_discovered_device(
        self,
        device: DiscoveredDevice
    ) -> Tuple[float, Dict[str, str]]:
        """
        Score a discovered device (no asset correlation yet).
        Uses fingerprint data and limited vulnerability info.
        """
        
        score_breakdown = {}
        
        # For discovered devices, score is mostly exposure + device risk profile
        exposure_score = self._calculate_exposure_score_from_device(device)
        score_breakdown["exposure_score"] = f"{exposure_score:.1f}"
        
        # Device profile risk
        device_risk = self._get_device_profile_risk(device)
        score_breakdown["device_risk"] = f"{device_risk:.1f}"
        
        # Combined scoring (discovered devices have higher baseline uncertainty)
        total_risk = (exposure_score * 0.6) + (device_risk * 0.4)
        total_risk = min(total_risk, 100.0)
        
        score_breakdown["total_risk"] = f"{total_risk:.1f}"
        return total_risk, score_breakdown
    
    # ======================================================================
    # VULNERABILITY SCORING
    # ======================================================================
    
    async def _calculate_vulnerability_score(
        self,
        asset: Asset,
        alerts: List[Alert],
        db: AsyncSession
    ) -> float:
        """
        Score based on:
        - Number of critical/high CVEs
        - CVSS scores of known CVEs
        - Exploit availability (CISA KEV status)
        - Age of vulnerabilities (unpatched time)
        """
        
        score = 0.0
        
        if not alerts:
            return 0.0
        
        # Count by severity
        critical_count = len([a for a in alerts if a.severity == Severity.CRITICAL])
        high_count = len([a for a in alerts if a.severity == Severity.HIGH])
        medium_count = len([a for a in alerts if a.severity == Severity.MEDIUM])
        
        # Accumulate score
        score += critical_count * 25  # Each critical = 25 points
        score += high_count * 15      # Each high = 15 points
        score += medium_count * 5     # Each medium = 5 points
        
        # CVSS adjustment
        avg_cvss = sum([a.cvss_score or 0 for a in alerts]) / len(alerts) if alerts else 0
        if avg_cvss >= 9.0:
            score *= 1.2  # Boost for very high CVSS
        elif avg_cvss < 7.0:
            score *= 0.8  # Reduce for moderate CVSS
        
        # Exploit age penalty (unpatched > 30 days = higher risk)
        old_count = len([a for a in alerts if a.created_at < datetime.utcnow() - timedelta(days=30)])
        score += old_count * 10  # Each unpatched 30+ days = +10 points
        
        # Cap at 100
        return min(score, 100.0)
    
    # ======================================================================
    # EXPOSURE SCORING
    # ======================================================================
    
    def _calculate_exposure_score(self, asset: Asset) -> float:
        """
        Score based on:
        - Network zone (exposed to untrusted networks?)
        - Communication protocols (encrypted? authenticated?)
        - Services exposed
        - Segmentation/access controls
        """
        
        score = 0.0
        
        if not asset.is_ot_asset:
            return 0.0  # Non-OT assets have different risk model
        
        # Factor 1: Network Zone exposure (0-40 points)
        zone_exposure = {
            "field": 10,           # Filed sensors - limited exposure
            "control": 25,         # Control network - moderate exposure
            "supervisory": 35,     # Supervisory - higher exposure
            "safety_system": 40,   # Safety - critical exposure
            "dmz": 20,            # DMZ - moderate exposure
            "it": 15              # IT network - lower isolation
        }
        score += zone_exposure.get(asset.network_zone or "unknown", 20)
        
        # Factor 2: Protocol security (0-30 points)
        if asset.primary_protocol:
            security = self.PROTOCOL_SECURITY.get(asset.primary_protocol.lower(), 0.5)
            score += (1.0 - security) * 30  # Higher risk = lower security
        
        # Factor 3: Additional exposure risks
        if asset.last_known_ip:
            # If IP is known and routable, higher exposure
            if self._is_likely_upstream_ip(asset.last_known_ip):
                score += 15  # Upstream/corporate network = higher exposure
        
        return min(score, 100.0)
    
    def _calculate_exposure_score_from_device(self, device: DiscoveredDevice) -> float:
        """Same as above but for discovered device."""
        
        score = 0.0
        
        if not device.is_ot_device:
            return 0.0
        
        # Base risk from IP address
        if device.ip_address:
            score += 15
        
        # Services risk
        if device.services_detected:
            dangerous_services = ["telnet", "ftp", "http"]
            for svc in device.services_detected:
                if svc.lower() in dangerous_services:
                    score += 15
        
        # Protocols risk
        if device.industrial_protocols:
            for proto in device.industrial_protocols:
                if proto.lower() in ["modbus", "dnp3"]:
                    score += 20
        
        return min(score, 100.0)
    
    # ======================================================================
    # CRITICALITY SCORING
    # ======================================================================
    
    def _calculate_criticality_score(self, asset: Asset) -> float:
        """
        Score based on:
        - Device type (PLC > HMI > Historian)
        - Network zone (SCADA > control > field)
        - User-assigned criticality label
        - Historical importance
        """
        
        if not asset.is_ot_asset:
            return 0.0
        
        score = 0.0
        
        # Device type criticality (base score 0-70)
        device_type = asset.asset_type if isinstance(asset.asset_type, str) else str(asset.asset_type)
        multiplier = self.DEVICE_RISK_PROFILES.get(device_type, 1.0)
        score += multiplier * 25  # Scale to 0-70
        
        # Zone criticality bonus (0-20)
        zone = asset.network_zone or "unknown"
        zone_multiplier = self.ZONE_CRITICALITY.get(zone, 1.0)
        score += (zone_multiplier - 1.0) * 10  # Bonus relative to baseline
        
        # User-assigned criticality (0-10)
        criticality_map = {"low": 5, "medium": 30, "high": 70, "critical": 100}
        if asset.criticality:
            score = max(score, criticality_map.get(asset.criticality, score))
        
        return min(score, 100.0)
    
    def _get_device_profile_risk(self, device: DiscoveredDevice) -> float:
        """Get base risk from device profile."""
        
        risk = 30.0  # Baseline for unknown devices
        
        if device.ot_device_type:
            risk = self.DEVICE_RISK_PROFILES.get(device.ot_device_type, 30.0) * 15
        
        # Boost if fingerprint shows known issues
        if device.risk_factors:
            risk += len(device.risk_factors) * 5
        
        return min(risk, 100.0)
    
    # ======================================================================
    # HELPERS
    # ======================================================================
    
    def _is_likely_upstream_ip(self, ip_address: str) -> bool:
        """Heuristic: is IP in corporate/upstream networks?"""
        # Simplified - in production would use customer's network config
        try:
            parts = ip_address.split(".")
            first_octet = int(parts[0])
            second_octet = int(parts[1])
            
            # Assume 10.0-10.19 = production OT, 10.20+ = corporate/edge
            if first_octet == 10 and second_octet >= 20:
                return True
            
            # 172.16-172.31 corporate, other subnets less likely
            if first_octet == 172 and 16 <= second_octet <= 31:
                return True
            
        except:
            pass
        
        return False


# Global scorer instance
ot_risk_scorer = OTRiskScorer()
