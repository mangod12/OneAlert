# OneAlert Codemap

> Quick-reference: where to find things. For AI assistants doing targeted edits.

## Backend Entry Points

| What | File | Key Symbols |
|------|------|-------------|
| App creation | `backend/main.py` | `app`, `lifespan()` |
| Config/env vars | `backend/config.py` | `Settings`, `settings` |
| DB engine/sessions | `backend/database/db.py` | `get_async_db()`, `Base`, `AsyncSessionLocal` |
| Demo data seed | `backend/database/seed.py` | `seed_database()` |

## Models (SQLAlchemy + Pydantic co-located)

| Model | File | Table | Key Fields |
|-------|------|-------|------------|
| User | `backend/models/user.py` | `users` | email, role, org_id, mfa_enabled, github_id |
| Organization | `backend/models/organization.py` | `organizations` | name, slug, plan, max_assets |
| Asset | `backend/models/asset.py` | `assets` | name, vendor, product, is_ot_asset, network_zone, primary_protocol |
| Alert | `backend/models/alert.py` | `alerts` | cve_id, severity, cvss_score, status, asset_id |
| RemediationAction | `backend/models/remediation.py` | `remediation_actions` | action_type, priority, ai_confidence, alert_id |
| ComplianceFramework | `backend/models/compliance.py` | `compliance_frameworks` | name, version |
| ComplianceControl | `backend/models/compliance.py` | `compliance_controls` | control_id, title, framework_id |
| ComplianceAssessment | `backend/models/compliance.py` | `compliance_assessments` | status, evidence_type, user_id, control_id |
| SBOM | `backend/models/sbom.py` | `sboms` | format, asset_id |
| SBOMComponent | `backend/models/sbom.py` | `sbom_components` | name, version, purl, cpe |
| Subscription | `backend/models/subscription.py` | `subscriptions` | plan, stripe_subscription_id, org_id |
| IntegrationConfig | `backend/models/integration_config.py` | `integration_configs` | provider, config_json |
| NetworkConnection | `backend/models/network_connection.py` | `network_connections` | source_asset_id, target_asset_id, protocol |
| DiscoveredDevice | `backend/models/discovered_device.py` | `discovered_devices` | ip_address, mac_address, protocols |
| NetworkSensor | `backend/models/discovered_device.py` | `network_sensors` | name, sensor_type, status |
| AuditLog | `backend/models/audit_log.py` | `audit_logs` | action, target_type, target_id |

## Routers (API Endpoints)

| Prefix | File | Key Endpoints |
|--------|------|---------------|
| `/api/v1/auth` | `backend/routers/auth.py` | POST login, POST register, GET me, GET github/login, POST mfa/setup, POST mfa/verify, GET audit-logs |
| `/api/v1/assets` | `backend/routers/assets.py` | GET /, POST /, GET /:id, PUT /:id, DELETE /:id |
| `/api/v1/alerts` | `backend/routers/alerts.py` | GET /, GET /:id, PATCH /:id, POST /:id/acknowledge, GET /:id/remediations, GET /:id/epss, GET /stats/overview |
| `/api/v1/ot` | `backend/routers/ot.py` | GET /devices, POST /devices/:id/promote, GET /sensors, POST /sensors |
| `/api/v1/ot` | `backend/routers/sensor_ingest.py` | POST /sensors/:id/ingest |
| `/api/v1/orgs` | `backend/routers/organizations.py` | POST /, GET /me, PUT /me, POST /invite, GET /members |
| `/api/v1/compliance` | `backend/routers/compliance.py` | GET /frameworks, GET /frameworks/:id/controls, GET /assessments, POST /assessments, POST /assess/auto |
| `/api/v1/sbom` | `backend/routers/sbom.py` | POST /upload, GET /, GET /:id/components, DELETE /:id |
| `/api/v1/topology` | `backend/routers/topology.py` | POST /connections, POST /connections/batch, GET /connections, GET /graph, GET /stats |
| `/api/v1/billing` | `backend/routers/billing.py` | POST /checkout, POST /webhook, GET /plans, GET /subscription |
| `/api/v1/integrations` | `backend/routers/integrations.py` | GET /, POST /, PUT /:id, DELETE /:id, POST /:id/test |

## Services (Business Logic)

