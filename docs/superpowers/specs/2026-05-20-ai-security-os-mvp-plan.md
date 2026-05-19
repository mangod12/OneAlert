# OneAlert AI Security OS — 10-Sprint MVP Plan

## Design Decisions (Locked)
- **LLM**: Provider-agnostic abstraction, Claude default, swap via `AI_PROVIDER` env var
- **Ingestion**: File upload + webhook receiver (HTTP POST from Filebeat/Fluentd)
- **Cases**: Wrap existing alerts (additive, zero breaking changes)
- **DB**: Postgres-only (JSONB + partitioning for events, pgvector later)
- **GitHub growth**: Production-quality features, stellar README, demo data, one-click deploy

---

## Sprint 1 (Week 1): AI Provider Abstraction Layer
**Goal**: Build the AI runtime foundation everything else depends on.

- `backend/services/ai/` module:
  - `provider.py` — abstract base: `complete()`, `complete_json()`, `embed()`
  - `anthropic_provider.py` — Claude implementation
  - `openai_provider.py` — OpenAI-compatible (covers OpenAI, Groq, Together, vLLM, Ollama)
  - `router.py` — model routing by task type (triage, code, embed, summarize)
  - `config.py` — AI settings (AI_PROVIDER, AI_BASE_URL, AI_TRIAGE_MODEL, etc.)
- Config env vars in `backend/config.py`
- Tests: provider mocking, routing logic
- Playwright: verify existing cloud still works

## Sprint 2 (Week 2): Security Event Data Model + Ingestion API
**Goal**: Accept Suricata EVE JSON and Zeek logs.

- `backend/models/security_event.py`:
  - `SecurityEvent` table (OCSF-inspired): timestamp, event_type, source_ip, dest_ip, source_port, dest_port, protocol, severity, raw_data (JSONB), signature, category, source_type
  - `EventSource` table: name, type (suricata/zeek/syslog/upload), status, last_seen
- `backend/services/event_ingestion.py`: batch insert, dedup
- `backend/services/parsers/`:
  - `suricata.py` — EVE JSON normalization
  - `zeek.py` — Zeek log normalization (conn.log, dns.log, http.log, ssl.log, files.log)
- `backend/routers/events.py`:
  - POST `/api/v1/events/ingest` — webhook receiver (batch JSON)
  - POST `/api/v1/events/upload` — file upload (EVE JSON / Zeek logs)
  - GET `/api/v1/events/` — paginated list with filters
  - GET `/api/v1/events/sources` — list event sources
- Alembic migration
- Seed demo Suricata/Zeek data for realistic demo
- Tests + Playwright

## Sprint 3 (Week 3-4): Case Data Model + Triage Agent Foundation
**Goal**: Cases exist, Triage Agent can correlate alerts into cases.

- `backend/models/case.py`:
  - `Case` table: title, summary, severity, status (open/investigating/resolved/closed), confidence_score, mitre_tactics (JSONB), mitre_techniques (JSONB), created_by (agent/human), user_id
  - `CaseAlert` join table: case_id, alert_id
  - `CaseEvent` join table: case_id, security_event_id
  - `CaseTimeline` table: case_id, timestamp, entry_type (event/alert/action/note), content, source (agent/human/system)
- `backend/models/agent_ledger.py`:
  - `AgentRun` table: agent_type, status, started_at, completed_at, model_used, prompt_tokens, completion_tokens, user_id
  - `AgentStep` table: run_id, step_number, action, input_summary, output_summary, tool_used, duration_ms
- `backend/services/agents/`:
  - `base.py` — BaseAgent with run/step/ledger logging
  - `triage.py` — TriageAgent: consumes alerts + events, groups by entity overlap (IP, asset, CVE, time window), calls LLM for correlation reasoning + MITRE mapping, creates Case
- `backend/routers/cases.py`:
  - GET `/api/v1/cases/` — list cases
  - GET `/api/v1/cases/:id` — case detail with timeline, alerts, events
  - POST `/api/v1/cases/:id/triage` — manually trigger triage on a case
  - POST `/api/v1/cases/auto-triage` — run triage agent on recent unprocessed alerts
- Alembic migration
- Tests + Playwright

## Sprint 4 (Week 5): MITRE ATT&CK Integration + Enrichment
**Goal**: Cases have real MITRE mappings. Triage Agent explains its reasoning.

- `backend/services/mitre/`:
  - `attack_data.py` — load MITRE ATT&CK Enterprise matrix (JSON from GitHub)
  - `mapper.py` — map alert signatures/descriptions to techniques via keyword + LLM
  - `coverage.py` — compute detection coverage across the matrix
- Enrich TriageAgent output:
  - Each case gets: tactics, techniques, confidence per mapping
  - Timeline entries include MITRE references
  - Summary includes attack narrative
- `backend/routers/mitre.py`:
  - GET `/api/v1/mitre/coverage` — detection coverage heatmap data
  - GET `/api/v1/mitre/techniques` — searchable technique list
- Seed MITRE data on startup
- Tests + Playwright

## Sprint 5 (Week 6): Case Investigation UI
**Goal**: React pages for cases — the "wow" feature.

- `frontend-v2/src/pages/Cases.tsx` — case list with severity badges, status, MITRE tags
- `frontend-v2/src/pages/CaseDetail.tsx`:
  - Investigation timeline (vertical, color-coded by entry type)
  - Related alerts panel
  - Related security events panel
  - MITRE ATT&CK technique tags with descriptions
  - AI-generated summary with confidence score
  - Affected assets visualization
  - Recommended actions panel
