"""Owned, read-only suppression overlap uses current runtime criteria, never precedence."""

import pytest
from test_suppression_rules import TestingSessionLocal
from test_suppression_rules import auth_headers as auth_headers
from test_suppression_rules import client as client

from backend.models.alert import Alert
from backend.models.asset import Asset
from backend.models.audit_log import AuditLog
from backend.models.suppression_rule import AlertSuppressionRule
from backend.models.user import User
from backend.services.suppression_review import suppression_rule_fingerprint


def seed():
    with TestingSessionLocal() as db:
        user = db.query(User).first()
        asset = db.query(Asset).filter_by(user_id=user.id).first()
        primary = AlertSuppressionRule(
            user_id=user.id,
            name="Paused Unicode literal",
            title_contains="ä%_",
            asset_id=asset.id,
            cve_id="cve-2026-9000",
            severity="high",
            enabled=False,
        )
        a = AlertSuppressionRule(user_id=user.id, name="Group A policy", title_contains="GROUP A")
        b = AlertSuppressionRule(user_id=user.id, name="Group B policy", title_contains="Group B")
        paused = AlertSuppressionRule(user_id=user.id, name="Paused policy", title_contains="Exclusive", enabled=False)
        empty = AlertSuppressionRule(user_id=user.id, name="Legacy empty enabled", enabled=True)
        foreign = AlertSuppressionRule(user_id=999, name="FOREIGN_RULE_PRIVATE", title_contains="ä%_")
        db.add_all([primary, a, b, paused, empty, foreign])
        db.flush()
        for index in range(21):
            group = (
                "Group A Group B"
                if index < 5
                else "Group A"
                if index < 10
                else "Group B"
                if index < 15
                else "Exclusive"
            )
            db.add(
                Alert(
                    user_id=user.id,
                    asset_id=asset.id,
                    cve_id="CVE-2026-9000",
                    severity="high",
                    title=f"Gateway Ä%_ {group} {index}",
                    status=("pending", "sent", "acknowledged")[index % 3],
                )
            )
        for status in ["resolved", "dismissed", "snoozed"]:
            db.add(
                Alert(
                    user_id=user.id,
                    asset_id=asset.id,
                    cve_id="CVE-2026-9000",
                    severity="high",
                    title="Gateway Ä%_ Group A Group B inactive",
                    status=status,
                )
            )
        db.add_all(
            [
                Alert(
                    user_id=999,
                    asset_id=asset.id,
                    cve_id="CVE-2026-9000",
                    severity="high",
                    title="FOREIGN_ALERT_PRIVATE Ä%_ Group A Group B",
                    status="pending",
                ),
                Alert(
                    user_id=user.id,
                    asset_id=asset.id,
                    cve_id="CVE-2026-OTHER",
                    severity="high",
                    title="Gateway Ä%_ Group A Group B wrong CVE",
                    status="pending",
                ),
                Alert(
                    user_id=user.id,
                    asset_id=asset.id,
                    cve_id="CVE-2026-9000",
                    severity="low",
                    title="Gateway Ä%_ Group A Group B wrong severity",
                    status="pending",
                ),
                Alert(
                    user_id=user.id,
                    asset_id=asset.id,
                    cve_id="CVE-2026-9000",
                    severity="high",
                    title="Gateway Äxx Group A Group B not literal wildcards",
                    status="pending",
                ),
            ]
        )
        db.commit()
        return primary.id, a.id, b.id, foreign.id


def read(client, headers, identity):
    return client.get(f"/api/v1/suppression-rules/{identity}/overlap-review", headers=headers)


