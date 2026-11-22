> **Reading as an AI agent?** This is the Markdown version of https://docs.meshy.ai/api/webhooks.
>
> - Full docs index: https://docs.meshy.ai/llms.txt
> - Single-fetch full content: https://docs.meshy.ai/llms-full.txt
> - Tool-calling access via MCP server: https://docs.meshy.ai/api/ai
> - Command-line access via the Meshy CLI: https://docs.meshy.ai/api/cli

---
# Webhooks

Have Meshy send a `POST` request to your server when an API task makes progress or finishes, so you don't need to poll.

---

## Why use webhooks
Webhooks take less work and cost less than polling the API for each task's status. Meshy sends each update as it happens, so you get it sooner, and webhooks scale better than polling. You also send fewer requests, which keeps you further from your [rate limits](/api/rate-limits).

---

## Set up a webhook
To add a webhook, follow these steps:

1. Open the [Webhooks page](https://www.meshy.ai/developers/webhooks) in the [Developer Platform](/api/developer-platform), and click **Create Webhook**.
2. In **Payload URL**, enter the URL that receives the deliveries. Meshy delivers only over `https://`.
3. Keep a copy of the **Webhook Secret** that the dialog fills in. Every delivery carries it, so your server can check that a request came from Meshy. For a webhook you already have, click the eye icon in its **Secret** column to see it.
4. Select **Active**, and click **Confirm**.

Each account can have 5 active webhooks, and 10 in total. Every active webhook receives the status updates of all your API tasks.

To test a webhook with a server on your computer, see [Test on your computer](#forwarding-webhooks-for-local-testing).

---

## Handle a delivery
To accept a delivery, respond with a status below 400, such as `200` or `202`. Meshy waits about 25 seconds for the response, so store the delivery and respond first. Do the slow work after that, such as downloading the model.

A status of 400 or above, or no response, counts as a failed delivery. Meshy retries it with longer waits between attempts, up to 4 times for an `IN_PROGRESS` update and up to 9 times for a final status. If 20 updates in a row fail every attempt, Meshy can deactivate the webhook. To turn it back on, edit it on the Webhooks page and select **Active**.

Write your code for these cases:

- Deliveries can arrive out of order. An `IN_PROGRESS` delivery can arrive after the final one, so don't let it replace a final status.
- The same update can arrive more than once. Handle each pair of `id` and `status` once.
- Anyone who knows your URL can send it a request. Compare `X-MESHY-API-WEBHOOK-SECRET-KEY` with your copy of the secret, and reject a request that doesn't match.

If a task's final delivery hasn't arrived after about twice the task's typical time, get the task from its `GET` endpoint. For typical times and how long to wait, see [Task lifecycle](/api/task-lifecycle#processing-times).

---

## Test on your computer
Meshy delivers only to a public `https://` URL, so it can't reach a server on your computer directly. To test code on your computer, forward a public URL to it with a webhook proxy. These steps use [smee.io](https://smee.io/), and any webhook proxy service works the same way.

1. Open [smee.io](https://smee.io/) and click **Start a new channel**. Copy the URL under **Webhook Proxy URL**.
2. If you don't have the smee client yet, install it:

   ```text
   npm install --global smee-client
   ```

3. Forward the channel to your server. Replace `WEBHOOK_PROXY_URL` with your Webhook Proxy URL:

   ```text
   smee --url WEBHOOK_PROXY_URL --path /webhook --port 3000
   ```

   The output looks like this, where `WEBHOOK_PROXY_URL` is your Webhook Proxy URL:

   ```text
   Forwarding WEBHOOK_PROXY_URL to http://127.0.0.1:3000/webhook
   Connected WEBHOOK_PROXY_URL
   ```

   Keep it running while you test. To stop forwarding, press Ctrl+C. Your server receives the deliveries on port `3000` at the path `/webhook`, so set up your code to listen there.

4. On the [Webhooks page](https://www.meshy.ai/developers/webhooks), create a webhook with the Webhook Proxy URL as its **Payload URL**.

---

## Delivery payload
Meshy sends a delivery while a task is `IN_PROGRESS`, and another when the task reaches a final status. A task can reach its final status without an `IN_PROGRESS` delivery.

Each delivery is a `POST` to your Payload URL with these headers:

| Header | Value |
| --- | --- |
| `X-MESHY-API-WEBHOOK-SECRET-KEY` | The webhook's secret |
| `X-MESHY-API-WEBHOOK-USER-ID` | The ID of the Meshy user who owns the webhook |
| `Meshy-Webhook-Version` | `v1`, the format of the body |
| `Content-Type` | `application/json` |
| `User-Agent` | `MeshyAPIWebhook/1.0.0` |

The JSON body is the task object. It's the same object that the task's `GET` endpoint returns, except `progress`. A delivery sends `progress` as one of these values:

- `50` while the task is `IN_PROGRESS`
- `100` when the task succeeds
- `0` when the task fails or is canceled

For the fields of each task object, with an example, see the following sections:

- [Text to 3D task object](/api/text-to-3d#example-text-to-3d-task-object)
- [Image to 3D task object](/api/image-to-3d#example-image-to-3d-task-object)
- [Multi-Image to 3D task object](/api/multi-image-to-3d#example-multi-image-to-3d-task-object)
- [Remesh task object](/api/remesh#example-remesh-task-object)
- [Retexture task object](/api/retexture#example-retexture-task-object)
- [Rigging task object](/api/rigging#example-rigging-task-object)
- [Animation task object](/api/animation#example-animation-task-object)
