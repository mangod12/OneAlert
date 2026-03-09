

# CyberSec Alert SaaS

[![CI](https://github.com/mangod12/cybersecuritysaas/actions/workflows/ci.yml/badge.svg)](https://github.com/mangod12/cybersecuritysaas/actions/workflows/ci.yml)

Production-deployed vulnerability intelligence platform that aggregates CVEs from multiple authoritative sources and automatically correlates them with enterprise assets to generate real-time prioritized alerts.

🚀 **Live Demo:**
[https://cybersec-saas-zjfau6dqcq-uc.a.run.app/](https://cybersec-saas-zjfau6dqcq-uc.a.run.app/)

🧪 **Demo Credentials:**
Email: `admin@example.com`
Password: `password123`

⚠️ **Important:** Demo requires PostgreSQL database. To set up on Cloud Run:
1. Create a Cloud SQL PostgreSQL instance
2. Set `DATABASE_URL` environment variable in Cloud Run:
   ```
   DATABASE_URL=postgresql://user:password@/dbname?host=/cloudsql/PROJECT:REGION:INSTANCE
   ```
3. Connect Cloud Run service to Cloud SQL

---

## Overview

CyberSec Alert SaaS solves a real operational security problem:

Security teams receive thousands of vulnerability disclosures daily. Most are irrelevant. Manual triage is inefficient and error-prone.

This system:

* Aggregates CVEs from NVD, Microsoft MSRC, Cisco PSIRT, Red Hat, and RSS feeds
* Enriches vulnerabilities with CVSS scoring
* Correlates vulnerabilities against user-managed asset inventory
* Automatically generates targeted alerts
* Reduces alert fatigue through asset-based filtering
* Provides centralized dashboard + notification workflows

---

## System Architecture

```
External Sources
(NVD, MSRC, Cisco, Red Hat, RSS)
        │
        ▼
Async Scraping Engine (APScheduler)
        │
        ▼
Vulnerability Enrichment Layer
        │
        ▼
Asset Correlation Engine
        │
        ▼
Alert Generation + Deduplication
        │
        ▼
Dashboard + Email Notifications
```

Deployed as a containerized FastAPI application on Google Cloud Run.

---

## Key Capabilities

### Multi-Source Aggregation

* NVD CVE feed
* Microsoft MSRC advisories
* Cisco PSIRT API
* Red Hat Security data
* Vendor RSS feeds
* CVSS enrichment

### Asset Management

* Full CRUD asset inventory
* Vendor / product / version tracking
* Asset-to-vulnerability matching
* Metadata tracking

### Alert System

* Automatic alert generation
* Severity classification (Critical → Low)
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
* Slack webhook field ready for extension

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

Login Interface
![Login](./Screenshot%202026-02-23%20152721.png)

Dashboard & Asset Management
![Dashboard](./Screenshot%202026-02-23%20152748.png)

---

## Running Locally

Install dependencies:

```
pip install -r requirements.txt
```

Setup database:

```
python scripts/setup_database.py
```

Run server:

```
uvicorn backend.main:app --reload
```

Visit: [http://localhost:8000](http://localhost:8000)

---

## Docker Deployment

```
docker compose up --build
docker compose exec app python scripts/setup_database.py
```

---

## Environment Variables

```
SECRET_KEY=your-secret-key
DATABASE_URL=postgresql+psycopg2://...
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
MAILGUN_API_KEY=...
```

---

## Roadmap (Focused)

* CPE-based asset matching
* EPSS integration
* Slack & Teams notifications
* Role-based access control (RBAC)
* Multi-tenant architecture
* CI/CD pipeline automation

---

## Repository Structure

```
backend/        FastAPI app, routers, models, services
frontend/       SPA UI
scripts/        Setup utilities
tests/          Test suite
Dockerfile      Container build
docker-compose.yml
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

