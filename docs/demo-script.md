# OneAlert Demo Script

**From raw Suricata alert to approved containment plan in 90 seconds.**

## Prerequisites

```bash
python -m venv .venv && source .venv/bin/activate  # or .venv\Scripts\activate on Windows
pip install -r requirements.txt
cd frontend-v2 && npm install && npm run build && cd ..
```

## Quick Start (One Command)

```bash
python -m backend.demo
```

This starts the server with seeded data including:
- 11 OT/IT assets (PLCs, HMIs, engineering workstations, network sensors)
- Multi-stage attack scenario (VPN compromise, lateral movement, PLC access attempt)
- 15+ security events from Suricata and Zeek
- Pre-built investigation case with MITRE ATT&CK mapping

## Demo Walkthrough

### 1. Login (10s)
- Open http://localhost:8000/app/
- Login: `admin@example.com` / `password123`
- Dashboard shows posture overview, active cases, event stats

### 2. View Attack Scenario (20s)
- Navigate to **Cases** page
- Open the pre-built case: "VPN Compromise - Lateral Movement to OT"
- See timeline: initial VPN access, credential reuse, RDP lateral movement, Modbus PLC scan
- Note MITRE techniques mapped: T1078 (Valid Accounts), T1021 (Remote Services), T1046 (Network Service Discovery)

### 3. Review Security Events (15s)
- Click **Events** tab
- Filter by severity: critical, high
- See Suricata alerts: "ET SCAN Nmap", "ET POLICY Modbus TCP"
- See Zeek connections: unusual RDP sessions, DNS lookups

### 4. MITRE ATT&CK Coverage (10s)
- Navigate to **MITRE Map**
- See heatmap of detected techniques across tactics
- Hover over techniques for details and linked cases

### 5. AI Triage (15s)
- Return to **Cases** and click **Run Pipeline**
- Watch AI agent correlate alerts, compute blast radius, generate case summary
- New case appears with severity, confidence score, and attack narrative

### 6. Response Plan (15s)
- Open case detail, view AI-generated response plan
- See ordered actions: notify SOC, snapshot logs, block suspicious IP
- Note policy checks: OT assets require human approval
- Click **Approve** to approve the plan

### 7. Hunt Lab (10s)
- Navigate to **Hunt Lab**
- Type: "Show me all connections to the PLC subnet in the last 24 hours"
- See AI-generated SQL query and results
- Export as Sigma detection rule

### 8. Purple Team Validation (15s)
- Navigate to **Validation**
- Create new dry-run validation with techniques T1059, T1071, T1046
- Execute and see detection coverage: which controls fired, which missed

## Key Talking Points

- **6 AI agents** working in concert: Detect, Triage, Hunt, Response, Purple, Compliance
- **Policy engine** with 5 autonomy levels (L0 read-only to L4 crisis mode)
- **OT safety constraints** - containment actions on Purdue Level 0-3 always require human approval
- **PII redaction** - secrets and PII stripped from events before LLM processing
- **No vendor lock-in** - works with Anthropic, OpenAI, Ollama, or any OpenAI-compatible endpoint
- **300+ tests** - pytest unit + Playwright E2E

## Architecture

```
Telemetry (Suricata/Zeek/Syslog) --> PII Redaction --> Event Store
                                                          |
                                                    AI Agent Runtime
                                                    (Detect -> Triage -> Hunt -> Respond)
                                                          |
                                                    Policy Engine (L0-L4)
                                                          |
                                                    Human Approval Gate
                                                          |
                                                    Action Executor
```
