"""Every notification kind already offered by Settings can be saved and used as a mute."""

import pytest
from test_notification_preferences import _register_and_login
from test_notification_preferences import client as client

from backend.models.user import KNOWN_NOTIFICATION_KINDS


@pytest.mark.parametrize('kind', [
    'case_task_assigned', 'case_task_due_soon', 'case_task_overdue',
    'alert_sla_breached', 'alert_sla_due_soon',
])
def test_existing_task_and_alert_sla_choices_round_trip_without_loosening_unknown_kind_validation(client, kind):
    headers = _register_and_login(client, 'supported-kind@example.com')
    path = '/api/v1/auth/me/notification-preferences'
    before = client.get(path, headers=headers).json()
    response = client.patch(path, headers=headers, json={'muted_kinds': [kind]})
    assert response.status_code == 200, response.text
    assert response.json() == {**before, 'muted_kinds': [kind]}
    assert client.get(path, headers=headers).json()['muted_kinds'] == [kind]
    assert client.patch(path, headers=headers, json={'muted_kinds': [kind, 'not_a_real_kind']}).status_code == 422
    assert client.get(path, headers=headers).json()['muted_kinds'] == [kind]


def test_all_seventeen_actual_settings_choices_can_be_saved_together(client):
    assert len(KNOWN_NOTIFICATION_KINDS) == len(set(KNOWN_NOTIFICATION_KINDS)) == 17
    headers = _register_and_login(client, 'all-kinds@example.com')
    response = client.patch('/api/v1/auth/me/notification-preferences', headers=headers,
                            json={'muted_kinds': list(KNOWN_NOTIFICATION_KINDS)})
    assert response.status_code == 200
    assert response.json()['muted_kinds'] == list(KNOWN_NOTIFICATION_KINDS)
