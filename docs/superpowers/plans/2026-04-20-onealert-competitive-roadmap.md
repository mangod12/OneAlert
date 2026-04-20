# OneAlert 2.0 — Strategic Competitive Improvement Roadmap

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement each phase. Each phase is an independent implementation plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform OneAlert from a solid MVP into a market-competitive OT/ICS cybersecurity SaaS platform that wins SMB and mid-market customers away from $300K+/yr enterprise incumbents (Claroty, Dragos, Nozomi).

**Architecture:** Incremental evolution — each phase ships independently, adds measurable value, and builds on the prior. Backend remains FastAPI + PostgreSQL. Frontend migrates from vanilla JS to React. New subsystems added as isolated services behind the existing API gateway.

**Tech Stack:** Python 3.11+ / FastAPI / SQLAlchemy 2.0 / PostgreSQL / React + Vite / Redis / Celery / Docker / Cloud Run

---

## Executive Summary: What Makes This Competitive

### Current State (What You Have)
- Multi-source CVE aggregation (NVD, MSRC, Cisco, Red Hat, ICS-CERT, CISA KEV)
- OT asset discovery with sensor ingestion pipeline
- Risk scoring engine (Vulnerability 40% + Exposure 35% + Criticality 25%)
- Alert deduplication and notification (Email, Slack, Webhook)
- JWT auth + GitHub OAuth + RBAC (admin/analyst/viewer)
- Cloud-native deployment (Docker + Cloud Run + Cloud SQL)
- 46 automated tests

### Market Gap (Why You Can Win)
Tier-1 vendors (Claroty, Dragos, Nozomi) charge $300K-$800K/yr and require hardware sensors + professional services. **93% of SMBs say their cybersecurity budget is insufficient.** No affordable, self-service OT vulnerability management platform exists for companies with <500 assets and <$100K annual security budget.

### Target Position
**"The Vanta of OT Security"** — affordable, self-service, compliance-focused OT vulnerability management for SMB manufacturers, water utilities, and building automation. $500-$5,000/month vs. $25K-$65K/month from incumbents.

---

## Phase Map

| Phase | Name | Priority | Effort | Impact |
|-------|------|----------|--------|--------|
| **1** | Security Hardening & Production Readiness | P0 — Blocker | 1 week | Table stakes |
| **2** | Modern Frontend (React Migration) | P0 — Blocker | 2 weeks | UX competitive parity |
| **3** | Multi-Tenancy & Organization Model | P1 — High | 1 week | Enterprise readiness |
| **4** | AI-Powered Remediation Engine | P1 — High | 2 weeks | Key differentiator |
| **5** | Compliance-as-Code (IEC 62443 / NERC CIP / NIS2) | P1 — High | 2 weeks | Revenue driver |
| **6** | SBOM & Software Composition Analysis | P1 — High | 2 weeks | Market gap exploit |
| **7** | Network Topology Mapping & Visualization | P2 — Medium | 2 weeks | Feature parity |
| **8** | Billing & Subscription (Stripe) | P2 — Medium | 1 week | Revenue enablement |
| **9** | SIEM/SOAR Integration Suite | P2 — Medium | 1 week | Enterprise sales |
| **10** | Observability & Operational Maturity | P2 — Medium | 1 week | Reliability |

---

## Phase 1: Security Hardening & Production Readiness

**Goal:** Fix all P0 security gaps so the platform can safely handle real user data.

**Why this first:** Nothing else matters if the platform itself is insecure. A cybersecurity product with security vulnerabilities is a non-starter. Current gaps include: no rate limiting, incomplete MFA, insecure OAuth token handling, missing security headers, and ~7% test coverage.

### Task 1.1: Rate Limiting

**Files:**
- Modify: `backend/main.py`
- Create: `backend/middleware/rate_limiter.py`
- Create: `tests/test_rate_limiting.py`
- Modify: `requirements.txt`

- [ ] **Step 1:** Add `slowapi==0.1.9` to `requirements.txt`

- [ ] **Step 2: Write failing test**

