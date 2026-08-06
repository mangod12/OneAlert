# OneAlert Mission Control Redesign

## Goal

Revamp the entire React frontend into a cohesive, high-density OT security operations workspace while fixing confirmed failure-path, accessibility, and security defects.

## Research synthesis

Current competitor material points to four durable patterns: asset-first segmentation (Claroty), global-to-site health (Nozomi), a prioritized cross-domain insight hub (Dragos), and role-specific interactive drill-downs (Tenable OT). Marketplace research adds grouped navigation, sticky working controls, dense tables, and responsive drawers from established Tailwind/React dashboard systems.

OneAlert will combine these patterns without copying a competitor’s brand or screen composition. Its differentiator remains governed AI agents and OT-safe response approval.

## Information architecture

Navigation is grouped by analyst intent:

- Command: Overview, Investigations.
- Observe: Alerts, Events, Assets, OT Discovery.
- Analyze: MITRE ATT&CK, Hunt Lab.
- Act: Response Plans, Validation.
- Govern: Audit Log, Settings.

The command bar provides current page context, platform status, a compact quick-search affordance, and mobile navigation. Page structure stays consistent while allowing specialized dense work surfaces.

## Dashboard

The dashboard becomes a prioritized starting point rather than a collection of equal cards. It shows freshness and partial failures explicitly, a compact risk/asset KPI rail, prioritized operational queues, agent lane status, telemetry health, severity/trend analysis, and OT zone risk. Summary elements provide obvious drill-down routes.

## Operational pages

List pages retain dense data and add consistent headers, filter bars, result counts, loading skeletons, retryable failures, filtered-empty differentiation, and responsive overflow. Investigation and response views keep context visible around decisions. Risky actions expose approval/safety state and require clear confirmation where consequences are material.

## Authentication and session behavior

Authentication screens use the same visual identity with explicit field relationships, accessible errors, submit progress, and credible platform context. API errors are normalized from the backend envelope. Expired sessions clear all auth state and redirect predictably without confusing login failures.

## Error and edge-case model

- A failed dashboard request does not render a healthy zero; successful sections remain visible and failed sections identify themselves.
- Initial-load failures expose retry.
- Empty data, filtered-empty data, and permission failures have different copy/actions.
- Repeated clicks are prevented while mutations run.
- Invalid route/resource IDs render a recovery path.
- Mobile navigation is reachable, closable, and does not trap background interaction.

## Security scope

The audit covers token storage/cookie behavior, auth and tenant boundaries, validation, CSP/CORS, unsafe outbound TLS, uploads, rate limits, dependency advisories, and sensitive logging. Only confirmed, regression-tested defects are changed.

## Verification

- Frontend TypeScript build and ESLint.
- Backend pytest suite and targeted regression tests.
- npm dependency audit and source security scan.
- Playwright happy/non-happy journeys at mobile and desktop sizes.
- Keyboard/focus, reduced-motion, error, empty, and expired-session checks.
- Fresh local screenshots reviewed against this specification.
