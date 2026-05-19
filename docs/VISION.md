# OneAlert AI Security OS — Vision

> An autonomous blue-team OS with controlled purple-team capabilities and
> crisis-mode containment for owned infrastructure.

## Product Vision

Build OneAlert AI Security OS: a standalone autonomous cyber-defense operating
system that watches assets, network traffic, logs, identities, vulnerabilities,
SBOMs, and topology, then coordinates AI agents for detection, triage, hunting,
remediation, containment, compliance, and authorized red-team validation.

> "An AI blue team that understands my network, investigates continuously,
> explains every decision, and can execute approved containment or validation
> actions through governed tools."

## Core Principles

1. **Autonomous, but governed** — Agents reason and propose. Risky actions require policy checks and approval. Every action has a ledger, evidence, rollback, and scope.
2. **Local-first, high-throughput AI** — Default to local/open models. Support BYO API through OpenAI-compatible adapters. Model routing by task.
3. **Security graph as the brain** — Assets, users, IPs, services, CVEs, logs, alerts, detections, SBOMs, and topology become one graph.
4. **Defensive autonomy** — Contain, isolate, revoke, rotate, notify, deceive, preserve evidence. No retaliation outside owned infrastructure.
5. **Research-safe offensive capability** — Lab mode and authorized scope only. Used to prove whether defenses work.

## Architecture

```
OneAlert AI Security OS
│
├─ Sensor Layer
│  ├─ Zeek / Suricata
│  ├─ Syslog / Windows/Linux auth logs
│  ├─ Firewall / VPN / Proxy logs
│  ├─ Cloud / IAM / SaaS events
│  └─ OT sensor / device discovery
│
├─ Data Layer
│  ├─ PostgreSQL: primary app data + events (JSONB + partitioning)
│  ├─ pgvector: semantic memory / embeddings
│  └─ Object storage: PCAPs, reports, artifacts
│
├─ AI Runtime
│  ├─ Provider abstraction (AI_PROVIDER env var)
│  ├─ Claude / OpenAI / Ollama / vLLM / llama.cpp
│  ├─ Model routing by task type
│  └─ BYO API: OpenAI-compatible endpoint
│
├─ Agent Layer
│  ├─ Detect Agent — turns events into findings
│  ├─ Triage Agent — scores risk, correlates, builds cases
│  ├─ Hunt Agent — writes and runs scoped queries
│  ├─ Response Agent — drafts and executes approved containment
│  ├─ Purple-Team Agent — validates defenses in owned/lab scope
│  ├─ Compliance Agent — maps evidence to frameworks
│  └─ Report Agent — generates human-readable case summaries
│
├─ Control Plane
│  ├─ Policy engine
│  ├─ Approval workflow
│  ├─ Scope manager
│  ├─ Tool sandbox
│  ├─ Agent ledger
│  └─ Kill switch
│
└─ UI
   ├─ Command center
   ├─ Cases / investigations
   ├─ Agent run ledger
   ├─ Network graph
   ├─ Threat hunting
   ├─ Response plans
   └─ Purple-team validation
```

## Autonomy Levels

| Level | Name | Behavior |
|-------|------|----------|
| L0 | Read-only | Summarizes and explains only |
| L1 | Assisted | Drafts hunts, detections, and response plans |
| L2 | Approved actions | Can execute after human approval |
| L3 | Guarded autonomy | Can execute low-risk containment automatically |
| L4 | Crisis mode | Aggressive defense inside owned environment |
| L5 | Disallowed | Retaliation, sabotage, third-party targeting |

**Hard constraint**: OT zones (Purdue Level 0–3) max autonomy = L2. Always.

## LLM Strategy

| Task | Runtime | Model Type |
|------|---------|------------|
| High-throughput triage | vLLM / SGLang | 14B-32B instruct |
| Detection/rule generation | vLLM | coder/security model |
| Long incident reports | vLLM | long-context model |
| Local laptop demo | Ollama | 7B-14B model |
| Edge/offline fallback | llama.cpp | quantized model |
| Embeddings | local server | bge/e5/jina class |
| BYO API | OpenAI-compatible | user-provided |

## Phased Roadmap

### MVP (12 weeks) — Ship Value Now
1. Security event ingestion (Suricata/Zeek → Postgres)
2. AI Triage Agent (alert correlation + case builder + MITRE ATT&CK)
3. Case UI (investigation timeline, evidence, recommended actions)

### Post-Revenue Expansion
4. Hunt Agent + detection generation
5. Security graph (Postgres recursive CTEs / pg_graphql)
6. Response Agent + approved containment actions
7. Deception (honeytokens, canary files, decoy services)
8. Purple-team validation (passive first: Semgrep, Trivy, replay-based)
9. AI OS UI (command center, agent ledger, crisis console)
10. Evaluation framework + research metrics

## Safety Boundaries

- No autonomous response actions on OT networks (Purdue 0-3)
- No active network scanning in SaaS mode
- No hack-back or third-party targeting
- All agent actions logged to immutable ledger
- Crisis mode requires confidence threshold + predefined action bundles
- Generated detections must be tested before deployment