```python
# tests/test_rate_limiting.py
import pytest
from httpx import AsyncClient, ASGITransport
from backend.main import app

@pytest.mark.asyncio
async def test_login_rate_limited_after_5_attempts():
    """Login endpoint should return 429 after 5 failed attempts per minute."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        for i in range(5):
            await client.post("/api/v1/auth/login", json={
                "email": f"attacker{i}@test.com", "password": "wrong"
            })
        response = await client.post("/api/v1/auth/login", json={
            "email": "attacker5@test.com", "password": "wrong"
        })
        assert response.status_code == 429
```

- [ ] **Step 3: Run test — expect FAIL**

```bash
pytest tests/test_rate_limiting.py -v
```

- [ ] **Step 4: Implement rate limiter middleware**

```python
# backend/middleware/rate_limiter.py
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address, default_limits=["100/minute"])
```

- [ ] **Step 5: Wire into main.py** — add `limiter` to app state, add `SlowAPIMiddleware`, apply `@limiter.limit("5/minute")` to login and register endpoints

- [ ] **Step 6: Run test — expect PASS**
- [ ] **Step 7: Commit** `feat: add rate limiting to auth endpoints`

---

### Task 1.2: Security Headers Middleware

**Files:**
- Create: `backend/middleware/security_headers.py`
- Modify: `backend/main.py`
- Create: `tests/test_security_headers.py`

- [ ] **Step 1: Write failing test**

```python
# tests/test_security_headers.py
@pytest.mark.asyncio
async def test_responses_include_security_headers():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/health")
        assert response.headers["X-Content-Type-Options"] == "nosniff"
        assert response.headers["X-Frame-Options"] == "DENY"
        assert "Strict-Transport-Security" in response.headers
        assert "Content-Security-Policy" in response.headers
```

- [ ] **Step 2: Implement SecurityHeadersMiddleware** — Starlette BaseHTTPMiddleware that adds HSTS, CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy
- [ ] **Step 3: Wire into main.py**
- [ ] **Step 4: Run tests — expect PASS**
- [ ] **Step 5: Commit** `feat: add security headers middleware`

---

### Task 1.3: Fix GitHub OAuth Token Handling

**Files:**
- Modify: `backend/routers/auth.py`
- Create: `tests/test_oauth_security.py`

**Problem:** Token is currently passed via URL fragment (`/app/#github_token=...`), visible in browser history and logs.

- [ ] **Step 1: Write failing test** — verify token is set as httpOnly cookie, not in URL
- [ ] **Step 2: Modify GitHub callback** — set JWT as `httpOnly`, `Secure`, `SameSite=Lax` cookie instead of URL fragment
- [ ] **Step 3: Add `/api/v1/auth/me` cookie-based auth** fallback alongside Bearer token
- [ ] **Step 4: Run tests — expect PASS**
- [ ] **Step 5: Commit** `fix: secure GitHub OAuth token delivery via httpOnly cookie`

---

### Task 1.4: Complete MFA Implementation

**Files:**
- Modify: `backend/routers/auth.py`
- Modify: `backend/services/auth_service.py`
- Add: `pyotp==2.9.0` to requirements.txt
- Create: `tests/test_mfa.py`

- [ ] **Step 1: Write tests** — MFA setup generates QR URI, login with MFA requires TOTP code, invalid TOTP rejected
- [ ] **Step 2: Implement** — MFA setup returns provisioning URI, login flow checks `mfa_enabled` flag and requires `mfa_code` field, verify with `pyotp.TOTP(secret).verify(code)`
- [ ] **Step 3: Run tests — expect PASS**
- [ ] **Step 4: Commit** `feat: complete MFA/TOTP verification in login flow`

---

### Task 1.5: Standardized API Error Responses

**Files:**
- Create: `backend/middleware/error_handler.py`
- Modify: `backend/main.py`
- Create: `tests/test_error_responses.py`

- [ ] **Step 1: Define envelope** — all responses follow `{success: bool, data: T | null, error: {code: str, message: str} | null, metadata: {request_id: str}}`
- [ ] **Step 2: Write tests** for 404, 422, 500 response format
- [ ] **Step 3: Implement request ID middleware** + error handler that wraps all responses
- [ ] **Step 4: Run tests — expect PASS**
- [ ] **Step 5: Commit** `feat: standardize API error responses with request IDs`

---

### Task 1.6: Increase Test Coverage to 60%+

