"""
Alert checker service for matching vulnerabilities with user assets.
Analyzes CVE data and vendor advisories to determine if users are affected.
"""

import asyncio
import logging
from typing import List, Dict, Set
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import re
import os

from backend.database.db import AsyncSessionLocal
from backend.models.user import User
from backend.models.asset import Asset
from backend.models.alert import Alert, Severity, AlertStatus
from backend.models.audit_log import AuditLog
from backend.models.discovered_device import DiscoveredDevice
from backend.services.cve_scraper import cve_scraper
from backend.services.vendor_scraper import vendor_scraper
from backend.services.ics_cert_feed import ics_cert_feed_service
from backend.services.email_alert import email_service
from backend.services.notification_service import notify_all_services
from backend.services.cve_enrichment import CVEEnrichmentService
from backend.services.ot_risk_scorer import ot_risk_scorer
from backend.services.slack_webhook import SlackNotificationService, WebhookNotificationService

logger = logging.getLogger(__name__)

# Notification service instances (read from env)
slack_webhook = os.getenv("SLACK_WEBHOOK_URL")
generic_webhook = os.getenv("GENERIC_WEBHOOK_URL")

slack_service = SlackNotificationService(slack_webhook) if slack_webhook else None
webhook_service = WebhookNotificationService(generic_webhook) if generic_webhook else None

cve_enrichment_service = CVEEnrichmentService()

async def notify_all_services(message: str, user: User = None, **kwargs):
    # Prefer user-specific webhooks if set
    user_slack = getattr(user, 'slack_webhook_url', None)
    user_webhook = getattr(user, 'webhook_url', None)
    slack_url = user_slack or slack_webhook
    webhook_url = user_webhook or generic_webhook
    slack_service = SlackNotificationService(slack_url) if slack_url else None
    webhook_service = WebhookNotificationService(webhook_url) if webhook_url else None
    tasks = []
    if slack_service:
        tasks.append(slack_service.send(message, **kwargs))
    if webhook_service:
        tasks.append(webhook_service.send(message, **kwargs))
    if tasks:
        await asyncio.gather(*tasks)


