"""Recorded coverage evidence, keeping simulation and missing outcomes explicit."""
from datetime import UTC, datetime

from sqlalchemy import case, distinct, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.validation import ControlResult, ValidationRun, ValidationStep


async def coverage_evidence(
    db: AsyncSession, user_id: int, execution: str, run_status: str, page: int, size: int,
) -> dict:
    predicates = [ValidationRun.user_id == user_id]
    if execution != 'all':
        predicates.append(ValidationStep.simulated.is_(execution == 'simulated')
                          if execution != 'unknown' else ValidationStep.simulated.is_(None))
    if run_status != 'all':
        predicates.append(ValidationRun.status == run_status)
    query = select(
        ValidationStep.technique_id, ValidationStep.technique_name,
        func.count(distinct(ValidationRun.id)).label('run_count'),
        func.count(distinct(ValidationStep.id)).label('step_count'),
        func.count(distinct(case((ValidationStep.simulated.is_(True), ValidationStep.id)))).label('simulated_steps'),
        func.count(distinct(case((ValidationStep.simulated.is_(False), ValidationStep.id))))
        .label('non_simulated_steps'),
        func.count(distinct(case((ValidationStep.simulated.is_(None), ValidationStep.id))))
        .label('unknown_execution_steps'),
        func.count(ControlResult.id).label('control_result_count'),
        func.sum(case((ControlResult.detected.is_(True), 1), else_=0)).label('recorded_detected'),
        func.sum(case((ControlResult.detected.is_(False), 1), else_=0)).label('recorded_not_detected'),
    ).select_from(ValidationStep).join(ValidationRun, ValidationRun.id == ValidationStep.run_id).outerjoin(
        ControlResult, ControlResult.step_id == ValidationStep.id,
    ).where(*predicates).group_by(ValidationStep.technique_id, ValidationStep.technique_name)
    total = (await db.execute(select(func.count()).select_from(query.subquery()))).scalar_one()
    results = (await db.execute(query.order_by(ValidationStep.technique_id, ValidationStep.technique_name)
                               .offset((page - 1) * size).limit(size))).all()
    rows = []
    for row in results:
        item = dict(row._mapping)
        known = item['recorded_detected'] + item['recorded_not_detected']
        item['unknown_outcomes'] = item['control_result_count'] - known
        item['recorded_detection_percentage'] = round(item['recorded_detected'] / known * 100, 1) if known else None
        rows.append(item)
    return {'schema_version': 1,
            'scope': 'Owner-visible recorded validation evidence grouped by exact technique ID and '
            'recorded technique name. Counts describe stored controls, steps and runs, not unique real-world tests. '
            'Simulated or non-simulated flags are recorded metadata, not independent proof of live detections. '
            'Steps without control results are retained. Detection percentage excludes unknown outcomes.',
            'execution': execution, 'run_status': run_status, 'page': page, 'size': size, 'total': total,
            'retrieved_at': datetime.now(UTC), 'techniques': rows}
