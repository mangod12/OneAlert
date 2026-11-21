"""Recorded coverage evidence, keeping simulation and missing outcomes explicit."""
from datetime import UTC, datetime

from sqlalchemy import case, distinct, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.validation import ControlResult, ValidationRun, ValidationStep


def _scope(user_id: int, execution: str, run_status: str) -> list:
    predicates = [ValidationRun.user_id == user_id]
    if execution != 'all':
        predicates.append(ValidationStep.simulated.is_(execution == 'simulated')
                          if execution != 'unknown' else ValidationStep.simulated.is_(None))
    if run_status != 'all':
        predicates.append(ValidationRun.status == run_status)
    return predicates


async def coverage_evidence(
    db: AsyncSession, user_id: int, execution: str, run_status: str, page: int, size: int,
) -> dict:
    predicates = _scope(user_id, execution, run_status)
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


async def coverage_source_steps(
    db: AsyncSession, user_id: int, technique_id: str, technique_name: str,
    execution: str, run_status: str, page: int, size: int,
) -> dict:
    predicates = [*_scope(user_id, execution, run_status),
                  ValidationStep.technique_id == technique_id,
                  ValidationStep.technique_name == technique_name]
    total = (await db.execute(select(func.count()).select_from(ValidationStep).join(
        ValidationRun, ValidationRun.id == ValidationStep.run_id).where(*predicates))).scalar_one()
    query = select(
        ValidationStep.id.label('step_id'), ValidationStep.step_number,
        ValidationStep.run_id, ValidationRun.name.label('run_name'),
        ValidationRun.status.label('run_status'), ValidationRun.mode.label('run_mode'),
        ValidationStep.test_name, ValidationStep.status.label('step_status'),
        ValidationStep.simulated, ValidationStep.actual_result, ValidationStep.executed_at,
        func.count(ControlResult.id).label('control_result_count'),
        func.sum(case((ControlResult.detected.is_(True), 1), else_=0)).label('recorded_detected'),
        func.sum(case((ControlResult.detected.is_(False), 1), else_=0)).label('recorded_not_detected'),
    ).select_from(ValidationStep).join(ValidationRun, ValidationRun.id == ValidationStep.run_id).outerjoin(
        ControlResult, ControlResult.step_id == ValidationStep.id,
    ).where(*predicates).group_by(
        ValidationStep.id, ValidationStep.step_number, ValidationStep.run_id, ValidationRun.name,
        ValidationRun.status, ValidationRun.mode, ValidationStep.test_name, ValidationStep.status,
        ValidationStep.simulated, ValidationStep.actual_result, ValidationStep.executed_at,
    ).order_by(ValidationStep.run_id.desc(), ValidationStep.step_number, ValidationStep.id)
    results = (await db.execute(query.offset((page - 1) * size).limit(size))).all()
    records = []
    for row in results:
        item = dict(row._mapping)
        item['unknown_outcomes'] = (item['control_result_count'] - item['recorded_detected']
                                    - item['recorded_not_detected'])
        records.append(item)
    return {'technique_id': technique_id, 'technique_name': technique_name,
            'execution': execution, 'run_status': run_status, 'page': page, 'size': size,
            'total': total, 'retrieved_at': datetime.now(UTC), 'records': records,
            'scope': 'Current owner-visible saved steps for the exact recorded technique ID and name, '
            'under the selected run status and execution flag. Separate reads may change. '
            'Run links read current records; flags and outcomes are not proof of live detection.'}
