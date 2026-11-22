\# n8n-nodes-meshy: SPEC



Status: draft v1. Audience: a coding agent (Claude Code or similar) working with Richard.

Goal: a complete, well-tested n8n community node package for the Meshy API.



\## 0. Working agreement (read first)



Speed matters. Plow through. Short loops, small commits, lots of automation.



\- Decide small things yourself. Write each decision as one line in `DECISIONS.md` (date, decision, reason) and keep going.

\- Ask Richard only for the items in section 9. Batch questions, give a recommended default for each, and keep working on everything that is not blocked.

\- Never publish to npm, push tags, create releases, or spend real Meshy credits without asking first.

\- Every milestone ends green: `npm run lint`, `npm run build`, tests passing. Commit at that point. Do not move on with red checks.

\- Code style: simple and readable over clever. Flow smoothly, no buzzwords, no premature optimisation. When simplicity and correctness pull apart, flag the tradeoff in `DECISIONS.md` and say which you chose. Comment the "why", not the "what".

\- Do not guess API behaviour. Where this spec says UNKNOWN, resolve it from the docs or a recorded test response and write down what you found.

\- No em dashes or boilerplate-sounding prose in README or node descriptions. Plain, direct text.



\## 1. Scope



In scope:

\- A credential type for Meshy.

\- A `Meshy` action node covering the full REST API, shipped in phases (section 5).

\- A `Meshy Trigger` node for webhooks (late phase, section 5).

\- Examples (importable workflow JSON), a README, CI, and a publish pipeline.



Out of scope:

\- Creative Lab endpoints (they are not in the OpenAPI spec). Revisit later if wanted.

\- SSE streaming endpoints. n8n is a poor fit for long-lived streams. Use polling instead.

\- Wrapping the Meshy MCP server. It is useful as a behaviour reference only (npm `@meshy-ai/meshy-mcp-server`, source `meshy-dev/meshy-mcp-server`).



\## 2. Stack and constraints



\- TypeScript. Scaffold with the official tool: `npm create @n8n/node@latest`. Pick the programmatic template if the declarative one cannot support download and wait operations (verify in current docs, then record the decision).

\- Dev loop commands from the scaffold: `npm run dev` (starts n8n on localhost:5678 with hot reload and your node linked), `npm run lint`, `npm run lint:fix`, `npm run build`, `npm run release`.

\- Keep the scaffold's strict lint mode. Turning it off would make the package ineligible for n8n Cloud verification.

\- ZERO runtime dependencies. Use `this.helpers.httpRequest` / `httpRequestWithAuthentication` for all HTTP. Dev dependencies are fine (tests, generator).

\- Node 22 or whatever the scaffold pins. Do not fight the scaffold's config.

\- Licence: see section 9, decision D1. Default MIT.



\## 3. Meshy API facts (reference)



Verify anything marked UNKNOWN before relying on it.



\- Base URL: `https://api.meshy.ai/openapi/`. Auth: `Authorization: Bearer msy\_...`. Keys come from the Meshy developer keys page. A test-mode key exists for development (UNKNOWN: exact behaviour and limits, read `https://docs.meshy.ai/llms-full.txt`).

\- Machine-readable sources: `https://docs.meshy.ai/openapi.yaml` (54 paths, 144k chars, read ALL of it, the first fetch was truncated), `https://docs.meshy.ai/llms.txt`, `https://docs.meshy.ai/api/webhooks.md`.

\- Every task family has the same shape: POST create (returns 202 with `result` = task id), GET list, GET by id, DELETE by id, GET `{id}/stream`.

\- Families: text-to-3d (v2, modes preview and refine), image-to-3d, multi-image-to-3d, retexture, remesh, convert, resize, uv-unwrap, rigging, animations (plus `/animations/library`), text-to-image, image-to-image, print/multi-color, print/split, relief, print/repair, print/analyze. Account: `/v1/balance`, `/v1/usage/tasks`.

\- Status: `PENDING`, `IN\_PROGRESS`, `SUCCEEDED`, `FAILED`, `CANCELED`. A task can go from IN\_PROGRESS back to PENDING with the same id. That is not an error. Only FAILED is a failure, and failed tasks are refunded. Credits are charged at creation. Timestamps are Unix epoch milliseconds.

