<p align="center">
  <h1 align="center">OneAlert AI Security OS</h1>
  <p align="center">
    <strong>Open-source autonomous cyber defense for industrial networks</strong>
  </p>
  <p align="center">
    AI agents that detect, investigate, hunt, and respond to threats across your OT/ICS infrastructure — with human approval gates and full audit trails.
  </p>
  <p align="center">
    <a href="https://cybersec-saas-ebqzvaqu6a-uc.a.run.app/app/"><strong>Live Demo</strong></a> &middot;
    <a href="#features"><strong>Features</strong></a> &middot;
    <a href="#quickstart"><strong>Quick Start</strong></a> &middot;
    <a href="#architecture"><strong>Architecture</strong></a>
  </p>
  <p align="center">
    <a href="https://github.com/mangod12/OneAlert/actions/workflows/ci.yml"><img src="https://github.com/mangod12/OneAlert/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
    <img src="https://img.shields.io/badge/tests-250%2B%20passing-brightgreen" alt="Tests">
    <img src="https://img.shields.io/badge/AI%20Agents-5%20active-blueviolet" alt="AI Agents">
    <img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License">
    <img src="https://img.shields.io/badge/Python-3.11%2B-blue" alt="Python">
    <img src="https://img.shields.io/badge/React-19-61DAFB" alt="React">
  </p>
</p>

---

## Try It Now

**Live demo:** https://cybersec-saas-ebqzvaqu6a-uc.a.run.app/app/

| | |
|---|---|
| Email | `admin@example.com` |
| Password | `password123` |

> Pre-loaded with a realistic water treatment plant: 11 OT/IT assets, a **multi-stage attack scenario** (VPN compromise &rarr; lateral movement &rarr; PLC access attempt), AI-generated investigation case with MITRE ATT&CK mapping, and 15+ security events.

---

## Why This Exists

Enterprise SOC tools cost $300K-$800K/yr. SMB manufacturers with PLCs, SCADA systems, and OT networks can't afford them — but they're increasingly targeted. OneAlert gives them an **AI blue team** that:

- Ingests Suricata/Zeek network telemetry
- Detects anomalies with AI agents (not just static rules)
- Correlates alerts into investigation cases with MITRE ATT&CK mapping
- Generates response plans with human approval gates
- Hunts for threats using natural language
- Enforces OT safety constraints (no autonomous actions on PLCs)

---

## Features

### AI Agent Pipeline

Five specialized agents working as a team:

| Agent | What It Does |
|-------|-------------|
| **Detect Agent** | Analyzes event statistics for port scans, OT protocol anomalies, C2 patterns |
| **Triage Agent** | Correlates alerts + events into investigation cases with MITRE ATT&CK mapping |
| **Hunt Agent** | Takes natural-language hypotheses, generates SQL queries, outputs Sigma rules |
| **Response Agent** | Generates response plans with ordered containment actions |
| **Compliance Agent** | Maps platform data to IEC 62443 and NIST CSF controls |

### Governed Autonomy

- **5 autonomy levels** (L0 read-only to L4 crisis mode)
- **OT safety constraint**: Purdue Level 0-3 assets always require human approval for containment
- **Full agent ledger**: Every AI decision logged with model, tokens, reasoning
- **Policy engine**: Action approval rules by zone, asset type, and autonomy level

### Security Event Ingestion

- **Suricata EVE JSON** parser (alerts, DNS, HTTP, TLS, flows)
- **Zeek log** parser (conn, dns, http, ssl, files, notice)
- **Webhook receiver** for Filebeat/Fluentd real-time ingestion
- **File upload** for offline analysis

### MITRE ATT&CK Integration

- Enterprise + ICS matrix (16 tactics, 30+ techniques)
- Auto-mapping from Suricata signatures to techniques
- Detection coverage heatmap per tactic
- Searchable technique browser

### Threat Hunt Lab

- Natural-language input: *"Look for lateral movement from engineering workstation to PLC subnet"*
- AI generates SQL queries against your event data
- Auto-generated Sigma detection rules from confirmed findings
- Read-only query safety validation (blocks INSERT/UPDATE/DELETE)

### OT/ICS Vulnerability Management

- Multi-source CVE aggregation (NVD, CISA KEV, ICS-CERT, Cisco PSIRT, Microsoft MSRC)
- AI-powered OT-aware remediation (compensating controls for critical zones)
- EPSS exploit probability scoring
- SBOM analysis (CycloneDX/SPDX)
- Passive device discovery with Purdue model classification

### Compliance-as-Code

- IEC 62443-3-3 (10 controls) + NIST CSF 2.0 (11 controls)
- Automated evidence collection from platform data
- Continuous compliance scoring

### Multi-Tenancy and Billing

- Organization model with role-based access (admin/analyst/viewer)
- Stripe billing (Free, Starter $499, Pro $1,999, Enterprise $4,999/mo)
- SIEM integrations (Splunk, Sentinel, ServiceNow, PagerDuty)

---

## Quickstart

### Docker (recommended)

```bash
git clone https://github.com/mangod12/OneAlert.git
cd OneAlert
docker compose up --build
```

