# OneAlert

Open-source OT/ICS security operations platform built with FastAPI, React, PostgreSQL, AI-assisted investigation agents, MITRE ATT&CK mapping, Suricata/Zeek event ingestion, SBOM tracking, response planning, and compliance workflows.

[![CI](https://github.com/mangod12/OneAlert/actions/workflows/ci.yml/badge.svg)](https://github.com/mangod12/OneAlert/actions/workflows/ci.yml)

## What Is In This Repo

| Area | Path | What it does |
|---|---|---|
| FastAPI backend | `backend/main.py` | Application entrypoint, middleware, health, metrics, router mounting, DB init, scheduler startup. |
| API routers | `backend/routers/` | Auth, assets, alerts, OT, organizations, compliance, SBOM, topology, billing, integrations, events, cases, MITRE, hunting, response plans, validation. |
| Domain models | `backend/models/` | Assets, alerts, cases, events, organizations, integrations, SBOM, compliance, topology, subscriptions, users. |
| Services | `backend/services/` | CVE ingestion, enrichment, notification, AI agents, compliance, MITRE, topology, policy, remediation, SIEM/webhook integrations. |
| Middleware | `backend/middleware/` | Rate limiting, request IDs, metrics, and security headers. |
| Frontend | `frontend-v2/` | React 19 + TypeScript + Vite + Tailwind application. |
| Legacy/static frontend | `frontend/`, `backend/templates/` | Static and template-based screens kept for compatibility/demo paths. |
| Migrations | `alembic/` | Alembic migrations for organizations, integrations, SBOM, compliance, network topology, subscriptions, and remediation. |
| Docs | `docs/` | Architecture, code map, AI context, screenshots, and demo notes. |
| Tests | `tests/`, `tests/e2e/` | Backend pytest suite plus Playwright E2E checks. |

## Core Capabilities

- Asset inventory for OT/IT environments.
- CVE and vendor advisory ingestion.
- Suricata and Zeek security event parsing.
- Case and investigation workflows.
- MITRE ATT&CK technique mapping.
- Natural-language hunt endpoint backed by AI services and SQL generation paths.
- Response plan generation and approval-oriented remediation flow.
- Compliance framework/control seed data.
- SBOM tracking.
- Organization and user management.
- Integration configuration for SIEM, Slack, ServiceNow, Sentinel, Splunk, PagerDuty, and webhooks.
- Metrics, request IDs, rate limiting, and security headers.

## Agent And Automation Model

The backend contains specialized services under `backend/services/agents/`:

- `detect.py` for detection-oriented analysis.
- `triage.py` for alert/case triage.
- `hunt.py` for threat hunting support.
- `response.py` for response-plan generation.
- `purple.py` for validation-style workflows.
- `compliance.py` for compliance mapping assistance.

Agent output is governed by backend policy, response-plan, audit, and validation routes. OT/ICS safety matters: the codebase is structured around human-reviewable response planning rather than blind autonomous control of industrial assets.

## Runtime Architecture

```text
FastAPI backend
  -> middleware: request ID, metrics, security headers, rate limiting
  -> routers: assets, alerts, events, cases, hunt, MITRE, response plans, SBOM, compliance
  -> services: parsers, CVE feeds, AI agents, policy, topology, notifications
  -> database: SQLAlchemy + Alembic
  -> frontend: React/Vite app and static/template fallback paths
```

## Local Development

```bash
git clone https://github.com/mangod12/OneAlert.git
cd OneAlert

python -m venv .venv
. .venv/Scripts/activate  # Windows PowerShell users can use .venv\Scripts\Activate.ps1
pip install -r requirements.txt

set SECRET_KEY=replace-with-local-dev-secret
set DATABASE_URL=sqlite+aiosqlite:///./onealert.db
uvicorn backend.main:app --reload --port 8000
```

Open:

- API root: `http://localhost:8000`
- Health: `http://localhost:8000/health`
- Readiness: `http://localhost:8000/health/ready`
- Metrics: `http://localhost:8000/metrics`
- Swagger: `http://localhost:8000/docs`

Frontend v2:

```bash
cd frontend-v2
npm install
npm run dev
```

## Configuration

Start from `.env.example`.

Important settings:

| Variable | Purpose |
|---|---|
| `SECRET_KEY` | JWT/session signing secret. |
| `DATABASE_URL` | SQLite/PostgreSQL SQLAlchemy URL. |
| `DISABLE_SCHEDULER` | Disables scheduled feed/alert jobs for local debugging. |
| `MAILGUN_API_KEY`, `MAILGUN_DOMAIN` | Optional email notification configuration. |
| `AI_PROVIDER`, `AI_BASE_URL`, `AI_API_KEY` | Optional AI provider configuration. |
| `CORS_ORIGINS` | Allowed frontend origins. |

Do not publish real production credentials in README examples.

## Tests And Quality

Backend:

```bash
python -m compileall backend/
pytest -v
```

Frontend:

```bash
cd frontend-v2
npm run lint
npm run build
```

E2E:

```bash
cd tests/e2e
npm install
npx playwright test
```

The GitHub Actions CI installs Python dependencies, compiles the backend, and runs pytest with test environment variables.

## Deployment

Deployment assets in this repo:

- `Dockerfile`
- `docker-compose.yml`
- `cloudbuild.yaml`
- `DEPLOYMENT.md`
- `CLOUD_SQL_SETUP.md`
- `scripts/deploy.py`
- `scripts/setup_cloud_sql.sh`

The configured GitHub repository homepage points to the active Cloud Run deployment. Verify the deployment health before demoing because Cloud Run services and seeded demo state can change independently of the README.

## Current Limitations

- Startup creates tables for development convenience; production schema changes should use Alembic migrations.
- The repo contains both `frontend-v2/` and legacy frontend/template paths.
- AI-backed paths need provider configuration; deterministic or non-AI service paths should remain usable without it.
- Integration senders require external service credentials to exercise end-to-end.

## License

See [License](License).
