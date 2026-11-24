"""Owner-only complete roster includes task-derived access without side effects."""
# ruff: noqa: F401, F811
from test_case_assignment import _create_case, _seed_case_actor, _share_org, _TestingSessionLocal, _user_id, client

from backend.models.case import Case, CaseTask, CaseTimeline, CaseWatcher
from backend.models.user import User


def setup(client):
    owner = _seed_case_actor(client, 'owner@example.com')
    other = _seed_case_actor(client, 'other@example.com')
    cid = _create_case(client, owner)
    oid, uid = _user_id(client, owner), _user_id(client, other)
    _share_org(oid, uid)
    return owner, other, cid, oid, uid


def test_owner_only_roster_has_current_scope_and_read_has_no_side_effects(client):
    from backend.models.notification import Notification
    owner, other, cid, oid, _uid = setup(client)
    with _TestingSessionLocal() as db:
        before = (db.query(CaseTimeline).count(), db.query(Notification).count(), db.query(CaseWatcher).count())
    result = client.get(f'/api/v1/cases/{cid}/access-map', headers=owner)
    assert result.status_code == 200, result.text
    data = result.json()
    assert data['case_id'] == cid and data['owner_id'] == oid and len(data['records']) == 1
    assert data['records'][0]['id'] == oid and data['records'][0]['reasons'] == ['Investigation owner']
    assert data['records'][0]['can_manage_investigation'] and data['records'][0]['can_add_notes']
    assert client.get(f'/api/v1/cases/{cid}/access-map', headers=other).status_code == 404
    with _TestingSessionLocal() as db:
        assert before == (db.query(CaseTimeline).count(), db.query(Notification).count(), db.query(CaseWatcher).count())


def test_union_combines_all_reasons_and_completed_assigned_tasks_with_inactive_identity(client):
    owner, _other, cid, _oid, uid = setup(client)
    with _TestingSessionLocal() as db:
        db.get(Case, cid).assigned_to_id = uid
        db.add(CaseWatcher(case_id=cid, user_id=uid))
        db.add(CaseTask(case_id=cid, assignee_id=uid, title='Done task still grants access', done=True))
        db.get(User, uid).is_active = False
        db.commit()
    data = client.get(f'/api/v1/cases/{cid}/access-map', headers=owner).json()
    record = next(row for row in data['records'] if row['id'] == uid)
    assert record['reasons'] == ['Investigation assignee', 'Watcher', 'Assigned checklist tasks']
    assert not record['is_active'] and not record['can_manage_investigation'] and record['can_manage_checklist']
    assert record['receives_watcher_updates'] and record['assigned_tasks'][0]['done']
    assert 'webhook' not in str(data) and 'password' not in str(data)


def test_task_only_account_can_open_case_but_not_owner_access_map(client):
    owner, other, cid, _oid, uid = setup(client)
    with _TestingSessionLocal() as db:
        db.add(CaseTask(case_id=cid, assignee_id=uid, title='Assigned task', done=True))
        db.commit()
    assert client.get(f'/api/v1/cases/{cid}', headers=other).status_code == 200
    assert client.get(f'/api/v1/cases/{cid}/access-map', headers=other).status_code == 404
    record = next(row for row in client.get(f'/api/v1/cases/{cid}/access-map', headers=owner).json()['records']
                  if row['id'] == uid)
    assert record['reasons'] == ['Assigned checklist tasks']
    assert not record['can_manage_checklist'] and not record['receives_watcher_updates']


def test_unassigned_tasks_and_other_case_relationships_are_excluded_and_refresh_reflects_removal(client):
    owner, other, cid, _oid, uid = setup(client)
    other_cid = _create_case(client, other)
    with _TestingSessionLocal() as db:
        db.add(CaseTask(case_id=cid, title='Unassigned', assignee_id=None))
        db.add(CaseWatcher(case_id=other_cid, user_id=uid))
        db.commit()
    assert len(client.get(f'/api/v1/cases/{cid}/access-map', headers=owner).json()['records']) == 1
    with _TestingSessionLocal() as db:
        task = CaseTask(case_id=cid, title='Temporary access', assignee_id=uid)
        db.add(task)
        db.commit()
        tid = task.id
    assert len(client.get(f'/api/v1/cases/{cid}/access-map', headers=owner).json()['records']) == 2
    with _TestingSessionLocal() as db:
        db.get(CaseTask, tid).assignee_id = None
        db.commit()
    assert len(client.get(f'/api/v1/cases/{cid}/access-map', headers=owner).json()['records']) == 1


def test_over_limit_fails_without_partial_roster(client):
    owner, _other, cid, _oid, uid = setup(client)
    with _TestingSessionLocal() as db:
        db.add_all([CaseTask(case_id=cid, title=f'Assigned {n}', assignee_id=uid) for n in range(501)])
        db.commit()
    response = client.get(f'/api/v1/cases/{cid}/access-map', headers=owner)
    assert response.status_code == 409 and 'records' not in response.json()


def test_separate_assignee_and_watcher_sources_have_distinct_permissions(client):
    owner, _other, cid, _oid, uid = setup(client)
    with _TestingSessionLocal() as db:
        db.get(Case, cid).assigned_to_id = uid
        db.commit()
    record = next(row for row in client.get(f'/api/v1/cases/{cid}/access-map', headers=owner).json()['records']
                  if row['id'] == uid)
    assert record['reasons'] == ['Investigation assignee'] and record['can_manage_checklist']
    assert not record['receives_watcher_updates'] and not record['assigned_tasks']
    with _TestingSessionLocal() as db:
        db.get(Case, cid).assigned_to_id = None
        db.add(CaseWatcher(case_id=cid, user_id=uid))
        db.commit()
    record = next(row for row in client.get(f'/api/v1/cases/{cid}/access-map', headers=owner).json()['records']
                  if row['id'] == uid)
    assert record['reasons'] == ['Watcher'] and record['receives_watcher_updates']
    assert not record['can_manage_checklist'] and not record['assigned_tasks']
