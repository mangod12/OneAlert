"""Shared investigation visibility for current evidence and existing case views."""
from sqlalchemy import or_, select

from backend.models.case import Case, CaseTask, CaseWatcher


def visible_cases(case_id, user):
    watched = select(CaseWatcher.case_id).where(CaseWatcher.user_id == user.id)
    tasked = select(CaseTask.case_id).where(CaseTask.assignee_id == user.id)
    return select(Case).where(Case.id == case_id, or_(
        Case.user_id == user.id, Case.assigned_to_id == user.id,
        Case.id.in_(watched), Case.id.in_(tasked),
    ))