class AlertChecker:
    """Service for checking vulnerabilities against user assets and creating alerts."""
    
    def __init__(self):
        self.processed_cves: Set[str] = set()
        self.processed_advisories: Set[str] = set()
    
    async def check_new_vulnerabilities(self):
        """Main method to check for new vulnerabilities and create alerts."""
        logger.info("Starting vulnerability check...")
        
        try:
            # Fetch new CVEs and vendor advisories
            cves_data = await cve_scraper.fetch_recent_cves(hours_back=6)
            vendor_advisories_data = await vendor_scraper.fetch_all_vendor_advisories(days_back=1)
            
            # Ensure data is iterable (list)
            cves = list(cves_data) if cves_data else []
            vendor_advisories = list(vendor_advisories_data) if vendor_advisories_data else []
            
            # NEW: Fetch ICS-specific advisories
            ics_advisories_data = await ics_cert_feed_service.fetch_cisa_kev()
            ics_advisories = [ics_cert_feed_service.advisory_to_dict(adv) for adv in ics_advisories_data]
            
            logger.info(f"Fetched {len(cves)} CVEs, {len(vendor_advisories)} vendor advisories, {len(ics_advisories)} ICS advisories")
            
            # Process CVEs
            await self._process_cves(cves)
            
            # Process vendor advisories
            await self._process_vendor_advisories(vendor_advisories)
            
            # NEW: Process ICS advisories
            await self._process_ics_advisories(ics_advisories)
            
            logger.info("Vulnerability check completed")
            
        except Exception as e:
            logger.error(f"Error during vulnerability check: {e}")
    
    async def _process_cves(self, cves: List[Dict]):
        """Process CVE data and create alerts for affected users."""
        new_cves = [cve for cve in cves if cve.get('cve_id') not in self.processed_cves]
        
        if not new_cves:
            logger.info("No new CVEs to process")
            return
        
        logger.info(f"Processing {len(new_cves)} new CVEs")
        
        async with AsyncSessionLocal() as db:
            # Get all users and their assets
            result = await db.execute(
                select(User, Asset).join(Asset, User.id == Asset.user_id)
                .where(User.is_active == True)
            )
            user_assets = result.all()
            
            for cve in new_cves:
                affected_combinations = await self._find_affected_assets(cve, user_assets)
                
                for user, asset in affected_combinations:
                    await self._create_alert_from_cve(db, user, asset, cve)
                
                # Mark CVE as processed
                self.processed_cves.add(cve.get('cve_id', ''))
            
            await db.commit()
    
    async def _process_vendor_advisories(self, advisories: List[Dict]):
        """Process vendor advisories and create alerts for affected users."""
        new_advisories = [
            adv for adv in advisories 
            if adv.get('vendor_advisory_id') not in self.processed_advisories
        ]
        
        if not new_advisories:
            logger.info("No new vendor advisories to process")
            return
        
        logger.info(f"Processing {len(new_advisories)} new vendor advisories")
        
        async with AsyncSessionLocal() as db:
            # Get all users and their assets
            result = await db.execute(
                select(User, Asset).join(Asset, User.id == Asset.user_id)
                .where(User.is_active == True)
            )
            user_assets = result.all()
            
            for advisory in new_advisories:
                affected_combinations = await self._find_affected_assets_by_vendor(
                    advisory, user_assets
                )
                
                for user, asset in affected_combinations:
                    await self._create_alert_from_advisory(db, user, asset, advisory)
                
                # Mark advisory as processed
                self.processed_advisories.add(advisory.get('vendor_advisory_id', ''))
            
            await db.commit()
    
    async def _find_affected_assets(self, cve: Dict, user_assets: List) -> List:
        """Find user assets affected by a CVE."""
        affected = []
        cve_cpes = cve.get('affected_cpes', [])
        
        if not cve_cpes:
            return affected
        
        for user, asset in user_assets:
            if await self._is_asset_affected_by_cve(asset, cve_cpes, cve):
                affected.append((user, asset))
        
        return affected
    
    async def _find_affected_assets_by_vendor(self, advisory: Dict, user_assets: List) -> List:
        """Find user assets affected by a vendor advisory."""
        affected = []
        vendor = advisory.get('vendor', '').lower()
        
        for user, asset in user_assets:
            if await self._is_asset_affected_by_vendor_advisory(asset, advisory):
                affected.append((user, asset))
        
        return affected
    
    async def _is_asset_affected_by_cve(self, asset: Asset, cve_cpes: List[str], cve: Dict) -> bool:
        """Check if an asset is affected by a CVE based on CPE matching."""
        # Direct CPE match
        if asset.cpe_string and asset.cpe_string in cve_cpes:
            return True
        
        # Fuzzy matching based on vendor/product/version
        if not (asset.vendor and asset.product):
            return False
        
        asset_vendor = asset.vendor.lower()
        asset_product = asset.product.lower()
        asset_version = asset.version.lower() if asset.version else ""
        
        for cpe in cve_cpes:
            cpe_parts = cpe.split(':')
            if len(cpe_parts) >= 5:
                cpe_vendor = cpe_parts[3].lower()
                cpe_product = cpe_parts[4].lower()
                cpe_version = cpe_parts[5].lower() if len(cpe_parts) > 5 else ""
                
                # Check vendor and product match
                if (self._fuzzy_match(asset_vendor, cpe_vendor) and 
                    self._fuzzy_match(asset_product, cpe_product)):
                    
                    # If no version specified in asset or CPE, consider it a match
                    if not asset_version or not cpe_version or cpe_version == "*":
                        return True
                    
                    # Version matching (simplified - would need more sophisticated logic)
                    if asset_version == cpe_version:
                        return True
        
        return False
    
    async def _is_asset_affected_by_vendor_advisory(self, asset: Asset, advisory: Dict) -> bool:
        """Check if an asset is affected by a vendor advisory."""
        advisory_vendor = advisory.get('vendor', '').lower()
        
        if not asset.vendor:
            return False
        
        # Simple vendor matching
        return self._fuzzy_match(asset.vendor.lower(), advisory_vendor)
    
    def _fuzzy_match(self, text1: str, text2: str) -> bool:
        """Simple fuzzy matching for vendor/product names."""
        # Remove common variations and normalize
        normalize = lambda x: re.sub(r'[^a-z0-9]', '', x.lower())
        norm1, norm2 = normalize(text1), normalize(text2)
        
        # Exact match
        if norm1 == norm2:
            return True
        
        # Substring match
        if norm1 in norm2 or norm2 in norm1:
            return True
        
        # Common vendor name variations
        vendor_aliases = {
            'microsoft': ['msft', 'ms'],
            'cisco': ['csco'],
            'fortinet': ['forti'],
            'apache': ['apache software foundation'],
        }
        
        for main_vendor, aliases in vendor_aliases.items():
            if ((norm1 == main_vendor and norm2 in aliases) or
                (norm2 == main_vendor and norm1 in aliases)):
                return True
        
        return False
    
    async def _create_alert_from_cve(self, db: AsyncSession, user: User, asset: Asset, cve: Dict):
        """Create an alert from CVE data."""
        try:
            # Enrich CVE data
            enrichment = await cve_enrichment_service.enrich_cve(cve.get('cve_id'))
            cve.update(enrichment)
            
            # Check if alert already exists
            existing = await db.execute(
                select(Alert).where(
                    Alert.user_id == user.id,
                    Alert.asset_id == asset.id,
                    Alert.cve_id == cve.get('cve_id')
                )
            )
            
            if existing.scalar_one_or_none():
                return  # Alert already exists
            
            alert = Alert(
                user_id=user.id,
                asset_id=asset.id,
                cve_id=cve.get('cve_id'),
                title=cve.get('title', 'Unknown CVE'),
                description=cve.get('description', ''),
                severity=cve.get('severity', 'unknown'),
                cvss_score=cve.get('cvss_score'),
                exploitability=cve.get('exploitability'),
                remediation=cve.get('remediation'),
                source_url=cve.get('source_url'),
                status=AlertStatus.PENDING
            )
            
            db.add(alert)
            await db.flush()  # Get the ID
            
            # Send email alert
            await email_service.send_vulnerability_alert(user, asset, alert, cve)
            
            # Send notifications
            await notify_all_services(f"New CVE alert for {user.email}: {alert.title}", alert_id=alert.id, cve_id=alert.cve_id)
            
            logger.info(f"Created CVE alert {cve.get('cve_id')} for user {user.email}")
            
            # Log audit trail
            await self.log_audit(db, user.id, action="create_alert", target_type="CVE", target_id=cve.get('cve_id'), detail=str(alert))
            
        except Exception as e:
            logger.error(f"Error creating CVE alert: {e}")
    
    async def _create_alert_from_advisory(self, db: AsyncSession, user: User, asset: Asset, advisory: Dict):
        """Create an alert from vendor advisory data."""
        try:
            # Check if alert already exists
            existing = await db.execute(
                select(Alert).where(
                    Alert.user_id == user.id,
                    Alert.asset_id == asset.id,
                    Alert.vendor_advisory_id == advisory.get('vendor_advisory_id')
                )
            )
            
            if existing.scalar_one_or_none():
                return  # Alert already exists
            
            alert = Alert(
                user_id=user.id,
                asset_id=asset.id,
                vendor_advisory_id=advisory.get('vendor_advisory_id'),
                title=advisory.get('title', 'Unknown Advisory'),
                description=advisory.get('description', ''),
                severity=advisory.get('severity', 'unknown'),
                source_url=advisory.get('source_url'),
                status=AlertStatus.PENDING
            )
            
            db.add(alert)
            await db.flush()  # Get the ID
            
            # Send email alert
            await email_service.send_vendor_advisory_alert(user, asset, alert, advisory)
            
            # Send notifications
            await notify_all_services(f"New vendor alert for {user.email}: {alert.title}", alert_id=alert.id, vendor_advisory_id=alert.vendor_advisory_id)
            
            logger.info(f"Created vendor alert {advisory.get('vendor_advisory_id')} for user {user.email}")
            
            # Log audit trail
            await self.log_audit(db, user.id, action="create_alert", target_type="Vendor Advisory", target_id=advisory.get('vendor_advisory_id'), detail=str(alert))
            
        except Exception as e:
            logger.error(f"Error creating vendor advisory alert: {e}")
    
    async def log_audit(self, db: AsyncSession, user_id: int, action: str, target_type: str = None, target_id: str = None, detail: str = None):
        """Log an audit trail entry."""
        try:
            audit = AuditLog(user_id=user_id, action=action, target_type=target_type, target_id=target_id, detail=detail)
            db.add(audit)
            await db.commit()
            logger.info(f"Logged audit trail: {action} by user {user_id} on {target_type} {target_id}")
        except Exception as e:
            logger.error(f"Error logging audit trail: {e}")
    
    async def _process_ics_advisories(self, ics_advisories: List[Dict]):
        """Process ICS-specific advisories and create alerts for affected OT assets."""
        new_advisories = [
            adv for adv in ics_advisories 
            if adv.get('advisory_id') not in self.processed_advisories
        ]
        
        if not new_advisories:
            logger.info("No new ICS advisories to process")
            return
        
        logger.info(f"Processing {len(new_advisories)} new ICS advisories")
        
        async with AsyncSessionLocal() as db:
            # Get all users and their OT assets + discovered devices
            result = await db.execute(
                select(User, Asset)\
                .join(Asset, User.id == Asset.user_id, isouter=True)\
                .where(User.is_active == True, Asset.is_ot_asset == True)
            )
            user_assets = result.all()
            
            for advisory in new_advisories:
                try:
                    # Check affected OT assets
                    affected_combinations = await self._find_ot_assets_affected_by_advisory(
                        advisory, user_assets, db
                    )
                    
                    for user, asset in affected_combinations:
                        await self._create_alert_from_ics_advisory(db, user, asset, advisory)
                    
                    # Mark advisory as processed
                    self.processed_advisories.add(advisory.get('advisory_id', ''))
                    
                except Exception as e:
                    logger.error(f"Error processing ICS advisory {advisory.get('advisory_id')}: {e}")
            
            await db.commit()
    
    async def _find_ot_assets_affected_by_advisory(
        self, 
        advisory: Dict, 
        user_assets: List, 
        db: AsyncSession
    ) -> List:
        """Find OT assets affected by an ICS advisory."""
        affected = []
        
        affected_products = advisory.get('affected_products', [])
        cves = advisory.get('cves', [])
        
        if not affected_products and not cves:
            return affected
        
        for user, asset in user_assets:
            if asset is None:
                continue
            
            # Match by vendor/product info
            for prod in affected_products:
                vendor = prod.get('vendor', '').lower()
                product = prod.get('product', '').lower()
                versions = prod.get('versions', [])
                
                if asset.vendor and asset.product:
                    if (self._fuzzy_match(asset.vendor.lower(), vendor) and 
                        self._fuzzy_match(asset.product.lower(), product)):
                        
                        # Version check (simplified)
                        if not versions or not asset.version:
                            affected.append((user, asset))
                        elif await self._is_version_vulnerable(asset.version, versions):
                            affected.append((user, asset))
        
        return affected
    
    async def _is_version_vulnerable(self, asset_version: str, vulnerability_versions: List[str]) -> bool:
        """Check if asset version falls in vulnerability version range."""
        # Simplified: assume versions like "< 4.5.0" means vulnerable before 4.5.0
        try:
            # Parse asset version
            asset_parts = [int(p) for p in asset_version.split(".")[:3]]
            
            for vuln_version_spec in vulnerability_versions:
                if "<" in vuln_version_spec:
                    vuln_version = vuln_version_spec.replace("<", "").strip()
                    vuln_parts = [int(p) for p in vuln_version.split(".")[:3]]
                    
                    # Compare tuples
                    if tuple(asset_parts) < tuple(vuln_parts):
                        return True
        except:
            pass
        
        return False
    
    async def _create_alert_from_ics_advisory(self, db: AsyncSession, user: User, asset: Asset, advisory: Dict):
        """Create an alert from ICS advisory data."""
        try:
            advisory_id = advisory.get('advisory_id')
            
            # Check if alert already exists
            existing = await db.execute(
                select(Alert).where(
                    Alert.user_id == user.id,
                    Alert.asset_id == asset.id,
                    Alert.vendor_advisory_id == advisory_id
                )
            )
            
            if existing.scalar_one_or_none():
                return  # Alert already exists
            
            # Map severity
            severity_map = {"critical": Severity.CRITICAL, "high": Severity.HIGH, 
                          "medium": Severity.MEDIUM, "low": Severity.LOW}
            severity = severity_map.get(advisory.get('severity', 'medium'), Severity.MEDIUM)
            
            alert = Alert(
                user_id=user.id,
                asset_id=asset.id,
                vendor_advisory_id=advisory_id,
                title=f"ICS Advisory: {advisory.get('title', 'Unknown')}",
                description=advisory.get('description', ''),
                severity=severity,
                remediation=advisory.get('remediation'),
                source_url=advisory.get('source_url'),
                status=AlertStatus.PENDING
            )
            
            db.add(alert)
            await db.flush()  # Get the ID
            
            # For CISA KEV (known exploited), increase urgency
            if advisory.get('cisa_kev') or advisory.get('known_exploited'):
                alert_message = f"🚨 CRITICAL ICS ADVISORY (ACTIVELY EXPLOITED) for {user.email}: {alert.title}"
            else:
                alert_message = f"⚠️ ICS Advisory for {user.email}: {alert.title}"
            
            # Send notifications
            await notify_all_services(alert_message, alert_id=alert.id, advisory_id=alert.vendor_advisory_id)
            
            logger.info(f"Created ICS alert {advisory_id} for user {user.email}")
            
            # Log audit trail
            await self.log_audit(db, user.id, action="create_alert", target_type="ICS Advisory", 
                               target_id=advisory_id, detail=str(alert))
            
        except Exception as e:
            logger.error(f"Error creating ICS advisory alert: {e}")


# Global alert checker instance
alert_checker = AlertChecker()