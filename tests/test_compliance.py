"""
Tests for compliance-as-code functionality (Phase 5).

Tests:
1. Frameworks are seeded (2 frameworks exist)
2. Controls are seeded (IEC has 10, NIST has 11)
3. Automated assessment runs and generates results
4. Compliance summary returns correct percentages
5. Manual assessment update works
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker

from backend.main import app
from backend.database.db import get_db, get_async_db, Base
from backend.models.user import User
from backend.models.compliance import (
    ComplianceFramework,
    ComplianceControl,
    ComplianceAssessment,
)
from backend.services.compliance_seed import seed_compliance_data
from backend.services.auth_service import get_password_hash


# Use the same test.db as other test modules to avoid override conflicts
SQLALCHEMY_DATABASE_URL = "sqlite:///./test_compliance.db"
engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

ASYNC_SQLALCHEMY_DATABASE_URL = "sqlite+aiosqlite:///./test_compliance.db"
async_engine_test = create_async_engine(
    ASYNC_SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
AsyncTestingSessionLocal = async_sessionmaker(
    bind=async_engine_test, class_=AsyncSession, expire_on_commit=False
)


def override_get_db():
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()


async def override_get_async_db():
    async with AsyncTestingSessionLocal() as session:
        yield session


@pytest.fixture(scope="function")
def client():
    """Create a test client with seeded compliance data."""
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_async_db] = override_get_async_db
    Base.metadata.create_all(bind=engine)

    # Seed a test user and compliance data synchronously via sync session
    with TestingSessionLocal() as session:
        user = User(
            email="compliance_test@example.com",
            hashed_password=get_password_hash("testpass123"),
            full_name="Compliance Tester",
            company="Test Corp",
            is_active=True,
            is_verified=True,
        )
        session.add(user)
        session.commit()

    # Seed compliance data using async session
    import asyncio

    async def _seed():
        async with AsyncTestingSessionLocal() as session:
            await seed_compliance_data(session)

    asyncio.run(_seed())

    with TestClient(app) as test_client:
        yield test_client

    # Teardown
    with engine.connect() as connection:
        transaction = connection.begin()
        for table in reversed(Base.metadata.sorted_tables):
            connection.execute(table.delete())
        transaction.commit()
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def auth_headers(client):
    """Get auth headers for the test user."""
    login_data = {
        "username": "compliance_test@example.com",
        "password": "testpass123",
    }
    response = client.post("/api/v1/auth/login", data=login_data)
    assert response.status_code == 200, f"Login failed: {response.text}"
    token = response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


class TestComplianceFrameworks:
    """Test compliance framework seeding and listing."""

    def test_frameworks_seeded(self, client, auth_headers):
        """Test that 2 frameworks are seeded (IEC 62443 and NIST CSF)."""
        response = client.get("/api/v1/compliance/frameworks", headers=auth_headers)
        assert response.status_code == 200
        frameworks = response.json()
        assert len(frameworks) == 2
        names = {fw["name"] for fw in frameworks}
        assert "IEC 62443" in names
        assert "NIST CSF" in names

    def test_iec_controls_seeded(self, client, auth_headers):
        """Test that IEC 62443 has 10 controls."""
        # Get frameworks to find IEC id
        response = client.get("/api/v1/compliance/frameworks", headers=auth_headers)
        frameworks = response.json()
        iec_fw = next(fw for fw in frameworks if fw["name"] == "IEC 62443")

        # Get controls for IEC
        response = client.get(
            f"/api/v1/compliance/frameworks/{iec_fw['id']}/controls",
            headers=auth_headers,
        )
        assert response.status_code == 200
        controls = response.json()
        assert len(controls) == 10

    def test_nist_controls_seeded(self, client, auth_headers):
        """Test that NIST CSF has 11 controls."""
        response = client.get("/api/v1/compliance/frameworks", headers=auth_headers)
        frameworks = response.json()
        nist_fw = next(fw for fw in frameworks if fw["name"] == "NIST CSF")

        response = client.get(
            f"/api/v1/compliance/frameworks/{nist_fw['id']}/controls",
            headers=auth_headers,
        )
        assert response.status_code == 200
        controls = response.json()
        assert len(controls) == 11

    def test_framework_not_found(self, client, auth_headers):
        """Test 404 for non-existent framework."""
        response = client.get(
            "/api/v1/compliance/frameworks/9999/controls",
            headers=auth_headers,
        )
        assert response.status_code == 404


class TestAutomatedAssessment:
    """Test automated compliance assessment engine."""

    def test_run_assessment(self, client, auth_headers):
        """Test that automated assessment runs and generates results."""
        response = client.post("/api/v1/compliance/assess", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assessments = data["data"]["assessments"]
        # Should have results for mapped controls (6 total: 2 IEC + 4 NIST)
        assert len(assessments) == 6
        assert data["data"]["total"] == 6

    def test_assessment_creates_records(self, client, auth_headers):
        """Test that assessment creates assessment records in DB."""
        # Run assessment
        client.post("/api/v1/compliance/assess", headers=auth_headers)

        # Check assessments exist
        response = client.get("/api/v1/compliance/assessments", headers=auth_headers)
        assert response.status_code == 200
        assessments = response.json()
        assert len(assessments) == 6

    def test_assessment_idempotent(self, client, auth_headers):
        """Test that running assessment twice doesn't duplicate records."""
        client.post("/api/v1/compliance/assess", headers=auth_headers)
        client.post("/api/v1/compliance/assess", headers=auth_headers)

        response = client.get("/api/v1/compliance/assessments", headers=auth_headers)
        assessments = response.json()
        # Should still be 6, not 12
        assert len(assessments) == 6