**Files:**
- Create: `tests/test_auth_security.py` (auth boundary tests: user A can't see user B's data)
- Create: `tests/test_asset_validation.py` (input validation edge cases)
- Create: `tests/test_notification_service.py` (notification dispatch mocking)
- Modify: `pytest.ini` (add coverage config)
- Add: `pytest-cov` to requirements.txt

- [ ] **Step 1:** Add `pytest-cov==5.0.0` to requirements.txt
- [ ] **Step 2:** Write 20+ auth boundary tests (cross-user data isolation)
- [ ] **Step 3:** Write 10+ input validation tests (malformed CPE, XSS payloads, oversized strings)
- [ ] **Step 4:** Write 10+ notification dispatch tests (mock Mailgun, Slack, webhook)
- [ ] **Step 5:** Run `pytest --cov=backend --cov-report=term-missing` — verify 60%+
- [ ] **Step 6: Commit** `test: increase coverage to 60%+ with auth, validation, and notification tests`

---

### Task 1.7: Alembic Migration Setup

**Files:**
- Create: `alembic.ini`
- Create: `alembic/env.py`
- Create: `alembic/versions/` (initial migration)
- Modify: `backend/main.py` (remove `create_all` in production)

- [ ] **Step 1:** `alembic init alembic`
- [ ] **Step 2:** Configure `env.py` to use async engine from `backend.config`
- [ ] **Step 3:** Generate initial migration: `alembic revision --autogenerate -m "initial schema"`
- [ ] **Step 4:** Test: `alembic upgrade head` on fresh database
- [ ] **Step 5:** Remove `Base.metadata.create_all` from `main.py` lifespan (use Alembic in production)
- [ ] **Step 6: Commit** `feat: add Alembic database migrations`

---

## Phase 2: Modern Frontend (React Migration)

**Goal:** Replace the 62KB vanilla JS SPA with a React + Vite frontend with proper component architecture, routing, state management, and responsive design.

**Why:** The current single-file frontend is unmaintainable and lacks features expected by paying customers (real-time updates, interactive charts, responsive tables, dark/light mode). No serious buyer will evaluate a product with a monolithic HTML file.

### Task 2.1: Project Scaffolding

**Files:**
- Create: `frontend-v2/` (Vite + React + TypeScript)
- Create: `frontend-v2/package.json`
- Create: `frontend-v2/src/main.tsx`
- Create: `frontend-v2/src/api/client.ts` (axios wrapper with interceptors)

- [ ] **Step 1:** `npm create vite@latest frontend-v2 -- --template react-ts`
- [ ] **Step 2:** Install dependencies: `npm install axios react-router-dom@6 @tanstack/react-query zustand recharts @headlessui/react clsx tailwindcss`
- [ ] **Step 3:** Configure Tailwind CSS
- [ ] **Step 4:** Create API client with JWT interceptor, error handling, and base URL config
- [ ] **Step 5: Commit** `feat: scaffold React + Vite frontend with Tailwind`

---

### Task 2.2: Authentication Pages

**Files:**
- Create: `frontend-v2/src/pages/Login.tsx`
- Create: `frontend-v2/src/pages/Register.tsx`
- Create: `frontend-v2/src/stores/authStore.ts` (Zustand)
- Create: `frontend-v2/src/components/ProtectedRoute.tsx`

- [ ] **Step 1:** Build login page with email/password + GitHub OAuth button
- [ ] **Step 2:** Build register page
- [ ] **Step 3:** Create auth store (Zustand) with login/logout/refreshToken actions
- [ ] **Step 4:** Create ProtectedRoute wrapper
- [ ] **Step 5: Commit** `feat: add React auth pages with Zustand store`

---

### Task 2.3: Dashboard with Charts

**Files:**
- Create: `frontend-v2/src/pages/Dashboard.tsx`
- Create: `frontend-v2/src/components/charts/SeverityBreakdown.tsx`
- Create: `frontend-v2/src/components/charts/AlertTrend.tsx`
- Create: `frontend-v2/src/components/charts/RiskHeatmap.tsx`
- Create: `frontend-v2/src/components/KPICard.tsx`

