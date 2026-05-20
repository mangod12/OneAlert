<p align="center">
  <h1 align="center">OneAlert AI Security OS</h1>
  <p align="center">
    <strong>Open-source autonomous cyber defense for industrial networks</strong>
  </p>
  <p align="center">
    AI agents that detect, investigate, hunt, and respond to threats across your OT/ICS infrastructure — with human approval gates and full audit trails.
  </p>
  <p align="center">
    <a href="https://cybersec-saas-498310931350.us-central1.run.app/app/"><strong>Live Demo</strong></a> &middot;
    <a href="#features"><strong>Features</strong></a> &middot;
    <a href="#quickstart"><strong>Quick Start</strong></a> &middot;
    <a href="#architecture"><strong>Architecture</strong></a>
  </p>
  <p align="center">
    <a href="https://github.com/mangod12/OneAlert/actions/workflows/ci.yml"><img src="https://github.com/mangod12/OneAlert/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
    <img src="https://img.shields.io/badge/tests-330%2B%20passing-brightgreen" alt="Tests">
    <img src="https://img.shields.io/badge/AI%20Agents-6%20active-blueviolet" alt="AI Agents">
    <img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License">
    <img src="https://img.shields.io/badge/Python-3.11%2B-blue" alt="Python">
    <img src="https://img.shields.io/badge/React-19-61DAFB" alt="React">
  </p>
</p>

---

## Try It Now

**Live demo:** https://cybersec-saas-498310931350.us-central1.run.app/app/

| | |
|---|---|
| Email | `admin@example.com` |
| Password | `password123` |

> Pre-loaded with a realistic water treatment plant: 11 OT/IT assets, a **multi-stage attack scenario** (VPN compromise &rarr; lateral movement &rarr; PLC access attempt), AI-generated investigation case with MITRE ATT&CK mapping, and 15+ security events.

---

## See It In Action

<p align="center">
  <img src="docs/screenshots/dashboard.png" alt="Dashboard" width="100%">
  <br><em>Security posture dashboard with KPIs, severity breakdown, and risk heatmap</em>
</p>

<table>
<tr>
<td width="50%">
<img src="docs/screenshots/case-detail.png" alt="Case Investigation" width="100%">
<br><em>AI-generated investigation case with MITRE ATT&CK mapping and attack timeline</em>
</td>
<td width="50%">
<img src="docs/screenshots/mitre-map.png" alt="MITRE ATT&CK Map" width="100%">
<br><em>MITRE ATT&CK coverage heatmap with technique search</em>
</td>
</tr>
<tr>
<td width="50%">
<img src="docs/screenshots/hunt-lab.png" alt="Hunt Lab" width="100%">
<br><em>Natural-language threat hunting with AI-generated queries</em>
</td>
<td width="50%">
<img src="docs/screenshots/events.png" alt="Security Events" width="100%">
<br><em>Suricata/Zeek security events with severity filtering</em>
</td>
</tr>
<tr>
<td width="50%">
<img src="docs/screenshots/alerts.png" alt="Alerts" width="100%">
<br><em>CVE vulnerability alerts with AI remediation</em>
</td>
<td width="50%">
<img src="docs/screenshots/assets.png" alt="Assets" width="100%">
<br><em>OT/IT asset inventory with Purdue model classification</em>
</td>
</tr>
</table>

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

Six specialized agents working as a team:

| Agent | What It Does |
|-------|-------------|
| **Detect Agent** | Analyzes event statistics for port scans, OT protocol anomalies, C2 patterns |
| **Triage Agent** | Correlates alerts + events into investigation cases with MITRE ATT&CK mapping |
| **Hunt Agent** | Takes natural-language hypotheses, generates SQL queries, outputs Sigma rules |
| **Response Agent** | Generates response plans with ordered containment actions |
| **Purple Agent** | Simulates ATT&CK techniques to validate detection coverage |
| **Compliance Agent** | Maps platform data to IEC 62443 and NIST CSF controls |

### Governed Autonomy

- **5 autonomy levels** (L0 read-only to L4 crisis mode)
- **OT safety constraint**: Purdue Level 0-3 assets always require human approval for containment
- **Full agent ledger**: Every AI decision logged with model, tokens, reasoning
- **Policy engine**: Action approval rules by zone, asset type, and autonomy level
- **Approval workflow**: Approve/reject response plans via REST API before execution
- **Action executor**: 12 action types (notify, block IP, isolate host, quarantine VLAN, etc.)

### PII and Secret Redaction

- **8 pattern types**: emails, SSNs, credit cards, API keys, bearer tokens, passwords, private keys, JWTs
- **Integrated into event ingestion**: secrets stripped before storage and LLM processing
- **Preserves network observables**: IPs, ports, domains, hostnames kept for security analysis

### Purple-Team Validation

- **Simulated ATT&CK testing**: 8 technique categories with atomic test library
- **Dry-run/lab/production modes**: production mode requires explicit human approval
- **Detection coverage metrics**: per-technique detection rates and gap analysis
- **Control result tracking**: which detection rules fired, which missed

