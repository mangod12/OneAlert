"""
Alert checker service for matching vulnerabilities with user assets.
Analyzes CVE data and vendor advisories to determine if users are affected.
"""

import asyncio
import logging
import os
import re
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.db import AsyncSessionLocal
from backend.models.alert import Alert, AlertStatus, Severity
from backend.models.asset import Asset
from backend.models.audit_log import AuditLog
from backend.models.case import Case, CaseAlert
from backend.models.notification import Notification
from backend.models.security_event import SecurityEvent as _SecurityEvent  # noqa: F401  (Case mapper dependency)
from backend.models.suppression_rule import AlertSuppressionRule, rule_matches
from backend.models.user import User
from backend.services.cve_enrichment import CVEEnrichmentService
from backend.services.cve_scraper import cve_scraper
from backend.services.email_alert import email_service
from backend.services.ics_cert_feed import ics_cert_feed_service
from backend.services.investigation_notify import notify_investigation_event
from backend.services.notification_prefs import (
    SEVERITY_RANK as _SEVERITY_RANK,
)
from backend.services.notification_prefs import (
    should_email_user as _should_email_user,
)
from backend.services.sla import sla_due_date
from backend.services.slack_webhook import SlackNotificationService, WebhookNotificationService
from backend.services.vendor_scraper import vendor_scraper

logger = logging.getLogger(__name__)





def _severity_name(severity) -> str:
    return severity.value if hasattr(severity, "value") else str(severity or "").lower()


async def _maybe_auto_escalate(db: AsyncSession, user: User, asset: Asset) -> None:
    """Open an investigation when an incident crosses the user's auto-escalation threshold."""
    if not getattr(user, "auto_escalate_incidents", False):
        return
    alerts = (await db.execute(
        select(Alert).where(
            Alert.user_id == user.id,
            Alert.asset_id == asset.id,
            Alert.status.in_((AlertStatus.PENDING, AlertStatus.SENT, AlertStatus.ACKNOWLEDGED)),
        )
    )).scalars().all()
    min_alerts = getattr(user, "auto_escalate_min_alerts", None) or 3
    if len(alerts) < min_alerts:
        return
    max_severity = max((_severity_name(a.severity) for a in alerts), key=lambda s: _SEVERITY_RANK.get(s, -1))
    min_severity = getattr(user, "auto_escalate_min_severity", None) or "high"
    if _SEVERITY_RANK.get(max_severity, -1) < _SEVERITY_RANK.get(min_severity, 2):
        return

    # Skip when an open investigation already covers one of these alerts.
    alert_ids = [a.id for a in alerts]
    existing = (await db.execute(
        select(Case)
        .join(CaseAlert, CaseAlert.case_id == Case.id)
        .where(
            Case.user_id == user.id,
            CaseAlert.alert_id.in_(alert_ids),
            Case.status.in_(("open", "investigating")),
        )
    )).scalars().first()
    if existing:
        return

    case = Case(
        user_id=user.id,
        title=f"Incident on {asset.name}",
        summary=(
            f"Auto-escalated: {len(alerts)} active alerts on {asset.name} crossed the "
            f"{min_severity}+ threshold. Highest severity: {max_severity}."
        ),
        severity=max_severity,
        status="open",
        due_date=sla_due_date(user, max_severity),
    )
    db.add(case)
    await db.flush()
    for alert in alerts:
        db.add(CaseAlert(case_id=case.id, alert_id=alert.id))
    db.add(Notification(
        user_id=user.id,
        kind="incident_escalated",
        title=f"Incident auto-escalated on {asset.name}",
        body=f"{len(alerts)} active alerts crossed your threshold. Investigation {case.id} opened.",
        link=f"/app/cases/{case.id}",
    ))
    db.add(AuditLog(
        user_id=user.id, action="incident_auto_escalated", target_type="case", target_id=case.id,
        detail=f"Incident on {asset.name} auto-escalated to case {case.id} ({len(alerts)} alerts)",
    ))
    logger.info(f"Auto-escalated incident on asset {asset.id} to case {case.id} for user {user.email}")
    await notify_investigation_event(
        user,
        kind="incident_escalated",
        severity=max_severity,
        title=f"Incident auto-escalated on {asset.name}",
        body=(
            f"{len(alerts)} active alerts crossed your threshold. "
            f"Investigation #{case.id} opened. Highest severity: {max_severity}."
        ),
        link_path=f"/app/cases/{case.id}",
    )


async def _notify_incident_formed(db: AsyncSession, user: User, asset: Asset) -> None:
    """Notify once when an asset crosses into incident territory (2nd active alert)."""
    count = (await db.execute(
        select(func.count()).select_from(Alert).where(
            Alert.user_id == user.id,
            Alert.asset_id == asset.id,
            Alert.status.in_((AlertStatus.PENDING, AlertStatus.SENT, AlertStatus.ACKNOWLEDGED)),
        )
    )).scalar_one()
    if count == 2:
        db.add(Notification(
            user_id=user.id,
            kind="incident_formed",
            title=f"Incident forming on {asset.name}",
            body="2 active alerts now hit this asset. Review the correlated incident.",
            link="/app/incidents",
        ))



