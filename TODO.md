# TODO — ai-gateway-demo

Current work items. Keep current with changes (see `~/src/AGENTS.md` minimum-files rule).

## Open

- [x] **Gateway-mode browser caching: investigated to conclusion (2026-10-29).** Platform regression since ~mid-Aug 2026 — per-request Access credential defeats the cache key. All client-side remedies tested and closed; `autoCacheKey` and `GATEWAY_RUN_TOKEN` workarounds removed as disproven. Worker mode is the caching demo. -> **File the AIG Jira ticket** (draft: `~/src/notes/misc/aig-cache-key-credential-ticket.md`, label `uat-aig-identity`) — now with before/after log-scan evidence (75 historical browser HITs -> zero today under identical request shape).
- [ ] **Node 22 -> 24** — CI + docs pin Node 22; external baseline (endoflife.date, 2026-10-29) says production projects should run Active/Maintenance LTS (>=24). One-line CI + docs change. User-approved pending.
- [ ] **Consider retiring `ci.yml`** — redundant with `verify.yml` (stricter superset); double spend + the earlier nondeterministic-failure confusion. User-approved pending.

## Done (recent)

- [x] Guardrails toggle UX: dedicated `/api/guardrails` endpoint, top-of-page badge, asymmetric edge-propagation handling (2026-10-28)
- [x] Guardrails activity per chat request from gateway logs, both modes (2026-10-28)
- [x] `authentication`-field clobbering fixed via full-config spread (2026-10-28)
- [x] Gateway Settings form pre-filled from live state (2026-10-28)
- [x] Cache-key mechanism isolated (credential is part of the key even with explicit `cf-aig-cache-key`); docs corrected (2026-10-29)
- [x] Cache education shown once at toggle time; per-send result lines for HIT/MISS/unknown in both modes (2026-10-29)