\- Polling: wait the `Retry-After` header value between polls, 5 seconds if absent. Do not give up before 60 minutes from `created\_at`. A client timeout does not cancel the task.

\- NO idempotency key. Never auto-retry a create call after a timeout, dropped connection or 5xx. Check recent tasks instead.

\- DELETE cancels only PENDING tasks. IN\_PROGRESS returns 409.

\- Rate limits: 20 requests per second (Pro and Studio), concurrent tasks 10 on Pro, 60 on Studio. 429 on excess, with `Retry-After` and `X-RateLimit-\*` headers.

\- Image input: `image\_url` accepts an http(s) URL or a data URI (UNKNOWN: whether the data URI must be base64 and the size limit). Image to 3D takes exactly one of `image\_url` or `input\_task\_id`. Multi-image takes 1 to 4 images. Retexture takes `model\_url` (GLB).

\- Chaining: rigging takes `input\_task\_id`; animation takes `rig\_task\_id` and `action\_id`.

\- Outputs: `model\_urls` keyed by format (glb, fbx, obj, usdz, stl, 3mf, pre\_remeshed\_glb). Only produced formats appear, so check the key exists. Assets are kept 3 days on non-Enterprise plans.

\- Webhooks: registered by hand in the dashboard only (no API registration, no per-request callback URL). 5 active, 10 total per account. Every active webhook receives every API task. Deliveries carry header `X-MESHY-API-WEBHOOK-SECRET-KEY` (compare to your secret), plus user id and version headers. Body is the task object, with `progress` forced to 50, 100 or 0. Respond below 400 within about 25 seconds. Deliveries can arrive out of order and can repeat: never let IN\_PROGRESS overwrite a final status, and dedupe on `id` plus `status`. Meshy retries up to 4 times (in progress) or 9 times (final), and can deactivate a webhook after 20 consecutive failures.

\- UNKNOWN: the full `Task` response schema (the first fetch cut off before it), request schemas for rigging and animations, credit cost per operation, whether `Retry-After` is sent on non-429 responses.



\## 4. Design



Credential `MeshyApi`: one password-type field for the API key, base URL fixed in code. Credential test calls `GET /v1/balance`.



Operation model, kept uniform across families:

\- Create: sends the request, returns immediately with `{ id, status: "PENDING", family }`. No retry on fail (set the node default and document why).

\- Get: fetch a task by family and id. Returns the normalised output below.

\- List, Cancel: as the API allows.

\- Download: given a task id (or an item containing `model\_urls`), fetch a chosen format into n8n binary data. https only. Name the file from the task `name` or id. Warn in the description about the 3 day retention.

\- Wait (milestone M4): poll Get until a terminal state, honouring `Retry-After`, tolerating PENDING after IN\_PROGRESS. Bounded by a user-set timeout (default 10 minutes, hard cap well below the 60 minute give-up rule, with a clear error that says the task is still running and shows its id). A timeout is NOT a task failure.



Normalised output for task operations (always keep the raw response under `raw`):

`{ id, family, status, progress, name, model\_urls, thumbnail\_url, texture\_urls, error, created\_at, finished\_at, raw }`. Convert epoch ms to ISO strings for the two timestamp fields and keep the originals in `raw`.



Inputs:

\- Image fields accept a URL, or a binary property name that the node converts to a data URI. Resolve the base64 question first (section 3 UNKNOWN) and test it live once.

\- Model names (`ai\_model`) change often. Offer a short options list plus a free-text custom value, and a default of `latest`.

\- Expose optional API parameters under an "Additional Fields" collection so the main form stays small.



Errors: map 401, 402 or insufficient credits, 409, 429 and 5xx to specific, plain messages. Include the Meshy error `message` and `code` when present. On 429, wait for `Retry-After` and retry reads (never creates). Support "continue on fail" correctly.



Generator (automation): write `scripts/generate-from-openapi.ts` (dev dependency only) that reads `openapi.yaml` and emits the per-family field definitions into `nodes/Meshy/generated/`. Hand-write the lifecycle operations (create, wait, download) and glue. Commit the generated files. Add a CI job that regenerates and fails if there is a diff, plus a weekly scheduled job that checks whether the live spec changed and opens an issue. If generation proves messier than hand-writing a family, hand-write it and note why in `DECISIONS.md`.