- `frontend-v2/src/pages/EventViewer.tsx` — security event log viewer with filters
- `frontend-v2/src/components/MitreHeatmap.tsx` — ATT&CK coverage visualization
- Sidebar navigation updates
- Tests + Playwright (including browser-based case flow)

## Sprint 6 (Week 7): Agent Orchestration + Detect Agent
**Goal**: Multi-agent pipeline. Events → Detect → Triage → Case.

- `backend/services/agents/detect.py` — DetectAgent:
  - Analyzes security events for anomalies
  - Generates detection findings (suspicious IPs, port scans, lateral movement, C2 beaconing patterns)
  - Uses LLM for contextual analysis of event clusters
- `backend/services/agents/orchestrator.py`:
  - Pipeline: ingest events → DetectAgent → findings → TriageAgent → cases
  - Runs on schedule (configurable interval) or manual trigger
  - Parallel agent execution where possible
  - Ledger logging for full auditability
- `backend/routers/agents.py`:
  - GET `/api/v1/agents/runs` — agent run history
  - GET `/api/v1/agents/runs/:id` — run detail with steps
  - POST `/api/v1/agents/detect` — manual detect run
  - POST `/api/v1/agents/pipeline` — full pipeline run
- APScheduler job for periodic agent pipeline
- Tests + Playwright

## Sprint 7 (Week 8): Hunt Agent + Detection Engineering
**Goal**: Natural-language threat hunting.

- `backend/services/agents/hunt.py` — HuntAgent:
  - Takes natural-language hunt hypothesis
  - Generates SQL queries against security_events
  - Executes queries (read-only, scoped)
  - Interprets results, suggests next steps
  - Generates Sigma/Suricata detection rules from confirmed findings
- `backend/models/detection_rule.py`:
  - `DetectionRule` table: name, description, rule_type (sigma/suricata/yara), rule_content, mitre_techniques, confidence, tested, created_by
  - `HuntSession` table: hypothesis, queries_run, findings, status, user_id
- `backend/routers/hunt.py`:
  - POST `/api/v1/hunt/` — start hunt session with hypothesis
  - GET `/api/v1/hunt/:id` — hunt session detail
  - GET `/api/v1/hunt/` — list hunt sessions
  - POST `/api/v1/detections/` — save generated detection rule
  - GET `/api/v1/detections/` — list detection rules
- `frontend-v2/src/pages/HuntLab.tsx`:
  - Natural-language input for hunt hypothesis
  - Query results display
  - Detection rule viewer/editor
- Tests + Playwright

## Sprint 8 (Week 9): Response Plans + Approval Workflow
**Goal**: AI-generated response plans with human approval gates.

- `backend/models/response_plan.py`:
  - `ResponsePlan` table: case_id, actions (JSONB), status (draft/pending_approval/approved/executing/completed), created_by, approved_by, approved_at
  - `ResponseAction` table: plan_id, action_type (notify/block_ip/disable_user/isolate_host/etc), target, parameters (JSONB), status, executed_at, result
  - `ApprovalRequest` table: plan_id, requested_by, approved_by, status, reason
- `backend/services/agents/response.py` — ResponseAgent:
  - Analyzes case context (severity, affected assets, blast radius)
  - Generates response plan with ordered actions
  - Respects autonomy levels (L0-L4)
  - OT zone check: Purdue 0-3 always requires approval
- `backend/services/policy_engine.py`:
  - Autonomy level configuration
  - Action approval rules
  - Zone-based restrictions
- `frontend-v2/src/pages/CaseDetail.tsx` — add response plan panel:
  - View AI-generated plan
  - Approve/reject actions
  - Execution status tracking
- Tests + Playwright

## Sprint 9 (Week 10-11): Command Center + GitHub Growth Polish
**Goal**: Production-quality dashboard. README becomes a recruitment goldmine.

- `frontend-v2/src/pages/CommandCenter.tsx`:
  - Security posture score
  - Active cases count + severity breakdown
  - Agent pipeline status (last run, next run, health)
  - Event ingestion rate (events/sec)
  - MITRE ATT&CK coverage percentage
  - Recent agent actions
  - Quick actions (run triage, start hunt, view cases)
- `frontend-v2/src/pages/AgentLedger.tsx`:
  - Agent run history with timeline
  - Model usage stats (tokens, cost)
  - Step-by-step run replay
- README overhaul:
  - Hero section with screenshot/GIF
  - Live demo link + credentials
  - "What makes this different" comparison table
  - Feature showcase with screenshots
  - Architecture diagram
  - One-click deploy buttons (Railway, Render, Docker)
  - Contributing guide
  - Star history badge
- Demo data: realistic multi-day security scenario (port scan → lateral movement → data staging → exfil attempt → detection → case → response)
- Tests + Playwright

## Sprint 10 (Week 12): Polish, Performance, Open-Source Launch
**Goal**: Ship-quality product. Every feature works end-to-end.

- Performance:
  - Event ingestion benchmark (target: 10K events/sec batch)
  - Query optimization on security_events (indexes, partitioning)
  - Frontend lazy loading + code splitting
- Polish:
  - Error states on all UI pages
  - Loading skeletons
  - Empty states with helpful CTAs
  - Mobile-responsive layout
  - Dark mode polish
- Documentation:
  - Update AI_CONTEXT.md, ARCHITECTURE.md, CODEMAP.md
  - API documentation (FastAPI auto-docs + examples)
  - Deployment guide (Docker, Cloud Run, Railway)
  - Contributing guide
- Open-source readiness:
  - LICENSE check
  - CONTRIBUTING.md
  - Issue templates
  - GitHub Actions: CI + Playwright E2E
  - Dependabot security fixes
  - Social preview image
- Final Playwright E2E suite covering full user journey
- Tag v2.0.0 release