### Semantic Search and Blast Radius

- **Natural-language case search**: TF-IDF ranking with zero external dependencies
- **Similar incident retrieval**: cosine similarity matching with shared MITRE technique highlighting
- **Blast radius graph**: entity relationship visualization (assets, IPs, MITRE techniques per case)

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

### One-Command Demo

```bash
git clone https://github.com/mangod12/OneAlert.git
cd OneAlert
pip install -r requirements.txt
python -m backend.demo
```

Open http://localhost:8000/app/ — demo data auto-loads with attack scenario.

### Docker

```bash
docker compose up --build
```

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
 │  PII Redaction  │  Purple Agent     │  OT Zone Constraints   │
 │                 │  Compliance Agent  │  Action Executor       │
 ├─────────────────┼───────────────────┼───────────────────────┤
 │  Data Layer     │   AI Runtime      │     Frontend           │
 │                 │                   │                        │
 │  PostgreSQL     │  Claude (default) │  Dashboard             │
 │  SQLite (dev)   │  OpenAI-compat    │  Cases & Investigations│
 │  Event Store    │  Ollama/vLLM      │  Events Viewer         │
 │  Agent Ledger   │  Model Routing    │  MITRE ATT&CK Map     │
 │  Semantic Search│                   │  Hunt Lab              │
 │                 │                   │  Response Plans        │
 │                 │                   │  Purple-Team Validation│
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
| CI | GitHub Actions, 330+ tests (309 pytest + 22 Playwright E2E) |

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
| `GET /api/v1/cases/search?q=` | Semantic case search |
| `GET /api/v1/cases/{id}/similar` | Find similar incidents |
| `GET /api/v1/cases/{id}/blast-radius` | Blast radius entity graph |
| `GET /api/v1/response-plans/` | List response plans |
| `POST /api/v1/response-plans/{id}/approve` | Approve a response plan |
| `POST /api/v1/response-plans/{id}/execute` | Execute approved plan |
| `POST /api/v1/validation/runs` | Create purple-team validation run |
| `POST /api/v1/validation/runs/{id}/execute` | Run ATT&CK technique tests |
| `GET /api/v1/validation/coverage` | Detection coverage by technique |

Full API docs at `/docs` when running locally.

---

## Project Structure

```
backend/
├── services/ai/          # Provider-agnostic LLM runtime
├── services/agents/       # Detect, Triage, Hunt, Response, Purple agents
├── services/mitre/        # MITRE ATT&CK integration
├── services/parsers/      # Suricata + Zeek event parsers
├── models/                # SQLAlchemy models + Pydantic schemas
├── routers/               # FastAPI route handlers
├── services/pii_redactor.py    # PII/secret redaction pipeline
├── services/action_executor.py # Response action execution
├── services/semantic_search.py # TF-IDF search + blast radius
└── services/              # CVE, compliance, billing, notifications

frontend-v2/src/
├── pages/                 # Dashboard, Cases, Events, HuntLab, MitreMap, ResponsePlans, Validation
├── components/            # Charts, layout, shared UI
└── stores/                # Zustand auth state

tests/                     # 309 pytest tests
tests/e2e/                 # Playwright E2E against Cloud Run
docs/                      # AI_CONTEXT, ARCHITECTURE, CODEMAP, VISION
```

---

## How OneAlert Compares

| Capability | OneAlert | Wazuh | SecurityOnion | OSSEC | Caldera |
|------------|:--------:|:-----:|:-------------:|:-----:|:-------:|
| AI-powered triage | Yes (6 agents) | No | No | No | No |
| MITRE ATT&CK mapping | Auto-mapped | Manual rules | Manual | No | Yes |
| OT/ICS protocol support | Modbus, S7, EtherNet/IP | Limited | Zeek-based | No | No |
| Natural-language threat hunting | Yes | No | No | No | No |
| Governed response (approval gates) | Yes (L0-L4) | No | No | No | No |
| Purple-team validation | Built-in | No | No | No | Yes (core) |
| PII redaction before LLM | Yes | N/A | N/A | N/A | N/A |
| Suricata + Zeek ingestion | Yes | Yes | Yes | No | No |
| Compliance (IEC 62443, NIST CSF) | Automated | Manual | No | No | No |
| SBOM analysis | Yes | No | No | No | No |
| Self-hostable | Yes | Yes | Yes | Yes | Yes |
| SaaS billing (Stripe) | Built-in | No | No | No | No |

**OneAlert's differentiator**: AI agents that investigate and respond, not just collect logs. Every action governed by policy with human approval for OT assets.

---

## Built For

| Industry | Use Case |
|----------|----------|
| **Water/Wastewater** | Monitor PLCs controlling chemical dosing and pump stations |
| **Manufacturing** | Protect HMIs and SCADA systems on the factory floor |
| **Energy/Utilities** | Detect lateral movement from IT to OT control networks |
| **MSSPs** | Multi-tenant SOC-as-a-Service for industrial clients |
| **Security Teams** | Purple-team validation of detection coverage |
| **Compliance** | Automated IEC 62443 and NIST CSF evidence collection |

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
