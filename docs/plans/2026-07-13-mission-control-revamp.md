# OneAlert Mission Control Implementation Plan

> **Execution:** Implement task-by-task in this session with red/green verification and a final adversarial review.

**Goal:** Deliver a cohesive, high-density Mission Control UI and fix verified security/correctness defects discovered during local testing.

**Architecture:** Preserve React/Vite/FastAPI contracts. Add small reusable presentation/state components, centralize API error normalization, rebuild the application shell, then migrate high-value routes to the shared patterns. Backend changes remain narrow and regression-tested.

**Tech Stack:** React 19, TypeScript 6, Tailwind CSS 4, React Router, Axios, Zustand, Recharts, FastAPI, SQLAlchemy, pytest, Playwright.

---

### Task 1: Baseline and regression coverage

**Files:**
- Modify: `tests/e2e/local-ui-flow.spec.ts`
- Create: `tests/e2e/ui-resilience.spec.ts`
- Modify/Create targeted `tests/test_*.py` only for confirmed backend defects.

**Steps:**
1. Run current build, lint, pytest, npm audit, and E2E prerequisites; record failures.
2. Add tests for error-envelope parsing, dashboard request failure, expired session, mobile navigation, keyboard dismissal, and retry behavior.
3. Add targeted failing security tests for each confirmed backend issue.
4. Run each test alone and confirm the intended failure before implementation.

### Task 2: Tokens and shared UI states

**Files:**
- Modify: `frontend-v2/src/index.css`
- Create: `frontend-v2/src/components/ui/AsyncState.tsx`
- Create: `frontend-v2/src/components/ui/PageHeader.tsx`
- Create: `frontend-v2/src/components/ui/StatusBadge.tsx`
- Create: `frontend-v2/src/components/ui/Panel.tsx`
- Create: `frontend-v2/src/api/errors.ts`

**Steps:**
1. Define the tinted neutral, semantic color, typography, spacing, radius, elevation, z-index, and motion tokens.
2. Implement composable loading/error/empty components with semantic live regions and retry actions.
3. Normalize Axios/backend envelope errors without exposing internals.
4. Run build/lint and the new error-path tests.

### Task 3: Application shell and navigation

**Files:**
- Modify: `frontend-v2/src/components/layout/AppLayout.tsx`
- Modify: `frontend-v2/src/components/layout/Sidebar.tsx`
- Create: `frontend-v2/src/components/layout/CommandBar.tsx`
- Modify: `frontend-v2/src/App.tsx`

**Steps:**
1. Group routes by operational intent and expose accessible active states.
2. Add sticky command bar, platform health cue, user context, skip link, and mobile drawer.
3. Support Escape/backdrop close, focus handling, body scroll safety, and reduced motion.
4. Verify desktop, tablet, and mobile navigation tests.

### Task 4: Authentication and session hardening

**Files:**
- Modify: `frontend-v2/src/api/client.ts`
- Modify: `frontend-v2/src/stores/authStore.ts`
- Modify: `frontend-v2/src/pages/Login.tsx`
- Modify: `frontend-v2/src/pages/Register.tsx`
- Modify: `frontend-v2/src/components/ProtectedRoute.tsx`

**Steps:**
1. Correctly parse standardized API errors and clear complete auth state on expiry.
2. Prevent login-request 401s from triggering session redirects.
3. Add accessible field/error relationships, progress feedback, and autocomplete attributes.
4. Verify invalid credentials, network failure, expired session, and successful navigation.

### Task 5: Dashboard insight hub

**Files:**
- Modify: `frontend-v2/src/pages/Dashboard.tsx`
- Modify: `frontend-v2/src/components/KPICard.tsx`
- Modify: `frontend-v2/src/components/charts/*.tsx`

**Steps:**
1. Fetch independent dashboard resources with partial-failure handling and freshness metadata.
2. Recompose into KPI rail, priority queue/insight hub, agent lanes, telemetry health, and analysis panels.
3. Add drill-down links and textual chart context.
4. Verify populated, zero, partial-failure, and full-failure states.

### Task 6: Operational route migration

**Files:**
- Modify: `frontend-v2/src/pages/{Cases,CaseDetail,Alerts,Events,Assets,OTDiscovery,MitreMap,HuntLab,ResponsePlans,Validation,AuditLog,Settings}.tsx`
- Modify: `frontend-v2/src/components/AlertDetail.tsx`
- Modify: `frontend-v2/src/components/Toast.tsx`

**Steps:**
1. Apply standard page headers, filters, status tokens, dense panel/table treatment, and technical typography.
2. Replace silent initial-load failures with retryable error states.
3. Differentiate empty and filtered-empty states; keep mutation failures actionable.
4. Add accessible overlay labels/dismissal and mutation-disabled states.
5. Run the full route journey and route-specific edge tests.

### Task 7: Confirmed backend/security fixes

**Files:**
- Determined by audit evidence; expected areas include `backend/services/integrations/`, auth/session middleware, and affected tests.

**Steps:**
1. State one root-cause hypothesis per confirmed defect.
2. Demonstrate a failing regression/security test.
3. Apply the smallest fix at the trust boundary.
4. Run the targeted test and the full backend suite.

### Task 8: Local visual iteration and completion gate

**Files:**
- Modify implementation/tests only where browser evidence finds a defect.

**Steps:**
1. Build frontend and run the local FastAPI app with seeded demo data.
2. Execute Playwright desktop/mobile happy and non-happy journeys.
3. Review screenshots for hierarchy, overflow, truncation, contrast, and state clarity; iterate.
4. Run fresh build, lint, pytest, E2E, npm audit, source security scan, and git diff review.
5. Apply the Devil’s Advocate pre-mortem; fix blocking findings and re-run affected gates.

## Done criteria

- All routes use the Mission Control shell and coherent tokens.
- Operational density is preserved or improved.
- Remote-data failures are visible and recoverable.
- Authentication/session edge cases behave predictably.
- Confirmed high-impact security defects are regression-tested and fixed.
- Fresh verification commands substantiate every completion claim.