class TestComplianceSummary:
    """Test compliance summary calculation."""

    def test_summary_before_assessment(self, client, auth_headers):
        """Test summary shows all not_assessed before running assessment."""
        response = client.get("/api/v1/compliance/summary", headers=auth_headers)
        assert response.status_code == 200
        summaries = response.json()
        assert len(summaries) == 2

        for summary in summaries:
            assert summary["not_assessed"] == summary["total_controls"]
            assert summary["compliant"] == 0
            assert summary["compliance_percentage"] == 0.0

    def test_summary_after_assessment(self, client, auth_headers):
        """Test summary returns correct percentages after assessment."""
        # Run assessment first
        client.post("/api/v1/compliance/assess", headers=auth_headers)

        response = client.get("/api/v1/compliance/summary", headers=auth_headers)
        assert response.status_code == 200
        summaries = response.json()

        for summary in summaries:
            assert summary["total_controls"] > 0
            assert isinstance(summary["compliance_percentage"], float)
            # Verify math: compliant + non_compliant + partial + not_assessed == total
            total = (
                summary["compliant"]
                + summary["non_compliant"]
                + summary["partial"]
                + summary["not_assessed"]
            )
            assert total == summary["total_controls"]


class TestManualAssessment:
    """Test manual assessment update."""

    def test_update_assessment_status(self, client, auth_headers):
        """Test manually updating an assessment status."""
        # Run automated assessment to create records
        client.post("/api/v1/compliance/assess", headers=auth_headers)

        # Get assessments
        response = client.get("/api/v1/compliance/assessments", headers=auth_headers)
        assessments = response.json()
        assessment_id = assessments[0]["id"]

        # Update to partial
        update_data = {
            "status": "partial",
            "evidence_type": "manual",
            "evidence_detail": "Partially implemented with documentation gaps.",
        }
        response = client.patch(
            f"/api/v1/compliance/assessments/{assessment_id}",
            json=update_data,
            headers=auth_headers,
        )
        assert response.status_code == 200
        updated = response.json()
        assert updated["status"] == "partial"
        assert updated["evidence_type"] == "manual"
        assert updated["evidence_detail"] == "Partially implemented with documentation gaps."
        assert updated["assessed_by"] == "compliance_test@example.com"

    def test_update_assessment_invalid_status(self, client, auth_headers):
        """Test that invalid status is rejected."""
        # Run assessment to create records
        client.post("/api/v1/compliance/assess", headers=auth_headers)

        response = client.get("/api/v1/compliance/assessments", headers=auth_headers)
        assessments = response.json()
        assessment_id = assessments[0]["id"]

        update_data = {"status": "invalid_status"}
        response = client.patch(
            f"/api/v1/compliance/assessments/{assessment_id}",
            json=update_data,
            headers=auth_headers,
        )
        assert response.status_code == 422

    def test_update_assessment_not_found(self, client, auth_headers):
        """Test 404 for non-existent assessment."""
        update_data = {"status": "compliant"}
        response = client.patch(
            "/api/v1/compliance/assessments/9999",
            json=update_data,
            headers=auth_headers,
        )
        assert response.status_code == 404
