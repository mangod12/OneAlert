# OneAlert — AI Assistant Context

> This document gives AI coding assistants the full context needed to work on this codebase.
> Read this before making any changes.

## What This Is

OneAlert is an industrial OT/ICS cybersecurity SaaS platform. Target market: SMB manufacturers who can't afford $300K+/yr enterprise tools (Claroty, Dragos, Nozomi). Positioning: "Vanta of OT Security" at $499–$4,999/mo.

Live: https://cybersec-saas-ebqzvaqu6a-uc.a.run.app/app/

## Stack

| Layer | Tech | Notes |
|-------|------|-------|
| Backend | FastAPI (Python 3.11+) | Async-first, Pydantic v2 schemas |
| ORM | SQLAlchemy 2.0 async | Declarative models in `backend/models/` |
| Migrations | Alembic | 8 migration versions in `alembic/versions/` |
| Database | SQLite (dev) / PostgreSQL 16 (prod) | Auto-derived async URL in config |
| Frontend | React 19 + Vite 8 + Tailwind v4 | SPA at `frontend-v2/`, served from `/app/` |
| State | Zustand + React Query | Auth in Zustand, data fetching via React Query |
| Auth | JWT (HS256) + GitHub OAuth + TOTP MFA | Tokens in localStorage + httpOnly cookies |
| Billing | Stripe | Checkout, webhooks, plan-gated features |
| Scheduling | APScheduler (in-process async) | 6hr vuln checks, 12hr OT risk rescoring |
| CI | GitHub Actions | `pytest` on push/PR to main |
| Deploy | Docker multi-stage → Google Cloud Run | Port 8080, `start-app.sh` entry |

## Directory Structure

```
├── backend/
│   ├── main.py              # FastAPI app, lifespan, middleware, routers
│   ├── config.py            # Pydantic Settings (env vars, .env file)
│   ├── database/
│   │   ├── db.py            # Engine, sessions, FastAPI deps (get_async_db)
│   │   └── seed.py          # Demo data seeder (admin@example.com)
│   ├── models/              # SQLAlchemy models + Pydantic schemas (co-located)
│   │   ├── user.py          # User, UserCreate, UserResponse, Token
│   │   ├── alert.py         # Alert, Severity, AlertStatus, AlertListResponse
│   │   ├── asset.py         # Asset, AssetType, NetworkZone, CommunicationProtocol
│   │   ├── organization.py  # Organization (multi-tenancy)
│   │   ├── compliance.py    # ComplianceFramework, Control, Assessment
│   │   ├── remediation.py   # RemediationAction
│   │   ├── sbom.py          # SBOM, SBOMComponent
│   │   ├── subscription.py  # Subscription, PLAN_LIMITS
│   │   ├── integration_config.py  # SIEM/SOAR integration configs
│   │   ├── network_connection.py  # Topology graph edges
│   │   ├── discovered_device.py   # OT device discovery + NetworkSensor
│   │   └── audit_log.py     # AuditLog
│   ├── routers/             # API route handlers (one file per domain)
│   │   ├── auth.py          # /api/v1/auth — login, register, OAuth, MFA
│   │   ├── alerts.py        # /api/v1/alerts — list, acknowledge, EPSS, remediation
│   │   ├── assets.py        # /api/v1/assets — CRUD
│   │   ├── ot.py            # /api/v1/ot — OT discovery, sensors, risk
│   │   ├── sensor_ingest.py # /api/v1/ot — sensor data ingest
│   │   ├── organizations.py # /api/v1/orgs — multi-tenant CRUD
│   │   ├── compliance.py    # /api/v1/compliance — frameworks, assessments
│   │   ├── sbom.py          # /api/v1/sbom — upload, parse, list
│   │   ├── topology.py      # /api/v1/topology — network graph
│   │   ├── billing.py       # /api/v1/billing — Stripe checkout, webhooks
│   │   ├── integrations.py  # /api/v1/integrations — SIEM/SOAR config
│   │   └── dashboard.py     # /api/v1/dashboard — stats
│   ├── services/            # Business logic (no HTTP concerns)
│   │   ├── alert_checker.py       # Master vuln pipeline: fetch → match → alert → notify
│   │   ├── cve_scraper.py         # NVD API client
│   │   ├── vendor_scraper.py      # Multi-vendor advisory aggregator
│   │   ├── ics_cert_feed.py       # CISA KEV + ICS-CERT feeds
│   │   ├── cve_enrichment.py      # CVE enrichment service
│   │   ├── remediation_engine.py  # 5-rule OT-aware remediation generator
│   │   ├── compliance_engine.py   # Auto evidence collection → framework controls
│   │   ├── compliance_seed.py     # Seeds IEC 62443 + NIST CSF controls
│   │   ├── epss_service.py        # FIRST.org EPSS exploit probability
│   │   ├── billing_service.py     # Plan limits, feature gating
│   │   ├── ot_risk_scorer.py      # OT asset risk scoring
│   │   ├── sbom_service.py        # CycloneDX/SPDX parsing
│   │   ├── topology_service.py    # Network graph builder
│   │   ├── auth_service.py        # JWT create/verify, password hash
│   │   ├── github_auth_service.py # GitHub OAuth flow
│   │   ├── email_alert.py         # Mailgun email notifications
│   │   ├── notification_service.py# Notification dispatcher
│   │   ├── slack_webhook.py       # Slack + generic webhook senders
│   │   └── integrations/          # SIEM/SOAR connectors
│   │       ├── splunk.py          # Splunk HEC
│   │       ├── sentinel.py        # Microsoft Sentinel
│   │       ├── servicenow.py      # ServiceNow incidents
│   │       └── pagerduty.py       # PagerDuty events
│   ├── middleware/
│   │   ├── rate_limiter.py        # SlowAPI rate limiting
│   │   ├── security_headers.py    # CSP, X-Frame, HSTS, etc.
│   │   ├── request_id.py         # X-Request-ID tracing
│   │   └── metrics.py            # In-memory request metrics
│   └── scheduler/
│       └── cron.py               # APScheduler job definitions
├── frontend-v2/                   # React SPA
│   └── src/
│       ├── App.tsx               # Router: /login, /register, /, /alerts, /assets, /ot, /settings, /audit-log
│       ├── api/client.ts         # Axios instance, Bearer token interceptor
│       ├── api/types.ts          # TypeScript interfaces
│       ├── stores/authStore.ts   # Zustand auth state
│       ├── pages/                # Route-level components
│       └── components/           # Shared UI (charts, layout, KPICard, etc.)
├── tests/                        # pytest test suite (166 tests)
│   ├── conftest.py              # Sets TESTING=1, DISABLE_SCHEDULER=1
│   └── e2e/                     # Playwright E2E against Cloud Run (14 tests)
├── alembic/                      # DB migration scripts
├── Dockerfile                    # Multi-stage: Node builds React → Python runs FastAPI
├── docker-compose.yml            # Local dev with Postgres 16
└── .github/workflows/ci.yml     # GitHub Actions CI
```

