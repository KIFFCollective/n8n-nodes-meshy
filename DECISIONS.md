# Decisions

One line per decision: date, decision, reason.

- 2026-11-22: D1 licence MIT. Richard accepted the default; n8n verification expects MIT.
- 2026-11-22: D2 package name `n8n-nodes-meshy`, README says unofficial. Name was free on npm.
- 2026-11-22: D3 no npm publish today. Publish workflow is set up but not triggered.
- 2026-11-22: D4 no verification submission for now. Revisit after M7.
- 2026-11-22: D5 Wait default timeout 10 minutes, hard cap 50 minutes. The cap stays below Meshy's 60 minute give-up rule.
- 2026-11-22: D6 generate field definitions from openapi.yaml. Lifecycle code is hand-written.
- 2026-11-22: Code lives in local git only. No GitHub remote yet, so CI workflows are written but have not run.
- 2026-11-22: Live tests cap spend at 100 credits per run. Richard approved a small budget without giving a number.
- 2026-11-22: Programmatic template, not declarative. Download (binary output) and Wait (polling loop) need custom execute code.
- 2026-11-22: Develop on a portable Node 22 (`~/.local/node22`). `isolated-vm`, pulled in by `@n8n/node-cli`, does not compile on Node 25. `.nvmrc` pins 22.
- 2026-11-22: Test runner is vitest. The scaffold ships none. It is a dev dependency only.
- 2026-11-22: Fixtures come from the example task objects in the vendored docs (`scripts/extract-fixtures.mjs`), with account ids scrubbed. They are public examples, not recorded traffic.
- 2026-11-22: No test-mode key work. Meshy retired the shared test-mode key on 2026-09-16 (changelog). Every live call costs real credits.
- 2026-11-22: Image inputs accept a URL or an n8n binary property. Binary data becomes `data:<mime>;base64,<data>`. The docs confirm base64 data URIs, with images up to 20 MB in jpg, jpeg, png or webp.
- 2026-11-22: Download only accepts https URLs on `meshy.ai` hosts by default. Assets are served from `assets.meshy.ai` and `cdn.meshy.ai`. An "Allow Any HTTPS Host" option exists for odd cases. Tradeoff: safer by default, but a small chance of breaking if Meshy moves its CDN.
- 2026-11-22: The normalised output adds `image_urls` for the text-to-image and image-to-image families. Without it the output would hold no useful URL for those families.
- 2026-11-22: Rigging and animation results map into `model_urls` (glb, fbx, usdz) so Download works the same for every family. The full `result` object stays in `raw`.
- 2026-11-22: Create never retries, including after 429. Meshy has no idempotency key. Reads (get, list, balance) retry on 429 after `Retry-After`, up to 3 times.
- 2026-11-22: The concurrency 429 (`NoMorePendingTasks`) has no `Retry-After` and is never retried. The error message tells the user to wait for a running task to finish.
- 2026-11-22: Text to Motion is out of scope. It is not in openapi.yaml, the same as Creative Lab. Animation still accepts `motion_task_id`.
- 2026-11-22: The family is a "Resource" selector, and the operations (Create, Get, List, Cancel, Download, Wait) are shared by all families. Fewer resources would mean a giant operation list.
