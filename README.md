# n8n-nodes-meshy

This is an n8n community node for the [Meshy](https://www.meshy.ai) API. It lets you generate 3D models, textures, rigs, animations and images from your n8n workflows.

This package is **unofficial**. It is not made or supported by Meshy.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/) workflow automation platform.

## Known gaps

These items are not verified yet, or are not covered:

- The Print family (multi-color, split, relief, repair, analyze), Convert, Resize, UV Unwrap, Retexture, Multi-Image to 3D, Image to Image and Text to 3D are tested against example responses from the Meshy docs, not against live tasks.
- Get Usage needs a Studio or Enterprise team key. It is not tested live.
- Meshy's docs say `Retry-After` is sent while a task is PENDING or IN_PROGRESS. The node uses it when present and waits 5 seconds when it is absent. Live tasks finished too quickly to observe the header.
- Creative Lab and Text to Motion are not covered, because they are not in Meshy's OpenAPI spec. Animation still accepts a `motion_task_id`.

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation. The package name is `n8n-nodes-meshy`.

## Operations

The **Meshy** node has one resource per Meshy task type:

Text to 3D, Image to 3D, Multi-Image to 3D, Retexture, Remesh, Convert, Resize, UV Unwrap, Rigging, Animation, Text to Image, Image to Image, Print: Multi-Color, Print: Auto Split, Print: Relief, Print: Repair and Print: Analyze.

Each of these resources has the same operations:

| Operation | What it does |
| --- | --- |
| Create | Starts a task and returns its ID straight away. Credits are charged at this point. |
| Get | Gets a task by ID. |
| Get Many | Lists tasks, newest first. |
| Cancel | Cancels a task that is still PENDING. Meshy refuses to cancel a running task. |
| Wait | Checks the task until it succeeds, fails or is canceled. |
| Download | Saves a result file (GLB, FBX, OBJ, USDZ, STL, 3MF and others) as n8n binary data. |

Animation also has **Get Library**, which lists the preset animations and their IDs. This call is free.

The **Any Task Type** resource has the same operations. Its task type is a normal parameter, so you can set it with an expression. Its Create operation takes the raw JSON body from the Meshy docs. This is useful in sub-workflows that handle more than one task type.

The **Account** resource has **Get Balance** and **Get Usage**.

The **Meshy Trigger** node starts a workflow when Meshy sends a webhook for a task.

### Output

Get, Wait and Get Many return the same fields for every task type:

```json
{
  "id": "018a210d-...",
  "family": "imageTo3d",
  "status": "SUCCEEDED",
  "progress": 100,
  "name": null,
  "model_urls": { "glb": "https://assets.meshy.ai/...", "fbx": "https://assets.meshy.ai/..." },
  "thumbnail_url": "https://assets.meshy.ai/...",
  "texture_urls": [],
  "error": null,
  "created_at": "2026-11-22T09:53:35.000Z",
  "finished_at": "2026-11-22T09:54:01.000Z",
  "raw": { "...": "the full response from Meshy" }
}
```

Timestamps are ISO strings. The original epoch milliseconds are still in `raw`. For Rigging and Animation, the rigged and animated files are copied into `model_urls`, so Download works the same way for every task type. Text to Image and Image to Image also return `image_urls`.

## Credentials

1. Create an API key on the [Meshy API settings page](https://www.meshy.ai/settings/api). Keys start with `msy_`.
2. In n8n, create a **Meshy API** credential and paste the key. The credential test reads your credit balance, which is free.
3. Only if you use the Meshy Trigger: also paste your webhook secret into the credential (see below).

Meshy retired its shared test-mode key in September 2026. Every task you create uses real credits.

## Compatibility

Built with `@n8n/node-cli` 0.57 and tested against n8n-workflow 2.48 on Node.js 22.

## Usage

### Chaining tasks

Most tasks can take the ID of an earlier task as their input. Pick **Previous Task** as the Input Type and use an expression such as `{{ $json.id }}`. A typical chain looks like this:

1. Image to 3D: Create, then Wait
2. Remesh: Create with the previous task ID, then Wait
3. Rigging: Create with the remesh task ID, then Wait
4. Animation: Create with the rig task ID and an action ID from Get Library, then Wait
5. Animation: Download, format FBX

The `examples/` folder has this workflow and several others. You can import them into n8n. After importing, select your Meshy credential in each Meshy node.

### Image inputs

Image fields take a public URL, or an n8n binary property. The node sends binary data as a base64 data URI. Meshy accepts JPG, PNG and WebP images up to 20 MB.

### Do not turn on Retry On Fail for Create

Meshy has no idempotency key. If a create call is retried after a timeout or a server error, Meshy can create and bill a second task. The node never retries Create by itself. If Create fails with a server error, use Get Many to check whether the task was made before you try again.

Reads (Get, Get Many, Wait, Download) wait for `Retry-After` and retry when Meshy rate-limits them.

### Wait

Wait stops after 10 minutes by default, and at most after 50 minutes. When it stops, the task keeps running on Meshy and is not charged again. The error message shows the task ID, so you can run Wait or Get again later.

By default, Wait stops with an error when a task fails or is canceled. Turn off **Error on Failed Task** to get the task as normal output instead. Meshy refunds credits for failed tasks.

### Downloads expire

Meshy keeps generated files for 3 days on plans other than Enterprise. Download them soon after the task succeeds. For safety, the node only downloads over https from `meshy.ai` hosts unless you turn on **Allow Any HTTPS Host**.

### Meshy Trigger

Meshy has no API for creating webhooks, so the node cannot register itself.

1. Activate your workflow, then copy the trigger node's **Production URL**.
2. On the [Meshy webhooks page](https://www.meshy.ai/developers/webhooks), create a webhook with that URL as the Payload URL.
3. Copy the webhook's secret into the **Webhook Secret** field of your Meshy API credential.

The trigger rejects deliveries without the right secret. It ignores repeated deliveries of the same task and status, and ignores an IN_PROGRESS update that arrives after the final one. Every active Meshy webhook receives every API task, so use the Task Types and Statuses filters to keep only what you need.

## Development

```sh
npm install
npm run dev        # n8n on http://localhost:5678 with this node loaded
npm run lint
npm run build
npm test           # unit tests, no network
npm run generate   # rebuild create fields from docs/vendor/openapi.yaml
npm run hooks:install  # run lint and format checks before each commit
```

The create fields for each task type are generated from Meshy's OpenAPI spec by `scripts/generate-from-openapi.mts`. To update after Meshy changes the API, copy the new spec into `docs/vendor/openapi.yaml` and run `npm run generate`. CI fails if the generated file is out of date, and a weekly job opens an issue when the live spec changes.

Live tests run the real node code against the Meshy API and spend real credits (about 21 per full run). They are off unless you ask for them:

```sh
MESHY_LIVE=1 MESHY_LIVE_MAX_CREDITS=50 npx vitest run test/live
```

The key is read from `MESHY_API_KEY` or a `.env` file. Task IDs are saved in `test/live/.state.json`, so a rerun resumes instead of paying again. Delete that file to start fresh.

Design decisions are listed in [DECISIONS.md](DECISIONS.md).

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- [Meshy API documentation](https://docs.meshy.ai)
- [Meshy OpenAPI spec](https://docs.meshy.ai/openapi.yaml)

## Version history

See [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE.md)
