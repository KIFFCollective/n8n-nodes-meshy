# Changelog

## 0.2.0 (2026-11-22)

- Create has a new **Stop After** setting: Task Created (default, same as before), Task Finished or File Downloaded. One Meshy node can now create a task, wait for it and download the file.
- With several items, Stop After creates every task first and then checks them all together. When the plan's limit on running tasks is full, the next create waits for a slot. No create is ever sent twice for one item.
- If an error happens after tasks were created, the error lists every task ID from the run.
- Wait has a new option, **Return Task on Timeout**.
- New example: `examples/one-node-image-to-3d.json`.
- Existing workflows work as before. The node version stays 1.

## 0.1.1

- Published from GitHub Actions with npm provenance, which n8n needs for verification. No code changes.

## 0.1.0 (2026-11-22)

First version.

- Meshy node with one resource per task type in Meshy's OpenAPI spec: Create, Get, Get Many, Cancel, Wait and Download for each.
- Any Task Type resource for sub-workflows that handle several task types.
- Animation library lookup, credit balance and usage.
- Meshy Trigger node for Meshy webhooks, with secret check, dedupe and filters.
- Example workflows in `examples/`.