def test_counts_shared_and_exclusive_without_counting_same_alert_twice_or_changing_anything(client, auth_headers):
    identity, a, b, _ = seed()
    with TestingSessionLocal() as db:
        before_alerts = [(row.id, row.status, row.snoozed_until) for row in db.query(Alert).all()]
        before_rules = [
            (row.id, row.name, row.enabled, row.title_contains) for row in db.query(AlertSuppressionRule).all()
        ]
        before_audits = db.query(AuditLog).count()
    response = read(client, auth_headers, identity)
    assert response.status_code == 200
    data = response.json()
    assert data["version"] == 1 and data["scope"] == "active"
    assert data["matching_alert_count"] == 21
    assert data["shared_matching_alert_count"] == 15
    assert data["exclusive_matching_alert_count"] == 6
    assert data["other_enabled_rule_count"] == 4
    assert data["compared_other_rule_count"] == 3 and data["ignored_empty_other_rule_count"] == 1
    assert [(row["rule"]["id"], row["matching_alert_count"]) for row in data["overlapping_rules"]] == [(a, 10), (b, 10)]
    assert data["rule"]["enabled"] is False
    assert data["rule_fingerprint"] == suppression_rule_fingerprint(data["rule"])
    assert all(
        row["rule_fingerprint"] == suppression_rule_fingerprint(row["rule"]) for row in data["overlapping_rules"]
    )
    assert len(data["examples"]) == data["example_limit"] == 10
    ids = [row["alert"]["id"] for row in data["examples"]]
    assert ids == sorted(set(ids), reverse=True)
    assert [row["other_rule_ids"] for row in data["examples"][:6]] == [[]] * 6
    assert all(row["other_rule_ids"] == [b] for row in data["examples"][6:])
    assert "FOREIGN" not in response.text and "user_id" not in response.text and "raw_data" not in response.text
    assert "winner" not in response.text and "suppressed_count" not in response.text
    with TestingSessionLocal() as db:
        assert before_alerts == [(row.id, row.status, row.snoozed_until) for row in db.query(Alert).all()]
        assert before_rules == [
            (row.id, row.name, row.enabled, row.title_contains) for row in db.query(AlertSuppressionRule).all()
        ]
        assert before_audits == db.query(AuditLog).count()


def test_current_rule_never_compares_itself_and_paused_others_do_not_overlap(client, auth_headers):
    identity, a, b, _ = seed()
    with TestingSessionLocal() as db:
        db.get(AlertSuppressionRule, identity).enabled = True
        db.get(AlertSuppressionRule, a).enabled = False
        db.get(AlertSuppressionRule, b).enabled = False
        db.commit()
    data = read(client, auth_headers, identity).json()
    assert data["matching_alert_count"] == data["exclusive_matching_alert_count"] == 21
    assert data["shared_matching_alert_count"] == 0 and data["overlapping_rules"] == []
    assert all(row["other_rule_ids"] == [] for row in data["examples"])


def test_matching_examples_include_all_competing_ids_once_and_count_not_execution_order(client, auth_headers):
    identity, a, b, _ = seed()
    with TestingSessionLocal() as db:
        for rule in db.query(AlertSuppressionRule).filter(AlertSuppressionRule.id.in_([a, b])):
            rule.title_contains = "ä%_"
        db.commit()
    data = read(client, auth_headers, identity).json()
    assert data["shared_matching_alert_count"] == 21 and data["exclusive_matching_alert_count"] == 0
    assert [row["matching_alert_count"] for row in data["overlapping_rules"]] == [21, 21]
    assert all(row["other_rule_ids"] == [a, b] for row in data["examples"])


def test_no_active_matches_produces_real_zeroes_not_future_safety_or_an_execution_claim(client, auth_headers):
    identity, _, _, _ = seed()
    with TestingSessionLocal() as db:
        db.get(AlertSuppressionRule, identity).title_contains = "No current values"
        db.commit()
    data = read(client, auth_headers, identity).json()
    assert (
        data["matching_alert_count"]
        == data["shared_matching_alert_count"]
        == data["exclusive_matching_alert_count"]
        == 0
    )
    assert data["examples"] == data["overlapping_rules"] == []