## Key Data Flow

```
External Sources (NVD, CISA KEV, ICS-CERT, Cisco PSIRT, MSRC, Red Hat)
    ↓ APScheduler every 6hrs
alert_checker.check_new_vulnerabilities()
    ↓ Fetches CVEs + vendor advisories + ICS advisories
    ↓ Matches against user Assets via CPE + fuzzy vendor/product matching
    ↓ Deduplicates (checks existing alerts in DB)
    ↓ Creates Alert records
    ↓ Sends notifications (email via Mailgun, Slack webhook, generic webhook)
    ↓ Logs AuditLog entry
React Dashboard displays alerts
    ↓ User acknowledges or requests remediation
remediation_engine.generate_remediations() → 5 OT-aware rules
compliance_engine.run_automated_assessment() → maps platform data to framework controls
```

## API Conventions

- **Base path**: `/api/v1/`
- **Auth**: Bearer JWT in `Authorization` header, or `access_token` httpOnly cookie
- **Error envelope**: `{"success": false, "data": null, "error": {"code": "...", "message": "..."}, "metadata": {"request_id": "..."}}`
- **Pagination**: `?page=1&size=10` → response includes `total`, `page`, `size`, `pages`
- **User scoping**: All data queries filter by `user_id` from JWT — no cross-tenant leakage

## Auth Flow

1. **Email/password**: POST `/auth/login` (form-encoded) → JWT
2. **GitHub OAuth**: GET `/auth/github/login` → redirect → `/auth/github/callback` → httpOnly cookie
3. **MFA**: If user has MFA enabled, login requires TOTP code in `scopes[0]`
4. **Token**: JWT contains `{"sub": "user@email.com"}`, expires in 30min

## OT-Specific Concepts

- **Purdue Model Zones**: IT → DMZ → Supervisory → Control → Field → Safety System
- **Asset types**: PLC, HMI, RTU, IED, SCADA Server, Historian, Engineering Workstation
- **Protocols**: Modbus, DNP3, PROFINET, EtherNet/IP, OPC-UA, HART
- **Remediation rules**: Critical-zone OT assets get compensating controls (network segmentation) instead of direct patches; CISA KEV alerts trigger immediate isolation

## Plan Tiers

| Plan | Price | Assets | Users | Features |
|------|-------|--------|-------|----------|
| Free | $0 | 10 | 1 | Basic alerts |
| Starter | $499/mo | 100 | 5 | + SBOM, compliance |
| Pro | $1,999/mo | 500 | 20 | + integrations, topology |
| Enterprise | $4,999/mo | Unlimited | Unlimited | All features |

## Environment Variables

Required in production:
- `SECRET_KEY` — JWT signing key (app crashes on startup if default in production)
- `DATABASE_URL` — PostgreSQL connection string
- `ENVIRONMENT` — "production" | "staging" | "development"

Optional:
- `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`
- `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`
- `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`
- `SLACK_WEBHOOK_URL`, `GENERIC_WEBHOOK_URL`
- `NVD_API_KEY` — higher NVD rate limits
- `DISABLE_SCHEDULER` — skip APScheduler (used in tests)

## Testing

- **Unit/integration**: `pytest tests/` — 166 tests, SQLite-backed, scheduler disabled
- **E2E**: `cd tests/e2e && npx playwright test` — 14 tests against live Cloud Run
- **CI**: GitHub Actions runs pytest on every push/PR to main

## Common Tasks

**Add a new API endpoint**: Create handler in `backend/routers/`, register in `main.py` via `app.include_router()`.

**Add a new model**: Create in `backend/models/`, import Base from `backend/database/db`. Run `alembic revision --autogenerate -m "description"` then `alembic upgrade head`.

**Add a new frontend page**: Create in `frontend-v2/src/pages/`, add route in `App.tsx`, add sidebar link in `components/layout/Sidebar.tsx`.

**Add a new SIEM integration**: Implement `BaseIntegration` from `backend/services/integrations/base.py`, add to router in `backend/routers/integrations.py`.

**Run locally**: `pip install -r requirements.txt && python -m uvicorn backend.main:app --reload`

**Run with Docker**: `docker compose up --build`
