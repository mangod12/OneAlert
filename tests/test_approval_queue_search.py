"""Pending approval filters are complete, literal, current and plan-owner scoped."""
import asyncio
from datetime import UTC, datetime, timedelta

import pytest

from backend.models.response_plan import ApprovalRequest, ResponsePlan
from tests.test_response_approval_fingerprint import context as context

URL = "/api/v1/response-plans/pending-approvals"


def seed(sessions):
    async def prepare():
        async with sessions() as db:
            for i in range(220):
                db.add(ResponsePlan(id=100 + i, case_id=400 if i == 0 else 500, user_id=1 if i < 219 else 2,
                                    status="pending_approval", autonomy_level="L3" if i == 0 else "L1", actions=[]))
                db.add(ApprovalRequest(id=100 + i, plan_id=100 + i, status="pending" if i < 218 else "approved",
                                       reason="Old 100%_literal review" if i == 0 else f"Request {i:03}",
                                       requested_by="reviewer-a" if i == 0 else "agent",
                                       created_at=datetime(2026, 1, 1, tzinfo=UTC) + timedelta(minutes=i)))
            await db.commit()
    asyncio.run(prepare())


def get(client, **params):
    response = client.get(URL, params=params)
    assert response.status_code == 200, response.text
    return response.json()


def test_search_beyond_200_requests_with_plan_metadata_and_verifiable_fingerprint(context):
    client, sessions = context
    seed(sessions)
    assert get(client)["total"] == 219  # Original one plus 218 newly pending owner requests.
    data = get(client, query="  OLD 100%_literal  ")
    assert data["total"] == 1
    row = data["data"][0]
    assert row["id"] == row["plan_id"] == 100 and row["case_id"] == 400
    assert row["requested_by"] == "reviewer-a" and row["plan_status"] == "pending_approval"
    reviewed = client.get('/api/v1/response-plans/100/approval-review').json()
    assert row["review_fingerprint"] == reviewed["review_fingerprint"]
    assert get(client, query="reviewer-a")["total"] == 1
    assert get(client, query="%not-present_")["total"] == 0
    assert get(client, query="' OR 1=1 --")["total"] == 0
    assert get(client, query="Request 219")["total"] == 0
    assert get(client, query="Request 218")["total"] == 0
    assert get(client, query="400")["total"] == 1


def test_combined_exact_case_and_level_filter_and_current_pending_state(context):
    client, sessions = context
    seed(sessions)
    assert get(client, case_id=400, autonomy_level="L3")["total"] == 1
    assert get(client, case_id=400, autonomy_level="L1")["total"] == 0
    assert get(client, case_id=99999)["total"] == 0
    assert get(client, case_id=500, query="Request 001")["data"][0]["plan_id"] == 101
    async def resolve():
        async with sessions() as db:
            approval = await db.get(ApprovalRequest, 100)
            approval.status = "approved"
            await db.commit()
    asyncio.run(resolve())
    assert get(client, case_id=400)["total"] == 0


def test_global_request_order_and_stable_pagination(context):
    client, sessions = context
    seed(sessions)
    for sort in ("oldest", "newest"):
        pages = [get(client, sort=sort, page=page, size=100) for page in range(1, 4)]
        rows = [row for page in pages for row in page["data"]]
        assert all(page["total"] == 219 for page in pages)
        assert len({row["id"] for row in rows}) == 219
        positions = [row["id"] for row in rows if row["id"] >= 100]
        assert positions == sorted(positions, reverse=sort == "newest")
    assert get(client, page=80)["data"] == []


@pytest.mark.parametrize("params", [{"case_id": 0}, {"case_id": -1}, {"case_id": "1.5"},
                                     {"query": "x" * 201}, {"autonomy_level": "L5"}, {"sort": "arbitrary"}])
def test_filter_validation(context, params):
    client, _ = context
    assert client.get(URL, params=params).status_code == 422