def test_foreign_missing_invalid_and_unauthenticated_reads_do_not_disclose_a_rule(client, auth_headers):
    _, _, _, foreign = seed()
    for identity in [foreign, 999999, 0, -1]:
        response = read(client, auth_headers, identity)
        assert response.status_code == 404 and "PRIVATE" not in response.text
    client.cookies.clear()
    assert client.get(f"/api/v1/suppression-rules/{foreign}/overlap-review").status_code == 401
    assert client.get("/api/v1/suppression-rules/not-an-id/overlap-review", headers=auth_headers).status_code == 422


def test_empty_primary_refuses_fictional_runtime_counts_without_repair_or_enabling(client, auth_headers):
    identity, _, _, _ = seed()
    with TestingSessionLocal() as db:
        rule = db.get(AlertSuppressionRule, identity)
        rule.asset_id = rule.cve_id = rule.severity = rule.title_contains = None
        db.commit()
    response = read(client, auth_headers, identity)
    assert response.status_code == 422 and "Automatic suppression skips" in response.text
    assert "matching_alert_count" not in response.json()
    with TestingSessionLocal() as db:
        assert db.get(AlertSuppressionRule, identity).enabled is False


@pytest.mark.parametrize("count,expected", [(0, 200), (200, 200), (201, 422)])
def test_other_enabled_rule_bound_is_explicit_and_never_silently_truncates(client, auth_headers, count, expected):
    with TestingSessionLocal() as db:
        primary = db.query(AlertSuppressionRule).first()
        identity, owner = primary.id, primary.user_id
        db.add_all(
            AlertSuppressionRule(user_id=owner, name=f"Other {index}", title_contains="Unrelated")
            for index in range(count)
        )
        db.add_all(
            [
                AlertSuppressionRule(
                    user_id=owner, name="Paused not counted", title_contains="ransomware", enabled=False
                ),
                AlertSuppressionRule(user_id=999, name="Foreign not counted", title_contains="ransomware"),
            ]
        )
        db.commit()
    response = read(client, auth_headers, identity)
    assert response.status_code == expected
    if expected == 200:
        data = response.json()
        assert data["other_enabled_rule_limit"] == 200
        assert data["other_enabled_rule_count"] == data["compared_other_rule_count"] == count
        assert data["shared_matching_alert_count"] == 0 and data["exclusive_matching_alert_count"] == 1
    else:
        assert "No partial overlap counts" in response.text and "overlapping_rules" not in response.json()


def test_rule_rows_are_sorted_by_overlap_count_not_implied_execution_order(client, auth_headers):
    identity, a, b, _ = seed()
    with TestingSessionLocal() as db:
        db.get(AlertSuppressionRule, b).title_contains = "ä%_"
        db.commit()
    data = read(client, auth_headers, identity).json()
    assert [(row["rule"]["id"], row["matching_alert_count"]) for row in data["overlapping_rules"]] == [(b, 21), (a, 10)]
    assert data["shared_matching_alert_count"] == 21


def test_active_alert_bound_never_returns_partial_counts_and_filters_foreign_and_inactive_rows(
    client, auth_headers, monkeypatch
):
    from backend.routers import suppression_overlap

    monkeypatch.setattr(suppression_overlap, "_ACTIVE_ALERT_LIMIT", 1)
    with TestingSessionLocal() as db:
        primary = db.query(AlertSuppressionRule).first()
        identity, owner = primary.id, primary.user_id
        asset_id = db.query(Asset).filter_by(user_id=owner).first().id
        db.add(Alert(user_id=999, asset_id=asset_id, title="Foreign", severity="high", status="pending"))
        db.add(Alert(user_id=owner, asset_id=asset_id, title="Inactive", severity="high", status="snoozed"))
        db.commit()
    at_bound = read(client, auth_headers, identity)
    assert at_bound.status_code == 200 and at_bound.json()["active_alert_count"] == 1
    with TestingSessionLocal() as db:
        db.add(Alert(user_id=owner, asset_id=asset_id, title="Not matching criteria", severity="low", status="pending"))
        db.commit()
    exceeded = read(client, auth_headers, identity)
    assert exceeded.status_code == 422 and "No partial overlap counts" in exceeded.text
    assert "matching_alert_count" not in exceeded.json()