Open http://localhost:8000/app/ — demo data auto-loads.

### Local Development

```bash
# Backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m uvicorn backend.main:app --reload

# Frontend
cd frontend-v2 && npm install && npm run dev
```

### Environment Variables

```bash
# Required for AI agents
AI_PROVIDER=anthropic          # or openai, ollama, vllm, groq
ANTHROPIC_API_KEY=sk-ant-...   # or AI_API_KEY for OpenAI-compatible

# Optional
AI_TRIAGE_MODEL=claude-sonnet-4-20250514
AI_BASE_URL=http://localhost:11434/v1  # for Ollama/vLLM
SECRET_KEY=your-production-secret
DATABASE_URL=postgresql://user:pass@host/db
```

---

## Architecture

```
                      OneAlert AI Security OS
 ┌─────────────────┬───────────────────┬───────────────────────┐
 │  Sensor Layer   │   Agent Layer     │     Control Plane      │
 │                 │                   │                        │
 │  Suricata EVE   │  Detect Agent     │  Policy Engine         │
 │  Zeek Logs      │  Triage Agent     │  Autonomy Levels       │
 │  Syslog/Auth    │  Hunt Agent       │  Approval Workflow     │
 │  OT Discovery   │  Response Agent   │  Agent Ledger          │
 │                 │  Compliance Agent  │  OT Zone Constraints   │
 ├─────────────────┼───────────────────┼───────────────────────┤
 │  Data Layer     │   AI Runtime      │     Frontend           │
 │                 │                   │                        │
 │  PostgreSQL     │  Claude (default) │  Dashboard             │
 │  SQLite (dev)   │  OpenAI-compat    │  Cases & Investigations│
 │  Event Store    │  Ollama/vLLM      │  Events Viewer         │
 │  Agent Ledger   │  Model Routing    │  MITRE ATT&CK Map     │
 │                 │                   │  Hunt Lab              │
 └─────────────────┴───────────────────┴───────────────────────┘
```

### Data Flow

```
Suricata/Zeek Events ──► Ingest API ──► Event Store
                                            │
                                       Detect Agent (anomaly detection)
                                            │
CVE Alerts (NVD/CISA/ICS-CERT) ──► Triage Agent (correlation + MITRE)
                                            │
                                       Investigation Cases
                                            │
                                       Response Agent (governed plans)
                                            │
                                  Human Approval ──► Execute Actions
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | FastAPI, Python 3.11+, SQLAlchemy 2.0 async |
| Frontend | React 19, Vite 8, Tailwind CSS v4, Zustand, Recharts |
| AI Runtime | Provider-agnostic (Claude, GPT-4o, Ollama, vLLM, Groq) |
| Database | PostgreSQL (prod), SQLite (dev) |
| Auth | JWT + GitHub OAuth + TOTP MFA |
| Deploy | Docker, Google Cloud Run |
| CI | GitHub Actions, 250+ tests, Playwright E2E |

---

## API Overview

| Endpoint | Description |
|----------|-------------|
| `POST /api/v1/events/ingest` | Webhook receiver for security events |
| `POST /api/v1/events/upload` | Upload Suricata/Zeek log files |
| `POST /api/v1/cases/pipeline` | Run full AI agent pipeline |
| `POST /api/v1/cases/auto-triage` | Run triage agent on recent data |
| `POST /api/v1/hunt/` | Start natural-language threat hunt |
| `GET /api/v1/mitre/coverage` | MITRE ATT&CK detection coverage |
| `GET /api/v1/cases/` | List investigation cases |
| `GET /api/v1/alerts/` | List vulnerability alerts |
| `GET /api/v1/events/stats` | Event ingestion statistics |

Full API docs at `/docs` when running locally.

---

## Project Structure

```
backend/
├── services/ai/          # Provider-agnostic LLM runtime
├── services/agents/       # Detect, Triage, Hunt, Response agents
├── services/mitre/        # MITRE ATT&CK integration
├── services/parsers/      # Suricata + Zeek event parsers
├── models/                # SQLAlchemy models + Pydantic schemas
├── routers/               # FastAPI route handlers
└── services/              # CVE, compliance, billing, notifications

frontend-v2/src/
├── pages/                 # Cases, Events, HuntLab, MitreMap, Dashboard
├── components/            # Charts, layout, shared UI
└── stores/                # Zustand auth state

tests/                     # 250+ pytest tests
tests/e2e/                 # Playwright E2E against Cloud Run
docs/                      # AI_CONTEXT, ARCHITECTURE, CODEMAP, VISION
```

---

## Contributing

Contributions welcome! Areas where help is most valuable:

- **New event parsers**: Windows Event Log, AWS CloudTrail, Azure Activity
- **MITRE coverage**: More technique mappings and detection rules
- **Sigma ecosystem**: Import/export Sigma rules, test against event data
- **UI/UX**: Dashboard widgets, case visualization, topology graph
- **OT protocols**: Additional ICS protocol parsers (BACnet, HART-IP)

---

## License

MIT — see [License](License).

---

<p align="center">
  <strong>Built for the security teams that can't afford a $500K SOC platform but still need one.</strong>
</p>