- [ ] **Step 1:** Build KPI cards (total alerts, critical count, assets monitored, avg risk score)
- [ ] **Step 2:** Build severity breakdown pie chart (Recharts)
- [ ] **Step 3:** Build alert trend line chart (7/30/90 day)
- [ ] **Step 4:** Build risk heatmap (assets by zone vs. severity)
- [ ] **Step 5: Commit** `feat: add dashboard with KPI cards and interactive charts`

---

### Task 2.4: Alert Management Page

**Files:**
- Create: `frontend-v2/src/pages/Alerts.tsx`
- Create: `frontend-v2/src/components/AlertTable.tsx`
- Create: `frontend-v2/src/components/AlertDetail.tsx`
- Create: `frontend-v2/src/components/FilterBar.tsx`

- [ ] **Step 1:** Build sortable, filterable alert table with pagination
- [ ] **Step 2:** Build filter bar (severity, status, date range, asset, CVE search)
- [ ] **Step 3:** Build alert detail slide-over panel (CVE info, remediation, acknowledge button)
- [ ] **Step 4:** Add bulk acknowledge action
- [ ] **Step 5: Commit** `feat: add alert management page with filtering and bulk actions`

---

### Task 2.5: Asset Inventory, OT Dashboard, Settings Pages

- [ ] Build asset inventory with CRUD modals
- [ ] Build OT dashboard (devices by zone, by protocol, sensor status)
- [ ] Build discovered devices page with promote/correlate actions
- [ ] Build settings page (profile, integrations, MFA setup, webhook config)
- [ ] Build audit log page with search
- [ ] **Commit** `feat: add asset, OT, settings, and audit log pages`

---

### Task 2.6: Build & Deploy Pipeline

- [ ] Add `frontend-v2` build step to Dockerfile (multi-stage: Node build + Python runtime)
- [ ] Serve built React app via FastAPI StaticFiles
- [ ] Update CI to run `npm run build` + `npm test`
- [ ] **Commit** `ci: add React frontend build to Docker and CI pipeline`

---

## Phase 3: Multi-Tenancy & Organization Model

**Goal:** Support multiple organizations sharing the same platform, with data isolation, team management, and role hierarchy.

**Why:** Enterprise buyers and even SMBs with multiple sites need org-level isolation. This is the #1 blocker for B2B SaaS revenue.

### Task 3.1: Organization Model

**Files:**
- Create: `backend/models/organization.py`
- Modify: `backend/models/user.py` (add `org_id` FK)
- Modify: all routers (filter by `org_id` instead of `user_id`)
- Create migration

```python
# backend/models/organization.py
class Organization(Base):
    __tablename__ = "organizations"
    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    slug = Column(String, unique=True, index=True)
    plan = Column(String, default="free")  # free | starter | pro | enterprise
    max_assets = Column(Integer, default=50)
    max_users = Column(Integer, default=3)
    created_at = Column(DateTime, default=func.now())
```

- [ ] **Step 1:** Write tests for org creation, user-org association, cross-org isolation
- [ ] **Step 2:** Implement Organization model with Alembic migration
- [ ] **Step 3:** Add `org_id` FK to User, Asset, Alert, NetworkSensor, DiscoveredDevice
- [ ] **Step 4:** Update all queries to filter by `current_user.org_id`
- [ ] **Step 5:** Add org management endpoints (create org, invite user, remove user, transfer ownership)
- [ ] **Step 6:** Run tests — verify cross-org data isolation
- [ ] **Step 7: Commit** `feat: add multi-tenant organization model with data isolation`

---

### Task 3.2: Invitation & Team Management

- [ ] Add email invitation flow (invite by email, accept invitation, assign role)
- [ ] Build team management page in frontend
- [ ] Add org-level settings (name, plan, webhook defaults)
- [ ] **Commit** `feat: add team invitation and management`

---

## Phase 4: AI-Powered Remediation Engine

**Goal:** Move beyond detection ("you have CVE-2024-1234") to actionable remediation ("here's exactly what to do about it, considering your specific environment").

**Why:** This is the #1 market gap. Every competitor detects vulnerabilities — almost none provide context-aware remediation guidance. This is the differentiator that justifies switching from a $300K enterprise tool.

### Task 4.1: Remediation Knowledge Base

**Files:**
- Create: `backend/services/remediation_engine.py`
- Create: `backend/models/remediation.py`
- Create: `tests/test_remediation.py`