Trigger node `Meshy Trigger` (milestone M5): n8n webhook trigger. It cannot register itself with Meshy, so the node description must tell the user to paste the production webhook URL into the Meshy dashboard and the secret into the credential or node. Check the secret header (constant-time compare), ignore stale IN\_PROGRESS events, dedupe on `id` plus `status`, and return immediately. Because every active webhook gets every task, offer optional filters (task family, status).



\## 5. Milestones and acceptance criteria



Work top to bottom. Each milestone ends with lint, build, tests green, a commit, and a saved example workflow in `examples/`.



\- M0 Scaffold. Package named per D2, credential, `Get Balance`. Accept: credential test passes against a real key (ask Richard to run it or supply a test key), `npm run dev` shows the node in n8n.

\- M1 First vertical slice: image-to-3d Create, Get, Download. Accept: an example workflow turns a URL image into a GLB in n8n binary data.

\- M2 Pipeline operations: remesh, retexture, rigging, animations (create, get, library list). Accept: example workflow runs image to 3D, remesh, rig, animate, download FBX, chaining by task id.

\- M3 Remaining generation: text-to-3d (preview then refine), multi-image-to-3d, convert, resize, uv-unwrap, text-to-image, image-to-image, cancel, list, usage. Accept: each has a fixture-based unit test and appears in the UI with sane defaults.

\- M4 Wait operation plus `examples/meshy-run-task.json`, a reusable sub-workflow taking a family and body and returning a finished task with a downloaded file. Accept: the sub-workflow works with the Wait op and also in a no-Wait polling variant built from stock nodes.

\- M5 `Meshy Trigger`. Accept: verified with a webhook proxy (smee.io or similar, since Meshy cannot reach localhost) against a real task, plus tests for stale, duplicate and out-of-order deliveries.

\- M6 Print family (multi-color, split, relief, repair, analyze).

\- M7 Release hardening: README in n8n's app-node format, CHANGELOG, publish workflow, packed-artifact check. Publishing and verification submission are gated on D3 and D4.



\## 6. Testing



\- Unit tests with recorded fixtures for every family's create and get responses. Use whatever test setup the scaffold ships. Add a runner only if there is none.

\- Specific tests: status handling (PENDING after IN\_PROGRESS, terminal states), Retry-After handling, no retry on create, missing `model\_urls` format, data URI conversion, webhook secret check and dedupe.

\- Live tests are opt-in via an env var and use the Meshy test-mode key if it works as expected. Never run live tests that cost real credits without asking Richard, and cap spend per run in the test config.

\- Manual check each milestone: `npm run dev`, build the example workflow, run it, attach the result to the PR or commit message.



\## 7. Automation checklist (set up in M0 and M7)



\- CI on every push: lint, build, tests, generator drift check.

\- Scheduled weekly: OpenAPI change detector opening an issue with the diff.

\- Publish workflow triggered by version tags, publishing to npm from GitHub Actions with provenance (copy the starter repo's `publish.yml`, use npm trusted publishing so no long-lived token is stored).

\- Pre-commit: lint and format.

\- Keep the repo public if verification is desired (provenance requires it).



\## 8. Security



\- Never log or echo the API key. Never commit keys. Fixtures must be scrubbed of ids and URLs that are signed or personal.

\- Download only over https, and only from URLs the API returned.

\- No `eval`, no dynamic requires, no runtime dependencies.

\- Treat API responses as untrusted data.



\## 9. Decisions Richard owns (ask in one batch, with defaults)



\- D1 Licence. Default MIT. n8n's verified-node route expects MIT (verify in the current guidelines). If Richard prefers a copyleft licence, verification is probably off the table but self-hosted installs still work.

\- D2 Package name and trademark. Default `n8n-nodes-meshy`, README says "unofficial". Check npm for availability first.

\- D3 Publish to npm: yes or no, and from which account. Default: not until M4 is done.

\- D4 Submit for n8n verification (Creator Portal)? Default: no, decide after M7. Reviews can take weeks.

\- D5 Wait operation default timeout. Default 10 minutes.

\- D6 Use the generator or hand-write? Default: generate, with the fallback rule in section 4.



Anything else: decide, record, continue.



\## 10. Definition of done



All milestones through M4 shipped and green, example workflows import and run, README complete, CI green, `DECISIONS.md` current, and a short list of known gaps (UNKNOWN items still open) at the top of the README.

