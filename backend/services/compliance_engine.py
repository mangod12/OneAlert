"""Compliance engine -- automated evidence collection and assessment."""

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from backend.models.asset import Asset
from backend.models.alert import Alert, AlertStatus
from backend.models.compliance import ComplianceAssessment, ComplianceControl
from backend.models.discovered_device import NetworkSensor


async def run_automated_assessment(user_id: int, db: AsyncSession) -> list:
    """Run automated compliance checks based on existing platform data.

    Maps platform capabilities to framework controls:
    - Asset inventory exists -> IEC 62443 FR1 / NIST CSF ID.AM
    - Network zones assigned -> IEC 62443 FR5 / NIST CSF PR.AC
    - Alerts acknowledged within timeframe -> NIST CSF RS.AN
    - Network sensors active -> NIST CSF DE.CM
    - OT assets tracked -> IEC 62443 FR1
    """
    results = []

    # Count user's assets
    asset_count = (await db.execute(
        select(func.count(Asset.id)).where(Asset.user_id == user_id)
    )).scalar_one()

    # Count OT assets with zones
    zoned_assets = (await db.execute(
        select(func.count(Asset.id)).where(
            Asset.user_id == user_id,
            Asset.network_zone != None  # noqa: E711
        )
    )).scalar_one()

    # Count acknowledged alerts
    ack_alerts = (await db.execute(
        select(func.count(Alert.id)).where(
            Alert.user_id == user_id,
            Alert.status == AlertStatus.ACKNOWLEDGED
        )
    )).scalar_one()

    total_alerts = (await db.execute(
        select(func.count(Alert.id)).where(Alert.user_id == user_id)
    )).scalar_one()

    # Count active sensors
    sensor_count = (await db.execute(
        select(func.count(NetworkSensor.id)).where(NetworkSensor.user_id == user_id)
    )).scalar_one()

    # Build evidence mappings
    # IEC 62443 controls (by control_id string)
    iec_mappings = {
        "FR1-SR1.1": {
            "check": asset_count > 0,
            "status": "compliant" if asset_count > 0 else "non_compliant",
            "evidence": f"Asset inventory contains {asset_count} tracked assets.",
            "type": "automated"
        },
        "FR5-SR5.1": {
            "check": zoned_assets > 0,
            "status": "compliant" if zoned_assets > 0 else "non_compliant",
            "evidence": f"{zoned_assets} assets have network zone assignments.",
            "type": "automated"
        },
    }

    # NIST CSF controls
    nist_mappings = {
        "ID.AM-1": {
            "check": asset_count > 0,
            "status": "compliant" if asset_count > 0 else "non_compliant",
            "evidence": f"Physical devices inventoried: {asset_count} assets tracked.",
            "type": "automated"
        },
        "PR.AC-5": {
            "check": zoned_assets > 0,
            "status": "compliant" if zoned_assets > 0 else "non_compliant",
            "evidence": f"Network segmentation: {zoned_assets} assets with zone classification.",
            "type": "automated"
        },
        "DE.CM-1": {
            "check": sensor_count > 0,
            "status": "compliant" if sensor_count > 0 else "non_compliant",
            "evidence": f"Network monitoring: {sensor_count} active sensors deployed.",
            "type": "automated"
        },
        "RS.AN-1": {
            "check": ack_alerts > 0 or total_alerts == 0,
            "status": "compliant" if (ack_alerts > 0 or total_alerts == 0) else "non_compliant",
            "evidence": f"Alert response: {ack_alerts}/{total_alerts} alerts acknowledged.",
            "type": "automated"
        },
    }

    # Apply assessments to database
    all_mappings = {**iec_mappings, **nist_mappings}

    for control_id_str, mapping in all_mappings.items():
        # Find the control in DB
        control_result = await db.execute(
            select(ComplianceControl).where(ComplianceControl.control_id == control_id_str)
        )
        control = control_result.scalar_one_or_none()
        if not control:
            continue

        # Upsert assessment
        existing = await db.execute(
            select(ComplianceAssessment).where(
                ComplianceAssessment.user_id == user_id,
                ComplianceAssessment.control_id == control.id
            )
        )
        assessment = existing.scalar_one_or_none()

        if assessment:
            assessment.status = mapping["status"]
            assessment.evidence_type = mapping["type"]
            assessment.evidence_detail = mapping["evidence"]
            assessment.assessed_by = "system"
        else:
            assessment = ComplianceAssessment(
                user_id=user_id,
                control_id=control.id,
                status=mapping["status"],
                evidence_type=mapping["type"],
                evidence_detail=mapping["evidence"],
                assessed_by="system"
            )
            db.add(assessment)

        results.append({
            "control_id": control_id_str,
            "status": mapping["status"],
            "evidence": mapping["evidence"]
        })

    await db.commit()
    return results
