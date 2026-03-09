

# CyberSec Alert SaaS

[![CI](https://github.com/mangod12/cybersecuritysaas/actions/workflows/ci.yml/badge.svg)](https://github.com/mangod12/cybersecuritysaas/actions/workflows/ci.yml)

OneAlert 2.0 is an industrial-grade vulnerability intelligence platform built for hybrid IT/OT environments. It combines multi-source CVE aggregation with passive OT discovery, industrial advisory ingestion, and asset-aware alerting to reduce risk across enterprise and operational technology estates.

🚀 **Live Demo:**
[https://cybersec-saas-zjfau6dqcq-uc.a.run.app/](https://cybersec-saas-zjfau6dqcq-uc.a.run.app/)

🧪 **Demo Login:**
- Email: `admin@example.com` / Password: `password123`
- Or use **GitHub OAuth** login

**Tech:** FastAPI + SQLAlchemy + PostgreSQL/Cloud SQL + Cloud Run + Cloud Build CI/CD

---

## Overview

Security teams are flooded with advisories, while OT teams need context that generic scanners rarely provide. OneAlert 2.0 addresses this by unifying vulnerability intelligence and OT-aware asset context in one workflow.

This platform:

* Aggregates vulnerabilities and advisories from NVD, MSRC, Cisco, Red Hat, CISA KEV, and ICS/vendor sources
* Performs passive network asset discovery with sensor support
* Detects industrial protocols and classifies assets by Purdue-style network zones
* Scores risk using vulnerability, exposure, and criticality factors
* Correlates alerts directly to discovered and managed OT/IT assets
* Supports notification and cloud-native deployment patterns

---

## System Architecture

```
External Sources
(NVD, MSRC, Cisco, Red Hat, CISA KEV, ICS Advisories)
        │
        ▼
Async Scraping Engine (APScheduler)
        │
        ▼
Vulnerability + Advisory Enrichment
        │
        ▼
Asset Correlation Engine (IT/OT)
        │
        ▼
Risk Scoring + Alert Deduplication
        │
        ▼
Dashboard + Notifications (Email/Slack/Webhook)
```

Deployed as a containerized FastAPI application on Google Cloud Run.

---

## Key Capabilities

### OT/ICS Security Intelligence

* Passive discovery pipeline for OT devices via sensors (SNMP, Zeek, Shodan, custom)
* Industrial protocol detection (Modbus, DNP3, PROFINET, BACnet, and more)
* Purdue-zone aware network classification and exposure context
* ICS-CERT and vendor advisory processing with CISA KEV prioritization

### Vulnerability Aggregation

* NVD CVE feed
* Microsoft MSRC advisories
* Cisco PSIRT API
* Red Hat Security data
* Vendor RSS feeds
* CVSS enrichment

### Asset Management (IT + OT)

* Full CRUD asset inventory
* Vendor / product / version tracking
* Discovered device ingestion and promotion to managed assets
* Asset-to-vulnerability matching
* Metadata tracking

### Risk & Alert System

* Automatic alert generation
* Multi-factor risk scoring (vulnerability + exposure + criticality)
* Severity classification (Critical to Low)
* Deduplication
* Alert acknowledgment workflow
* Dashboard visibility

### Authentication & Security

* Secure password hashing (bcrypt)
* JWT-based authentication
* GitHub OAuth login
* Token validation middleware

### Notifications

* Email integration (Mailgun)
* Dashboard alert visibility
* Slack and generic webhook support

---

## Tech Stack

Backend:

* FastAPI (async)
* SQLAlchemy 2.0
* PostgreSQL (production)
* SQLite (local dev)
* APScheduler
* Python-JOSE (JWT)
* Passlib (bcrypt)

Frontend:

* Vanilla JavaScript SPA
* REST API integration

Infrastructure:

* Docker
* Google Cloud Run (production)
* Cloud SQL PostgreSQL (production)
* Cloud Build auto-deploy pipeline
* Nginx (optional reverse proxy)
* Gunicorn/Uvicorn ASGI server

Testing:

* pytest
* pytest-asyncio

---

## Production Deployment

Hosted on: **Google Cloud Run**

* Containerized via Docker
* Managed PostgreSQL database
* Async API architecture
* Environment-based configuration
* Secure secret management

---

## Screenshots

### Updated Login Experience

![OneAlert login interface](./Screenshot%202026-02-23%20152721.png)

### Dashboard, Assets, and Integrations

![OneAlert dashboard and asset management](./Screenshot%202026-02-23%20152748.png)

To add additional OT dashboard, sensor management, and analytics screenshots, place image files in the repo root or a docs folder and reference them here.

---

## Quick Start

### Local Development

```bash
# Install dependencies
pip install -r requirements.txt

# Setup database (creates tables and seeds demo user)
python scripts/setup_database.py

# Run development server
uvicorn backend.main:app --reload
```

Visit: http://localhost:8000/app/

For OT onboarding (sensors, discovered devices, correlation, and analytics), see [QUICKSTART.md](QUICKSTART.md).

### Production Deployment (Google Cloud Run)

**Automatic deployment is configured!** Just push to `main`:

```bash
git push origin main
```

The Cloud Build trigger automatically builds and deploys to Cloud Run.

**First-time setup:**
1. Follow [CLOUD_SQL_SETUP.md](CLOUD_SQL_SETUP.md) to create PostgreSQL database
2. Or run the automated script in Cloud Shell:
   ```bash
   bash scripts/setup_cloud_sql.sh YOUR_PROJECT_ID
   ```

---

## Configuration

Copy `.env.example` to `.env` and configure:

**Required:**
- `SECRET_KEY` - Random secret for JWT signing
- `DATABASE_URL` - PostgreSQL connection string

**Optional:**
- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` - For GitHub OAuth
- `MAILGUN_API_KEY` / `MAILGUN_DOMAIN` - For email alerts
- `SLACK_WEBHOOK_URL` / `GENERIC_WEBHOOK_URL` - For external alert delivery
- `NVD_API_KEY` - For CVE data (higher rate limits)

See [.env.example](.env.example) for full configuration options.

---

## Roadmap

* CPE-based asset matching
* EPSS integration
* Slack & Teams notifications
* OT protocol-level scanning and topology awareness
* Role-based access control (RBAC)
* Multi-tenant architecture
* CI/CD pipeline automation

---

## Repository Structure

```
backend/              FastAPI app, routers, models, services
  ├── routers/        API endpoints
  ├── services/       Business logic & external API integrations
  ├── models/         SQLAlchemy ORM models
  └── database/       DB connection & seeding
frontend/             Vanilla JS SPA
scripts/              Deployment & setup utilities
tests/                pytest test suite
.github/workflows/    CI/CD pipelines
  ├── ci.yml          Tests on PR
  └── deploy.yml      Auto-deploy on push
cloudbuild.yaml       Cloud Build configuration
Dockerfile            Container image
```

---

## Why This Project Matters

This project demonstrates:

* Async backend architecture
* External API integration
* Scheduled background jobs
* Secure authentication systems
* Asset correlation logic
* Production deployment experience
* Containerization & cloud deployment

---

## License

MIT

