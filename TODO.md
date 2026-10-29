# TODO — ai-gateway-demo

Current work items. Keep current with changes (see `~/src/AGENTS.md` minimum-files rule).

## Open

- [ ] **Browser-test the `GATEWAY_RUN_TOKEN` workaround** — needs a minimal-scope API token (`AI Gateway Run` only) created in the dashboard, set in `.dev.vars` + `wrangler secret put GATEWAY_RUN_TOKEN`, then verify MISS→HIT in the real browser on `ai-gw.jsherron.com/demo`. Mechanism status: `cf-aig-authorization` is accepted but _not_ cache-key material (see AGENTS.md caching gotcha #3) — the shipped workaround is therefore **unproven**; the more promising variant is sending the scoped token as the `Authorization` header (risk: forwarded upstream as provider key; cookie-path only, untestable from CLI).
- [ ] **File the AIG Jira ticket** — draft ready at `~/src/notes/misc/aig-cache-key-credential-ticket.md` (label `uat-aig-identity`). Evidence: credential-in-cache-key behavior contradicting the "custom key overrides" doc claim; browser per-request Access JWT rotation defeats caching.
- [ ] **Node 22 → 24** — CI + docs pin Node 22; external baseline (endoflife.date, 2026-10-29) says production projects should run Active/Maintenance LTS (≥24). One-line CI + docs change. User-approved pending.
- [ ] **Consider retiring `ci.yml`** — redundant with `verify.yml` (stricter superset); double spend + the earlier nondeterministic-failure confusion. User-approved pending.

## Done (recent)

- [x] Guardrails toggle UX: dedicated `/api/guardrails` endpoint, top-of-page badge, asymmetric edge-propagation handling (2026-10-28)
- [x] Guardrails activity per chat request from gateway logs, both modes (2026-10-28)
- [x] `authentication`-field clobbering fixed via full-config spread (2026-10-28)
- [x] Gateway Settings form pre-filled from live state (2026-10-28)
- [x] Cache-key mechanism isolated (credential is part of the key even with explicit `cf-aig-cache-key`); docs corrected (2026-10-29)
- [x] Cache education shown once at toggle time; per-send result lines for HIT/MISS/unknown in both modes (2026-10-29)