```python
# backend/models/remediation.py
class RemediationAction(Base):
    __tablename__ = "remediation_actions"
    id = Column(Integer, primary_key=True)
    alert_id = Column(Integer, ForeignKey("alerts.id"))
    action_type = Column(String)  # patch | compensating_control | network_segmentation | firmware_upgrade | accept_risk
    description = Column(Text)
    estimated_downtime_minutes = Column(Integer, nullable=True)
    requires_maintenance_window = Column(Boolean, default=False)
    priority = Column(Integer)  # 1 = do first
    status = Column(String, default="proposed")  # proposed | approved | in_progress | completed | rejected
    ai_confidence = Column(Float)  # 0.0-1.0
    created_at = Column(DateTime, default=func.now())
```

- [ ] **Step 1:** Write tests for remediation generation given a CVE + asset context
- [ ] **Step 2:** Implement rule-based remediation generator:
  - If patch available → suggest patch with vendor link
  - If OT asset in control/field zone → suggest compensating control (network segmentation) instead of direct patch
  - If CISA KEV → flag as urgent, suggest immediate isolation if no patch
  - If protocol is unencrypted (Modbus/DNP3) → suggest encrypted alternative or VPN overlay
- [ ] **Step 3:** Add `/api/v1/alerts/{id}/remediations` endpoint
- [ ] **Step 4: Commit** `feat: add rule-based remediation engine`

---

### Task 4.2: LLM-Enhanced Remediation (Optional, Claude API)

**Files:**
- Create: `backend/services/ai_remediation.py`
- Modify: `backend/config.py` (add `anthropic_api_key`)

- [ ] **Step 1:** Integrate Claude API for context-aware remediation narrative generation
- [ ] **Step 2:** Prompt template: given CVE details + asset profile + network zone + criticality → generate natural-language remediation plan with step-by-step instructions
- [ ] **Step 3:** Cache LLM responses per CVE+asset_type combination (Redis, 7-day TTL)
- [ ] **Step 4:** Add "AI Remediation" tab in alert detail view
- [ ] **Step 5: Commit** `feat: add AI-powered remediation narratives via Claude API`

---

### Task 4.3: EPSS Integration (Exploit Probability)

**Files:**
- Create: `backend/services/epss_service.py`
- Modify: `backend/models/alert.py` (add `epss_score`, `epss_percentile`)
- Modify: `backend/services/alert_checker.py`