| Service | File | Entry Function |
|---------|------|----------------|
| Vulnerability pipeline | `backend/services/alert_checker.py` | `alert_checker.check_new_vulnerabilities()` |
| NVD CVE fetcher | `backend/services/cve_scraper.py` | `cve_scraper.fetch_recent_cves()` |
| Vendor advisories | `backend/services/vendor_scraper.py` | `vendor_scraper.fetch_all_vendor_advisories()` |
| ICS-CERT/CISA KEV | `backend/services/ics_cert_feed.py` | `ics_cert_feed_service.fetch_cisa_kev()` |
| CVE enrichment | `backend/services/cve_enrichment.py` | `CVEEnrichmentService.enrich_cve()` |
| Remediation | `backend/services/remediation_engine.py` | `generate_remediations(alert, asset)` |
| Compliance | `backend/services/compliance_engine.py` | `run_automated_assessment(user_id, db)` |
| EPSS scores | `backend/services/epss_service.py` | `get_epss_score(cve_id)` |
| SBOM parsing | `backend/services/sbom_service.py` | parse CycloneDX/SPDX JSON |
| Billing/plan limits | `backend/services/billing_service.py` | `check_feature_access()`, `check_asset_limit()` |
| OT risk scoring | `backend/services/ot_risk_scorer.py` | `ot_risk_scorer.score_managed_asset()` |
| Topology | `backend/services/topology_service.py` | graph building |
| Auth (JWT/hash) | `backend/services/auth_service.py` | `create_access_token()`, `verify_token()`, `get_password_hash()` |
| GitHub OAuth | `backend/services/github_auth_service.py` | `github_auth_service.authenticate_user()` |
| Email | `backend/services/email_alert.py` | `email_service.send_vulnerability_alert()` |
| Slack/webhook | `backend/services/slack_webhook.py` | `SlackNotificationService.send()` |
| Splunk | `backend/services/integrations/splunk.py` | Splunk HEC sender |
| Sentinel | `backend/services/integrations/sentinel.py` | Log Analytics API |
| ServiceNow | `backend/services/integrations/servicenow.py` | Incident creator |
| PagerDuty | `backend/services/integrations/pagerduty.py` | Event trigger |

## Frontend Pages

| Route | File | What It Shows |
|-------|------|---------------|
| `/app/login` | `frontend-v2/src/pages/Login.tsx` | Email/password + GitHub OAuth |
| `/app/register` | `frontend-v2/src/pages/Register.tsx` | Registration form |
| `/app/` | `frontend-v2/src/pages/Dashboard.tsx` | KPI cards, severity chart, alert trend, risk heatmap |
| `/app/alerts` | `frontend-v2/src/pages/Alerts.tsx` | Alert table with filters, acknowledge action |
| `/app/assets` | `frontend-v2/src/pages/Assets.tsx` | Asset CRUD, OT fields |
| `/app/ot` | `frontend-v2/src/pages/OTDiscovery.tsx` | Discovered devices, promote to asset |
| `/app/settings` | `frontend-v2/src/pages/Settings.tsx` | Profile, integrations, MFA |
| `/app/audit-log` | `frontend-v2/src/pages/AuditLog.tsx` | Admin audit trail |

## Test Files

| File | Coverage Area |
|------|--------------|
| `tests/test_api.py` | Core API endpoints |
| `tests/test_alert_logic.py` | Alert checker matching logic |
| `tests/test_billing.py` | Stripe billing flows |
| `tests/test_compliance.py` | Compliance engine + assessments |
| `tests/test_epss.py` | EPSS service |
| `tests/test_integrations.py` | SIEM/SOAR integrations |
| `tests/test_mfa.py` | MFA setup/verify |
| `tests/test_organizations.py` | Multi-tenancy, org isolation |
| `tests/test_remediation.py` | Remediation engine rules |
| `tests/test_sbom.py` | SBOM upload/parse |
| `tests/test_topology.py` | Network topology |
| `tests/test_security_headers.py` | Security header middleware |
| `tests/test_rate_limiting.py` | Rate limiter config |
| `tests/test_observability.py` | Metrics/logging |
| `tests/test_error_responses.py` | Error envelope format |
| `tests/test_oauth_cookie.py` | OAuth cookie handling |
| `tests/test_scraper.py` | CVE/vendor scrapers |
| `tests/e2e/cloud-verify.spec.ts` | Playwright E2E (14 tests) |
