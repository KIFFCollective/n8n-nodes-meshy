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
- 2026-11-22: The generator is `scripts/generate-from-openapi.mts`, not `.ts`. Strict mode lints every `*.ts` file with the runtime rules (no fs, no process) and forbids changing the ESLint config. `.mts` keeps TypeScript while staying outside that glob.
- 2026-11-22: The generator applies n8n's casing, final-period and "Whether" description rules itself, using the same `title-case` library the lint rule uses. This keeps generated code lint-clean without hand edits.
- 2026-11-22: The generator drift check compares the exported data, not the file text, so Prettier formatting does not count as drift.
- 2026-11-22: Added an "Any Task Type" resource. Its task type is an expression-capable option, and its Create takes a raw JSON body. Per-family resources use `noDataExpression`, so a generic family-plus-body sub-workflow (M4) was not possible without it.
- 2026-11-22: Live run, verified: text to image, image to 3D from a base64 data URI, remesh, rig, animate, and FBX download all worked through the node code in 84 seconds for about 21 credits. This settles the data URI question.
- 2026-11-22: Repository is github.com/KIFFCollective/n8n-nodes-meshy (confirmed by Richard).
- 2026-11-22: Pre-commit hook lives in `.githooks/` and is enabled with `npm run hooks:install`, not a `prepare` script. Lifecycle scripts are restricted for community nodes, and this adds no dependency.
- 2026-11-22: `.gitattributes` forces LF line endings. The repo is developed on Windows but CI runs on Linux.
- 2026-11-22: Verified in n8n 2.48.7 (Docker): the M1 example workflow produced a 1.08 MB GLB. The run-task sub-workflow worked when called from a parent, both with the Wait operation and with the stock IF and Wait polling loop. The trigger rejected a wrong secret with 401, started exactly one execution for a valid delivery (which downloaded the GLB), and ignored the duplicate and the stale IN_PROGRESS. Sub-workflows must be published before a parent can call them.
- 2026-11-22: Total live spend today: 36 credits (balance 1225 to 1189).
- 2026-11-22: M5 accepted. A real Meshy webhook, sent through a smee.io proxy to n8n 2.48.7 in Docker, delivered the SUCCEEDED update for an image to 3D task. The trigger checked the secret, started one run, and the run downloaded the GLB. Meshy sent no IN_PROGRESS delivery for this short task, which its docs allow. Stale and duplicate handling is covered by simulated deliveries in the same n8n and by unit tests. Live spend total: 41 credits.
- 2026-11-22: Live smoke test passed for Text to 3D (preview and refine), Multi-Image to 3D, Retexture, Convert, Resize, UV Unwrap, Image to Image and Print Analyze (test/live/families.live.test.mts). Multi-Color, Auto Split, Relief and Repair stay fixture-only to keep spend down. Balance after today's live work: 1144 (started at 1225).
- 2026-11-22: Live smoke test passed for Print Repair, Multi-Color (3MF), Auto Split (8 parts from a meshy-6-lite model) and Relief with depth map download (test/live/print.live.test.mts). Every task family has now run live. Balance after all live work today: 1094 (started at 1225).