- [ ] **Step 1:** Integrate FIRST.org EPSS API (https://api.first.org/data/v1/epss)
- [ ] **Step 2:** Enrich alerts with EPSS score (probability of exploitation in next 30 days)
- [ ] **Step 3:** Add EPSS to risk scoring formula (revise weights: Vulnerability 30% + EPSS 15% + Exposure 30% + Criticality 25%)
- [ ] **Step 4:** Add EPSS column to alert table in frontend
- [ ] **Step 5: Commit** `feat: add EPSS exploit probability scoring`

---

## Phase 5: Compliance-as-Code

**Goal:** Automated, continuous compliance monitoring mapped to IEC 62443, NERC CIP, NIST CSF 2.0, and EU NIS2 — generating audit-ready evidence, not just PDF reports.

**Why:** Compliance is the #1 purchase driver in OT security. "Help me pass my audit" is the use case that gets budget approved. Current competitors generate static PDF reports; continuous compliance monitoring (like Vanta/Drata for OT) is a massive gap.

### Task 5.1: Compliance Framework Models

**Files:**
- Create: `backend/models/compliance.py`
- Create: `backend/services/compliance_engine.py`
- Create: `backend/routers/compliance.py`

```python
# backend/models/compliance.py
class ComplianceFramework(Base):
    __tablename__ = "compliance_frameworks"
    id = Column(Integer, primary_key=True)
    name = Column(String)  # "IEC 62443", "NERC CIP", "NIST CSF 2.0", "NIS2"
    version = Column(String)

class ComplianceControl(Base):
    __tablename__ = "compliance_controls"
    id = Column(Integer, primary_key=True)
    framework_id = Column(Integer, ForeignKey("compliance_frameworks.id"))
    control_id = Column(String)  # e.g., "SR 3.3", "CIP-007-7 R2"
    title = Column(String)
    description = Column(Text)
    category = Column(String)

class ComplianceAssessment(Base):
    __tablename__ = "compliance_assessments"
    id = Column(Integer, primary_key=True)
    org_id = Column(Integer, ForeignKey("organizations.id"))
    control_id = Column(Integer, ForeignKey("compliance_controls.id"))
    status = Column(String)  # compliant | non_compliant | partial | not_applicable
    evidence_type = Column(String)  # automated | manual | document
    evidence_detail = Column(Text)
    assessed_at = Column(DateTime)
    assessed_by = Column(String)  # "system" or user_id
```

- [ ] **Step 1:** Seed IEC 62443-3-3 controls (7 foundational requirements, ~50 system requirements)
- [ ] **Step 2:** Seed NIST CSF 2.0 controls (6 functions, 22 categories)
- [ ] **Step 3:** Build automated evidence collection — map existing data to controls:
  - Asset inventory exists → IEC 62443 FR1 (Access Control) partially compliant
  - Network zones assigned → IEC 62443 FR5 (Restricted Data Flow) evidence
  - Alerts acknowledged within SLA → NIST CSF RS.AN (Analysis) evidence
  - Audit logs active → NIST CSF DE.AE (Adverse Events) evidence
- [ ] **Step 4:** Build compliance dashboard (% compliant per framework, control-by-control status)
- [ ] **Step 5:** Add export to PDF/CSV for auditors
- [ ] **Step 6: Commit** `feat: add compliance-as-code engine with IEC 62443 and NIST CSF`

---

## Phase 6: SBOM & Software Composition Analysis

**Goal:** Generate and analyze Software Bills of Materials for OT assets — firmware, embedded software, and library dependencies.

**Why:** No major OT security vendor does native SBOM. EU Cyber Resilience Act (2027) mandates SBOM for all products with digital elements. Being the first affordable platform with SBOM-integrated asset management is a massive competitive advantage.

### Task 6.1: SBOM Data Model & Ingestion

**Files:**
- Create: `backend/models/sbom.py`
- Create: `backend/services/sbom_service.py`
- Create: `backend/routers/sbom.py`

```python
# backend/models/sbom.py
class SBOM(Base):
    __tablename__ = "sboms"
    id = Column(Integer, primary_key=True)
    asset_id = Column(Integer, ForeignKey("assets.id"))
    format = Column(String)  # CycloneDX | SPDX
    version = Column(String)
    source = Column(String)  # upload | scan | vendor_provided
    raw_data = Column(JSON)
    created_at = Column(DateTime, default=func.now())

class SBOMComponent(Base):
    __tablename__ = "sbom_components"
    id = Column(Integer, primary_key=True)
    sbom_id = Column(Integer, ForeignKey("sboms.id"))
    name = Column(String)
    version = Column(String)
    supplier = Column(String, nullable=True)
    purl = Column(String, nullable=True)  # Package URL
    cpe = Column(String, nullable=True)
    license = Column(String, nullable=True)
    hash_sha256 = Column(String, nullable=True)
```

- [ ] **Step 1:** Build SBOM upload endpoint (accept CycloneDX JSON/XML, SPDX JSON)
- [ ] **Step 2:** Parse SBOM into components, extract CPE/PURL identifiers
- [ ] **Step 3:** Cross-reference SBOM components with NVD CVE data — find vulnerabilities in transitive dependencies
- [ ] **Step 4:** Build SBOM viewer in frontend (component tree, vulnerability overlay)
- [ ] **Step 5:** Add "SBOM coverage" metric to compliance dashboard
- [ ] **Step 6: Commit** `feat: add SBOM ingestion, parsing, and vulnerability cross-reference`

---

## Phase 7: Network Topology Mapping & Visualization

**Goal:** Auto-generate and visualize the OT network topology using discovered devices, zones, and protocol connections.

**Why:** Network visibility is the #1 technology investment area (54% of OT organizations for 2026-2027). Visual topology maps are the single most requested feature in OT security product evaluations. Claroty and Nozomi charge premium for this.

### Task 7.1: Topology Data Model

**Files:**
- Create: `backend/models/network_connection.py`
- Create: `backend/services/topology_service.py`
- Create: `backend/routers/topology.py`

```python
class NetworkConnection(Base):
    __tablename__ = "network_connections"
    id = Column(Integer, primary_key=True)
    source_device_id = Column(Integer, ForeignKey("discovered_devices.id"))
    target_device_id = Column(Integer, ForeignKey("discovered_devices.id"))
    protocol = Column(String)  # modbus, dnp3, https, ssh, etc.
    port = Column(Integer)
    direction = Column(String)  # inbound | outbound | bidirectional
    first_seen = Column(DateTime)
    last_seen = Column(DateTime)
    bytes_transferred = Column(BigInteger, nullable=True)
    is_encrypted = Column(Boolean, default=False)
```

- [ ] **Step 1:** Build connection ingestion from sensor data (extend batch ingest API)
- [ ] **Step 2:** Build topology service (graph construction from connections + zones)
- [ ] **Step 3:** Build interactive topology visualization (React Flow / D3.js) with:
  - Purdue zone layers (Level 0-5)
  - Device nodes colored by risk score
  - Connection edges colored by protocol security (red = unencrypted, green = encrypted)
  - Click-to-drill into device details
- [ ] **Step 4: Commit** `feat: add network topology mapping and interactive visualization`

---

## Phase 8: Billing & Subscription (Stripe)

**Goal:** Enable self-service signup, plan selection, and payment via Stripe.

**Why:** Revenue. Without billing, this is a demo, not a product.

### Task 8.1: Pricing Tiers

```
Free:       Up to 10 assets, 1 user, basic CVE alerts, community support
Starter:    Up to 100 assets, 5 users, EPSS scoring, email + Slack alerts     — $499/mo
Pro:        Up to 500 assets, 20 users, compliance reports, SBOM, topology     — $1,999/mo
Enterprise: Unlimited assets, SSO/SAML, dedicated support, SLA, custom        — $4,999+/mo
```

**Files:**
- Create: `backend/services/billing_service.py`
- Create: `backend/routers/billing.py`
- Create: `backend/models/subscription.py`
- Modify: `backend/models/organization.py` (add plan enforcement)

- [ ] **Step 1:** Implement Stripe Checkout session creation
- [ ] **Step 2:** Implement Stripe webhook handler (subscription created, updated, cancelled, payment failed)
- [ ] **Step 3:** Add plan-based feature gating middleware (check `org.plan` before allowing premium features)
- [ ] **Step 4:** Build pricing page and billing settings in frontend
- [ ] **Step 5:** Add usage metering (asset count, user count) to enforce plan limits
- [ ] **Step 6: Commit** `feat: add Stripe billing with plan-based feature gating`

---

## Phase 9: SIEM/SOAR Integration Suite

**Goal:** Native integrations with the tools SOC teams already use.

**Why:** 90% of enterprise evaluations ask "does it integrate with Splunk/Sentinel?" This is table stakes for deals >$50K ARR.

### Task 9.1: Integration Framework

**Files:**
- Create: `backend/services/integrations/splunk.py`
- Create: `backend/services/integrations/sentinel.py`
- Create: `backend/services/integrations/servicenow.py`
- Create: `backend/routers/integrations.py`

Integrations to build:
- [ ] **Splunk HEC** — forward alerts as structured events to Splunk HTTP Event Collector
- [ ] **Microsoft Sentinel** — push alerts via Azure Log Analytics Data Collector API
- [ ] **ServiceNow** — create incidents from critical alerts via ServiceNow REST API
- [ ] **PagerDuty** — trigger incidents for critical/high alerts
- [ ] **Jira** — create tickets for remediation actions
- [ ] Build integration settings page (per-org configuration, test connection button)
- [ ] **Commit** `feat: add SIEM/SOAR integrations (Splunk, Sentinel, ServiceNow, PagerDuty, Jira)`

---

## Phase 10: Observability & Operational Maturity

**Goal:** Production-grade logging, metrics, tracing, and health monitoring.

**Why:** Reliability is trust. A cybersecurity platform that goes down or loses alerts is worse than no platform.

### Task 10.1: Structured Logging + Metrics

**Files:**
- Modify: `backend/logging_config.py` (JSON structured logging)
- Create: `backend/middleware/metrics.py` (Prometheus metrics)
- Create: `backend/middleware/request_id.py` (correlation IDs)
- Modify: `Dockerfile` (add prometheus endpoint)

- [ ] **Step 1:** Switch to `structlog` for JSON-formatted, correlation-ID-tagged logs
- [ ] **Step 2:** Add Prometheus metrics endpoint (`/metrics`):
  - `http_request_duration_seconds` (histogram per endpoint)
  - `alerts_generated_total` (counter by severity)
  - `cve_scraper_duration_seconds` (histogram per source)
  - `active_assets_total` (gauge per org)
- [ ] **Step 3:** Add request ID middleware (UUID per request, propagated through logs)
- [ ] **Step 4:** Add health check improvements:
  - `/health/ready` — checks database connectivity
  - `/health/live` — checks scheduler is running
- [ ] **Step 5: Commit** `feat: add structured logging, Prometheus metrics, and health checks`

---

### Task 10.2: Background Job Queue (Celery + Redis)

**Files:**
- Create: `backend/tasks/` (Celery task definitions)
- Modify: `backend/scheduler/cron.py` (dispatch to Celery instead of inline)
- Modify: `requirements.txt` (add `celery`, `redis`)
- Modify: `Dockerfile` (add Celery worker process)

- [ ] **Step 1:** Add Redis + Celery configuration
- [ ] **Step 2:** Move CVE scraping, email sending, SBOM analysis to Celery tasks
- [ ] **Step 3:** Add Celery worker to Docker Compose (separate service)
- [ ] **Step 4:** Add task monitoring (Flower or custom endpoint)
- [ ] **Step 5: Commit** `feat: add Celery + Redis background job queue`

---

## Competitive Positioning Summary

### What Makes OneAlert Win Against Incumbents

| Dimension | Incumbents (Claroty, Dragos, Nozomi) | OneAlert |
|-----------|--------------------------------------|----------|
| **Price** | $300K-$800K/yr | $499-$4,999/mo |
| **Deployment** | Hardware sensors + pro services (weeks) | Self-service SaaS signup (minutes) |
| **Target** | Fortune 500 / critical infrastructure | SMB manufacturers, water utilities, building automation |
| **SBOM** | None native | Built-in SBOM + SCA |
| **Compliance** | Static PDF reports | Continuous compliance-as-code |
| **Remediation** | Detection only | AI-powered remediation guidance |
| **Time to Value** | 3-6 months | Same day |
| **Minimum Commitment** | $200K+ annual contract | Free tier, monthly billing |

### Unique Value Proposition (One Sentence)

> **OneAlert is the only affordable, self-service OT vulnerability management platform that provides AI-powered remediation guidance and continuous compliance monitoring for SMB manufacturers — at 1/50th the cost of enterprise alternatives.**

---

## Implementation Priority Order

```
Week 1:     Phase 1 (Security Hardening)           — MUST before anything else
Week 2-3:   Phase 2 (React Frontend)               — MUST for credibility
Week 4:     Phase 3 (Multi-Tenancy)                 — MUST for B2B
Week 5-6:   Phase 4 (AI Remediation + EPSS)         — Key differentiator
Week 7-8:   Phase 5 (Compliance-as-Code)            — Revenue driver
Week 9-10:  Phase 6 (SBOM)                          — Market gap
Week 11-12: Phase 7 (Topology) + Phase 8 (Billing)  — Feature parity + Revenue
Week 13:    Phase 9 (SIEM) + Phase 10 (Observability) — Enterprise readiness
```

Total estimated timeline: **13 weeks** to market-competitive product.

---

## Quick Wins (Can Ship This Week)

These require minimal effort but signal professionalism:

1. **Enable Swagger UI** — add `docs_url="/api/docs"` to FastAPI init (1 line)
2. **Add database indexes** — composite indexes on (user_id, status) for alerts, (user_id, asset_type) for assets (5 lines)
3. **Fix CORS for production** — make origins conditional on `DEBUG` flag (3 lines)
4. **Add `/api/v1/version` endpoint** — returns version, build hash, environment (5 lines)
5. **Pin gunicorn workers to CPU** — use `--workers $(nproc)` in Dockerfile CMD (1 line)
