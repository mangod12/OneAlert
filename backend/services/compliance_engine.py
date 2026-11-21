"""Collect platform metadata as review leads, never proof of compliance."""

from datetime import UTC, datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import func, select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.alert import Alert, AlertStatus
from backend.models.asset import Asset
from backend.models.compliance import ComplianceAssessment, ComplianceControl, ComplianceFramework
from backend.models.discovered_device import NetworkSensor
from backend.models.user import User


async def lock_assessment_owner(user_id: int, db: AsyncSession) -> None:
    """Serialize assessment writers on databases supporting row locks."""
    await db.execute(select(User.id).where(User.id == user_id).with_for_update())


async def preview_automated_assessment(user_id: int, db: AsyncSession) -> dict:
    """Read owner-scoped counts. These sequential reads are not a snapshot."""
    now = datetime.now(UTC)
    async def count(model, *conditions):
        return (await db.execute(select(func.count(model.id)).where(
            model.user_id == user_id, *conditions))).scalar_one()

    assets = await count(Asset)
    zoned = await count(Asset, Asset.network_zone.is_not(None), func.trim(Asset.network_zone, ' \t\r\n') != '',
                        func.lower(func.trim(Asset.network_zone, ' \t\r\n')) != 'unknown')
    alerts = await count(Alert)
    acknowledged = await count(Alert, Alert.status == AlertStatus.ACKNOWLEDGED)
    sensors = await count(NetworkSensor)
    enabled = await count(NetworkSensor, NetworkSensor.enabled.is_(True))
    recent = await count(NetworkSensor, NetworkSensor.enabled.is_(True),
                         NetworkSensor.last_heartbeat >= now - timedelta(hours=24),
                         NetworkSensor.last_heartbeat <= now)
    inventory = f'{assets} asset records in this account. Completeness and device identity are not verified.'
    zones = (f'{zoned}/{assets} asset records have non-blank, non-unknown zone labels. '
             'Boundary enforcement is not tested.')
    monitoring = (f'{recent}/{sensors} sensor records are enabled with a heartbeat in the last 24 hours '
                  f'({enabled} enabled). Traffic coverage and detection effectiveness are not tested.')
    response = (f'{acknowledged}/{alerts} alert records are currently acknowledged. '
                'Investigation quality and response time are not verified; zero alerts is not proof of compliance.')
    # Exact seeded catalog identity, not an unqualified control-code match.
    # The seeded NIST catalog uses legacy control codes despite its 2.0 label.
    mappings = {
        ('IEC 62443', '3-3:2013', 'FR1-SR1.1'): (False,
            'Asset counts do not test human user identification or authentication. Manual evidence is required.'),
        ('IEC 62443', '3-3:2013', 'FR5-SR5.1'): (zoned > 0, zones),
        ('NIST CSF', '2.0', 'ID.AM-1'): (assets > 0, inventory),
        ('NIST CSF', '2.0', 'PR.AC-5'): (zoned > 0, zones),
        ('NIST CSF', '2.0', 'DE.CM-1'): (recent > 0, monitoring),
        ('NIST CSF', '2.0', 'RS.AN-1'): (acknowledged > 0, response),
    }
    rows = (await db.execute(select(ComplianceControl, ComplianceFramework).join(
        ComplianceFramework, ComplianceControl.framework_id == ComplianceFramework.id
    ).where(tuple_(ComplianceFramework.name, ComplianceFramework.version, ComplianceControl.control_id).in_(
        list(mappings))).order_by(ComplianceControl.id).limit(101))).all()
    if len(rows) > 100:
        raise HTTPException(status_code=422, detail='Too many mapped catalog records. Review duplicate catalogs first.')
    ranked = select(ComplianceAssessment.id, func.row_number().over(
        partition_by=ComplianceAssessment.control_id, order_by=(
            ComplianceAssessment.assessed_at.desc().nulls_last(), ComplianceAssessment.id.desc()
        )).label('rank')).where(
            ComplianceAssessment.user_id == user_id,
            ComplianceAssessment.control_id.in_([control.id for control, _ in rows])).subquery()
    latest = (await db.execute(select(ComplianceAssessment).join(
        ranked, ranked.c.id == ComplianceAssessment.id).where(ranked.c.rank == 1))).scalars().all()
    current = {record.control_id: record for record in latest}
    results = []
    for control, framework in rows:
        mapping = mappings.get((framework.name, framework.version, control.control_id))
        if mapping is None:
            continue
        available, evidence = mapping
        previous = current.get(control.id)
        protected = previous is not None and previous.assessed_by != 'system'
        results.append({
            'control_record_id': control.id, 'control_id': control.control_id,
            'framework': framework.name, 'framework_version': framework.version,
            'title': control.title, 'status': 'partial' if available else 'not_assessed',
            'evidence': evidence, 'preserve_manual_review': protected,
            'current_assessment_id': previous.id if previous else None,
        })
    return {'observed_at': now.isoformat(), 'measurement_mode': 'metadata_review_leads',
            'limitations': [
                'Platform counts are review leads, not a control test, certification or compliance verdict.',
                'Reads are sequential, not an atomic snapshot. Saving collects fresh counts, which may differ.',
                ('Mappings apply only to the seeded catalogs. The NIST catalog has legacy codes under its 2.0 label; '
                 'no standards-conformance claim is made.'),
                ('Latest manual reviews are preserved. Changed automated evidence adds a record; '
                 'unchanged evidence reuses its record. Earlier records are not rewritten.'),
                ('Historical automated records may contain unsupported compliant or non-compliant verdicts. '
                 'They are not retroactively changed.'),
            ], 'assessments': results, 'total': len(results)}


async def run_automated_assessment(user_id: int, db: AsyncSession) -> list:
    """Save conservative review leads, preserving manual and earlier evidence."""
    results = []
    try:
        await lock_assessment_owner(user_id, db)
        preview = await preview_automated_assessment(user_id, db)
        for row in preview['assessments']:
            # Re-read before writing so a manual review added during collection wins.
            previous = (await db.execute(select(ComplianceAssessment).where(
                ComplianceAssessment.user_id == user_id,
                ComplianceAssessment.control_id == row['control_record_id']
            ).order_by(ComplianceAssessment.assessed_at.desc().nulls_last(),
                       ComplianceAssessment.id.desc()).limit(1))).scalar_one_or_none()
            protected = previous is not None and previous.assessed_by != 'system'
            unchanged = (previous is not None and previous.status == row['status']
                         and previous.evidence_detail == row['evidence']
                         and previous.evidence_type == 'automated')
            if not protected and not unchanged:
                previous = ComplianceAssessment(
                    user_id=user_id, control_id=row['control_record_id'], status=row['status'],
                    evidence_type='automated', evidence_detail=row['evidence'],
                    assessed_by='system', assessed_at=datetime.now(UTC))
                db.add(previous)
                await db.flush()
            results.append({**row, 'preserve_manual_review': protected,
                            'assessment_id': previous.id if previous else None,
                            'outcome': 'manual_preserved' if protected else 'unchanged' if unchanged else 'created'})
        await db.commit()
    except Exception:
        await db.rollback()
        raise
    return results
