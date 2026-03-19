# OneAlert 2.0 – Industrial Cybersecurity Platform

[![CI](https://github.com/mangod12/OneAlert/actions/workflows/ci.yml/badge.svg)](https://github.com/mangod12/OneAlert/actions/workflows/ci.yml)
[![Deploy](https://img.shields.io/badge/Google%20Cloud%20Run-deployed-4285F4?logo=googlecloud&logoColor=white)](https://cybersec-saas-zjfau6dqcq-uc.a.run.app/)

OneAlert is a **production-ready industrial cybersecurity platform** designed for manufacturing and OT (Operational Technology) environments.

It correlates real-world assets with vulnerabilities and advisories to help organizations **prioritize and reduce risk across IT and industrial systems**.

Built as a **full-stack, cloud-native system** with real-time ingestion, asset discovery, and risk-based alerting.

---

## Live Demo

**https://cybersec-saas-zjfau6dqcq-uc.a.run.app/**

**Demo Login**
- Email: `admin@example.com`
- Password: `password123`
- Or use GitHub OAuth

---

## Real-World Use Case

Designed for industrial environments such as:
- Manufacturing plants
- Energy and utility systems
- SCADA / ICS networks
- Hybrid IT-OT infrastructures

### Problems Solved
- Lack of context in vulnerability alerts
- Manual tracking of industrial assets
- Poor visibility into OT risk exposure
- Disconnected IT and OT security workflows

---

## System Overview

Security teams are flooded with advisories, while OT environments require context-aware analysis.

OneAlert solves this by:
- Aggregating vulnerabilities from multiple sources
- Discovering and classifying OT/IT assets
- Correlating vulnerabilities with real assets
- Scoring and prioritizing risks intelligently

---

## Architecture

```
External Sources (NVD, MSRC, Cisco, Red Hat, CISA KEV, ICS Advisories)
        |
        v
Async Ingestion Engine (APScheduler)
        |
        v
Vulnerability + Advisory Enrichment
        |
        v
Asset Correlation Engine (IT/OT)
        |
        v
OT Risk Scoring + Alert Deduplication
        |
        v
Dashboard + Notifications (Email / Slack / Webhooks)
```

Deployed as a containerized FastAPI application on Google Cloud Run.

---

## Engineering Highlights

- Async backend using **FastAPI + APScheduler**
- Multi-source CVE aggregation (NVD, CISA KEV, Cisco, MSRC, Red Hat, ICS-CERT)
- Asset-to-vulnerability correlation with CPE and fuzzy matching
- OT risk scoring engine: **vulnerability (40%) + exposure (35%) + criticality (25%)**
- Passive OT device discovery pipeline with sensor ingestion API
- Cloud-native deployment (**Docker + Cloud Run + Cloud SQL**)
- CI/CD: GitHub Actions (test) + Cloud Build (deploy)
- JWT authentication + GitHub OAuth
- Scheduled background processing with APScheduler

---

## Key Capabilities

### OT / ICS Security Intelligence
- Passive OT device discovery via sensors (SNMP, Zeek, Shodan, custom agents)
- Industrial protocol detection (Modbus, DNP3, PROFINET, BACnet, and more)
- Purdue-zone aware network classification and exposure context
- ICS-CERT and vendor advisory processing with CISA KEV prioritization
- Discovered device ingestion, correlation, and promotion to managed assets

### Vulnerability Aggregation
- NVD CVE feeds
- Microsoft MSRC advisories
- Cisco PSIRT API
- Red Hat Security data
- ICS-CERT / CISA KEV catalog
- Vendor RSS feeds + CVSS enrichment

### Asset Management (IT + OT)
- Full CRUD asset inventory
- Vendor / product / version tracking
- OT-specific fields: network zone, industrial protocols, firmware, serial number
- Discovered device ingestion and promotion to managed assets
- Asset-to-vulnerability matching (CPE + fuzzy vendor/product)

### Risk & Alert System
- Automated alert generation from CVEs, vendor advisories, and ICS advisories
- Multi-factor OT risk scoring (vulnerability + exposure + criticality)
- Severity classification (Critical / High / Medium / Low)
- Deduplication engine (prevents duplicate alerts per user/asset/CVE)
- Alert acknowledgment workflow
- Audit trail logging

### Notifications
- Email alerts (Mailgun)
- Slack webhook integration
- Generic webhook support
- Per-user webhook configuration

---

## Screenshots

### Alert Management Interface

![Alert Management Interface](./Screenshot%202026-03-09%20183616.png)

### Asset Discovery and Monitoring

![Asset Discovery Dashboard](./Screenshot%202026-03-09%20183733.png)

### OT Security Overview

![OT Security Overview](./Screenshot%202026-03-09%20183739.png)

### Vulnerability Intelligence Feed

![Vulnerability Intelligence](./Screenshot%202026-03-09%20183750.png)

### Risk Analysis Dashboard

![Risk Analysis Dashboard](./Screenshot%202026-03-09%20183756.png)

---

## Tech Stack

### Backend
- FastAPI (async)
- SQLAlchemy 2.0
- PostgreSQL (Cloud SQL in production)
- SQLite (local development)
- APScheduler
- Python-JOSE (JWT)
- Passlib (bcrypt)

### Frontend
- Vanilla JavaScript SPA
- REST API integration

### Infrastructure
- Docker
- Google Cloud Run
- Cloud SQL (PostgreSQL)
- Cloud Build (auto-deploy on push)
- GitHub Actions (CI / tests)
- Nginx (optional reverse proxy)
- Gunicorn / Uvicorn

### Testing
- pytest
- pytest-asyncio

---

## Deployment

### Local Development

```bash
pip install -r requirements.txt
python scripts/setup_database.py
uvicorn backend.main:app --reload
```

Visit: http://localhost:8000/app/

For OT onboarding (sensors, discovered devices, correlation, and analytics), see [QUICKSTART.md](QUICKSTART.md).

### Production (Cloud Run)

Automatic deployment is configured. Push to `main`:

```bash
git push origin main
```

Cloud Build automatically builds the container and deploys to Cloud Run.

**First-time setup:**
1. Follow [CLOUD_SQL_SETUP.md](CLOUD_SQL_SETUP.md) to create the PostgreSQL database
2. Or run the automated script in Cloud Shell:
   ```bash
   bash scripts/setup_cloud_sql.sh YOUR_PROJECT_ID
   ```

---

## Configuration

Copy `.env.example` to `.env` and configure:

### Required
- `SECRET_KEY` - Random secret for JWT signing
- `DATABASE_URL` - PostgreSQL connection string

### Optional
- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` - GitHub OAuth
- `MAILGUN_API_KEY` / `MAILGUN_DOMAIN` - Email alerts
- `SLACK_WEBHOOK_URL` / `GENERIC_WEBHOOK_URL` - External alert delivery
- `NVD_API_KEY` - Higher rate limits for CVE data

See [.env.example](.env.example) for all options.

---

## Testing

```bash
pytest -v
```

---

## Repository Structure

```
backend/                FastAPI app, routers, models, services
  routers/              API endpoints (auth, assets, alerts, OT, sensor ingest)
  services/             Business logic & external API integrations
  models/               SQLAlchemy ORM models (user, asset, alert, discovered_device)
  database/             DB connection & seeding
  scheduler/            APScheduler cron jobs
frontend/               Vanilla JS SPA
scripts/                Deployment & setup utilities
tests/                  pytest test suite
.github/workflows/      GitHub Actions CI
cloudbuild.yaml         Cloud Build deploy pipeline
Dockerfile              Container image
```

---

## Roadmap

- CPE-based asset matching improvements
- EPSS integration for exploit probability scoring
- Active OT protocol scanning and topology mapping
- Role-based access control (RBAC)
- Multi-tenant architecture
- NERC CIP / IEC 62443 compliance reporting
- Anomaly detection for OT protocol traffic

---

## Author

**Anshaj Kumar**
Backend & Security Engineer (Industrial Systems)

---

## Why This Project Matters

This project demonstrates:

- **Production-grade backend engineering** — async FastAPI, background jobs, multi-source API integration
- **Real-world security system design** — CVE correlation, risk scoring, deduplication, audit trails
- **Industrial (OT/ICS) domain expertise** — Purdue model, protocol-aware classification, CISA KEV
- **Cloud-native deployment & CI/CD** — Docker, Cloud Run, Cloud Build, GitHub Actions
- **End-to-end system ownership** — from data ingestion to alerting to production monitoring

---

## License

MIT