async def _apply_suppression_rules(db: AsyncSession, user: User, alert: Alert) -> None:
    """Snooze a freshly created alert when an enabled suppression rule matches it."""
    rules = (await db.execute(
        select(AlertSuppressionRule).where(
            AlertSuppressionRule.user_id == user.id,
            AlertSuppressionRule.enabled.is_(True),
        )
    )).scalars().all()
    if not rules:
        return
    severity = alert.severity
    severity = severity.value if hasattr(severity, "value") else (str(severity) if severity else None)
    for rule in rules:
        if rule_matches(rule, cve_id=alert.cve_id, asset_id=alert.asset_id, severity=severity, title=alert.title):
            alert.snoozed_until = datetime.now(UTC) + timedelta(hours=rule.duration_hours)
            db.add(AuditLog(
                user_id=user.id, action="alert_suppressed", target_type="alert", target_id=alert.id,
                detail=f"Snoozed for {rule.duration_hours}h by suppression rule '{rule.name}'",
            ))
            return  # first matching rule wins


# Notification service instances (read from env)
_default_slack_webhook = os.getenv("SLACK_WEBHOOK_URL")
_default_generic_webhook = os.getenv("GENERIC_WEBHOOK_URL")

cve_enrichment_service = CVEEnrichmentService()


async def _notify_all_services(message: str, user: User = None, **kwargs):
    # Prefer user-specific webhooks if set
    user_slack = getattr(user, 'slack_webhook_url', None)
    user_webhook = getattr(user, 'webhook_url', None)
    slack_url = user_slack or _default_slack_webhook
    webhook_url = user_webhook or _default_generic_webhook
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
        self.processed_cves: set[str] = set()
        self.processed_advisories: set[str] = set()

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

            logger.info(
                f"Fetched {len(cves)} CVEs, {len(vendor_advisories)} vendor advisories, "
                f"{len(ics_advisories)} ICS advisories",
            )

            # Process CVEs
            await self._process_cves(cves)

            # Process vendor advisories
            await self._process_vendor_advisories(vendor_advisories)

            # NEW: Process ICS advisories
            await self._process_ics_advisories(ics_advisories)

            logger.info("Vulnerability check completed")

        except Exception as e:
            logger.error(f"Error during vulnerability check: {e}")

    async def _process_cves(self, cves: list[dict]):
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
                .where(User.is_active.is_(True))
            )
            user_assets = result.all()

            for cve in new_cves:
                affected_combinations = await self._find_affected_assets(cve, user_assets)

                for user, asset in affected_combinations:
                    await self._create_alert_from_cve(db, user, asset, cve)

                # Mark CVE as processed
                self.processed_cves.add(cve.get('cve_id', ''))

            await db.commit()

    async def _process_vendor_advisories(self, advisories: list[dict]):
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
                .where(User.is_active.is_(True))
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

    async def _find_affected_assets(self, cve: dict, user_assets: list) -> list:
        """Find user assets affected by a CVE."""
        affected = []
        cve_cpes = cve.get('affected_cpes', [])

        if not cve_cpes:
            return affected

        for user, asset in user_assets:
            if await self._is_asset_affected_by_cve(asset, cve_cpes, cve):
                affected.append((user, asset))

        return affected

    async def _find_affected_assets_by_vendor(self, advisory: dict, user_assets: list) -> list:
        """Find user assets affected by a vendor advisory."""
        affected = []

        for user, asset in user_assets:
            if await self._is_asset_affected_by_vendor_advisory(asset, advisory):
                affected.append((user, asset))

        return affected

    async def _is_asset_affected_by_cve(self, asset: Asset, cve_cpes: list[str], cve: dict) -> bool:
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

    async def _is_asset_affected_by_vendor_advisory(self, asset: Asset, advisory: dict) -> bool:
        """Check if an asset is affected by a vendor advisory."""
        advisory_vendor = advisory.get('vendor', '').lower()

        if not asset.vendor:
            return False

        # Simple vendor matching
        return self._fuzzy_match(asset.vendor.lower(), advisory_vendor)

    def _fuzzy_match(self, text1: str, text2: str) -> bool:
        """Simple fuzzy matching for vendor/product names."""
        # Remove common variations and normalize
        def normalize(x: str) -> str:
            return re.sub(r'[^a-z0-9]', '', x.lower())
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

    async def _create_alert_from_cve(self, db: AsyncSession, user: User, asset: Asset, cve: dict):
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
                status=AlertStatus.PENDING,
                due_date=sla_due_date(user, cve.get('severity', 'unknown')),
            )

            db.add(alert)
            await db.flush()  # Get the ID
            await _apply_suppression_rules(db, user, alert)
            await _notify_incident_formed(db, user, asset)
            await _maybe_auto_escalate(db, user, asset)

            db.add(Notification(
                user_id=user.id,
                kind="alert_created",
                title=f"New {cve.get('severity', 'unknown')} alert on {asset.name}",
                body=alert.title,
                link="/app/alerts",
            ))

            # Send email alert
            if _should_email_user(user, cve.get('severity')):
                await email_service.send_vulnerability_alert(user, asset, alert, cve)

            # Send notifications
            await _notify_all_services(
                f"New CVE alert for {user.email}: {alert.title}", alert_id=alert.id, cve_id=alert.cve_id
            )

            logger.info(f"Created CVE alert {cve.get('cve_id')} for user {user.email}")

            # Log audit trail
            await self.log_audit(
                db, user.id, action="create_alert", target_type="CVE",
                target_id=cve.get('cve_id'), detail=self._alert_audit_detail(alert, asset),
            )

        except Exception as e:
            logger.error(f"Error creating CVE alert: {e}")

    async def _create_alert_from_advisory(self, db: AsyncSession, user: User, asset: Asset, advisory: dict):
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
                status=AlertStatus.PENDING,
                due_date=sla_due_date(user, advisory.get('severity', 'unknown')),
            )

            db.add(alert)
            await db.flush()  # Get the ID
            await _apply_suppression_rules(db, user, alert)
            await _notify_incident_formed(db, user, asset)
            await _maybe_auto_escalate(db, user, asset)

            db.add(Notification(
                user_id=user.id,
                kind="alert_created",
                title=f"New {advisory.get('severity', 'unknown')} advisory on {asset.name}",
                body=alert.title,
                link="/app/alerts",
            ))

            # Send email alert
            if _should_email_user(user, advisory.get('severity')):
                await email_service.send_vendor_advisory_alert(user, asset, alert, advisory)

            # Send notifications
            await _notify_all_services(
                f"New vendor alert for {user.email}: {alert.title}",
                alert_id=alert.id, vendor_advisory_id=alert.vendor_advisory_id,
            )

            logger.info(f"Created vendor alert {advisory.get('vendor_advisory_id')} for user {user.email}")

            # Log audit trail
            await self.log_audit(
                db, user.id, action="create_alert", target_type="Vendor Advisory",
                target_id=advisory.get('vendor_advisory_id'), detail=self._alert_audit_detail(alert, asset),
            )

        except Exception as e:
            logger.error(f"Error creating vendor advisory alert: {e}")

    @staticmethod
    def _alert_audit_detail(alert: Alert, asset: Asset) -> str:
        """Human-readable audit detail for a newly created alert."""
        severity = getattr(alert.severity, "value", alert.severity)
        return f"Alert #{alert.id} ({severity}) on {asset.name}: {alert.title}"

    async def log_audit(
        self, db: AsyncSession, user_id: int, action: str, target_type: str | None = None,
        target_id: str | None = None, detail: str | None = None,
    ):
        """Log an audit trail entry."""
        try:
            audit = AuditLog(
                user_id=user_id, action=action, target_type=target_type, target_id=target_id, detail=detail
            )
            db.add(audit)
            await db.commit()
            logger.info(f"Logged audit trail: {action} by user {user_id} on {target_type} {target_id}")
        except Exception as e:
            logger.error(f"Error logging audit trail: {e}")

    async def _process_ics_advisories(self, ics_advisories: list[dict]):
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
                .where(User.is_active.is_(True), Asset.is_ot_asset.is_(True))
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
        advisory: dict,
        user_assets: list,
        db: AsyncSession
    ) -> list:
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

                # Version check (simplified)
                if (asset.vendor and asset.product and
                    self._fuzzy_match(asset.vendor.lower(), vendor) and
                    self._fuzzy_match(asset.product.lower(), product) and
                    (not versions or not asset.version or
                     await self._is_version_vulnerable(asset.version, versions))):
                    affected.append((user, asset))

        return affected

    async def _is_version_vulnerable(self, asset_version: str, vulnerability_versions: list[str]) -> bool:
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
        except (ValueError, IndexError, TypeError) as e:
            logger.debug(f"Version comparison failed for {asset_version}: {e}")

        return False

    async def _create_alert_from_ics_advisory(self, db: AsyncSession, user: User, asset: Asset, advisory: dict):
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
                status=AlertStatus.PENDING,
                due_date=sla_due_date(user, severity),
            )

            db.add(alert)
            await db.flush()  # Get the ID
            await _apply_suppression_rules(db, user, alert)
            await _notify_incident_formed(db, user, asset)
            await _maybe_auto_escalate(db, user, asset)

            # For CISA KEV (known exploited), increase urgency
            if advisory.get('cisa_kev') or advisory.get('known_exploited'):
                alert_message = f"🚨 CRITICAL ICS ADVISORY (ACTIVELY EXPLOITED) for {user.email}: {alert.title}"
            else:
                alert_message = f"⚠️ ICS Advisory for {user.email}: {alert.title}"

            # Send notifications
            await _notify_all_services(alert_message, alert_id=alert.id, advisory_id=alert.vendor_advisory_id)

            logger.info(f"Created ICS alert {advisory_id} for user {user.email}")

            # Log audit trail
            await self.log_audit(db, user.id, action="create_alert", target_type="ICS Advisory",
                               target_id=advisory_id, detail=self._alert_audit_detail(alert, asset))

        except Exception as e:
            logger.error(f"Error creating ICS advisory alert: {e}")


# Global alert checker instance
alert_checker = AlertChecker()
