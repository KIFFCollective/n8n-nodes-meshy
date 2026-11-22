# Feature request: all-in-one Meshy node

2026-11-22

## Summary

Let one Meshy node create a task, wait for it to finish and download the file, so the common path is one node instead of three. Add a single "Stop After" setting to Create. Its default keeps today's behaviour, and Create, Wait, Get, Download and the Meshy Trigger stay as they are for anyone who wants control over each step.

## Problem

The most common run needs three Meshy nodes: Create, Wait, Download. Create returns only `{ id, status: "PENDING", family }`, so each later node needs the ID wired in by hand, and the user places and configures nodes that exist only to pass it along. The same job on fal.ai is one node, because fal's generate node submits, polls and returns the result.

The pieces already exist. In [operations.ts](https://github.com/KIFFCollective/n8n-nodes-meshy/blob/24bc295d51db2aefdde2d8cf80a451bf06f11966/nodes/Meshy/operations.ts) `create`, `wait` and `download` are separate functions. [wait.ts](https://github.com/KIFFCollective/n8n-nodes-meshy/blob/24bc295d51db2aefdde2d8cf80a451bf06f11966/nodes/Meshy/wait.ts) already polls with Meshy's retry hint, stops at a timeout (default 10 minutes, capped at 50) and leaves a timed-out task running. [download.ts](https://github.com/KIFFCollective/n8n-nodes-meshy/blob/24bc295d51db2aefdde2d8cf80a451bf06f11966/nodes/Meshy/download.ts) already takes a task or an incoming item. This request is mostly about composing them, plus handling multiple input items correctly (see Behaviour).

## Goals and non-goals

**Goals**

- One node covers create, wait and download for every task family that has a Create operation.
- Existing workflows behave exactly as before, with no migration.
- Fire-and-forget, the Meshy Trigger and step-by-step control all keep working.
- A batch of input items finishes in about the time of the slowest task, not the sum of all of them.
- Credits are never spent twice, and a created task's ID is never lost.

**Non-goals**

- Removing or renaming any existing operation.
- A combined preview-then-refine step for text to 3D. Two Meshy nodes in a row handle it for now.
- Webhook handling. The Meshy Trigger already covers it.

## Proposed design

Add one parameter to every Create operation: **Stop After**, with three values. It is one setting instead of two toggles, so the invalid combination "download without waiting" cannot be chosen.

1. **Task Created** (default). Today's behaviour: returns the ID right away.
2. **Task Finished.** Creates the task, polls until it reaches a final status, returns the same task Wait returns today.
3. **File Downloaded.** As above, then downloads the chosen format into binary data, the same result Download returns today.

Everything else keeps its place. Wait, Get, Get Many, Cancel and Download stay as separate operations, and the Meshy Trigger is untouched. The new paths reuse the existing parameter names (`timeoutMinutes`, `waitOptions`, `format`, `binaryPropertyOutput`, `downloadOptions`) so the fields look and behave the same wherever they appear.

The alternative, a separate "Create And Wait" operation, is listed under Open questions.

## Parameters

All fields live on the Create operation of every family. Fields marked "existing" are the ones Wait and Download already define.

| Field | Type | Default | Shown when | Notes |
| --- | --- | --- | --- | --- |
| Stop After (`stopAfter`) | options | Task Created | always, on Create | New. Values: created, finished, downloaded. |
| Timeout Minutes (`timeoutMinutes`) | number | 10 | Stop After is finished or downloaded | Existing. Clamped 1 to 50. Covers the whole wait, not each poll. |
| Wait Options (`waitOptions`) | collection | empty | Stop After is finished or downloaded | Existing option Fail On Task Error (default on). New option Return Task On Timeout (default off). |
| Format (`format`) | options | glb | Stop After is downloaded | Existing. Same error as Download if the task has no such output. |
| Binary Property (`binaryPropertyOutput`) | string | data | Stop After is downloaded | Existing. |
| Download Options (`downloadOptions`) | collection | empty | Stop After is downloaded | Existing. Keeps the meshy.ai host check. |

The description of Stop After must repeat the existing warning: credits are charged when the task is created, and Meshy has no idempotency key, so Retry On Fail must stay off.

## Behaviour and edge cases

**Many input items.** This is the main design risk. Today a batch of 10 items through Create, Wait, Download creates all 10 tasks quickly, so Meshy runs them side by side and the Wait node mostly finds them done. A naive one-node version that handles item 1 completely before item 2 would run them one after another and take up to ten times as long, and could hit the 50 minute cap. So for Task Finished and File Downloaded the node must work in phases: create every task, then poll them all, then download. Meshy limits how many tasks a plan can run at once. I have not confirmed the numbers, so the implementation should check them and decide whether to cap the fan-out.

**Credits.** Credits are charged at creation, and failed tasks are refunded. No code path may issue a second Create for the same input item, including after a poll error. If anything throws after tasks were created, the error must list every task ID created so far, so none are lost.

**Timeout.** Default is an error that names the task ID and says it is still running, as Wait does now. With Return Task On Timeout on, the node returns the still-pending task as normal output instead, so a workflow can branch on `status` and call Get later.

**Failed or canceled tasks.** With Fail On Task Error on (default), the node errors as Wait does. With it off, the node returns the task and skips the download, so there is no binary output.

**Long jobs.** Holding an execution open for up to 50 minutes works but is not ideal. The documentation should point long-running work to Task Created plus the Meshy Trigger.

## Output shape

The output depends only on Stop After, never on the task family, so downstream expressions stay predictable. `id` is present in every mode.

| Stop After | JSON output | Binary output |
| --- | --- | --- |
| Task Created | `{ id, status: "PENDING", family }`, unchanged | none |
| Task Finished | The task Wait returns today (normalised, with `model_urls`, `thumbnail_url`, `image_urls`) | none |
| File Downloaded | The same task, as Download returns it in task ID mode | The file, under the chosen binary property |

Because Task Finished returns what Download's "from item" mode already reads, a user can stop at Task Finished, inspect the task, then pick a format in a separate Download node without a second API fetch.

## Backwards compatibility

The default is Task Created, which is today's behaviour, so every saved workflow and the files in `examples/` keep working. A saved workflow that lacks the new field should read the default. This needs checking in n8n rather than assuming, and it decides whether the node version must be bumped. No existing field is renamed or removed.

## Open questions

1. **Parameter or separate operation?** A "Create And Wait" operation would give each operation one fixed output and leave Create untouched, and it is easier to spot in the operation list. A Stop After setting avoids a second near-duplicate operation per family (about 18 families). Current lean: the setting, shown on the main parameters rather than hidden under Options.
2. **Can the node protect against Retry On Fail?** n8n retries by re-running the whole node, which would create and bill a second task. If the node cannot prevent that, the warning in the field description is the only guard.
3. **Fan-out limit.** What is the per-plan limit on concurrent tasks, and should the node cap or queue creates to stay under it?
4. **Default format per family.** Format defaults to glb, which is wrong for text to image and image to image. Should the default depend on the family?
5. **Return Task On Timeout.** Is this option worth the extra surface, or is the timeout error enough?
6. **Preview then refine.** Text to 3D needs two tasks for a textured model. A later combined option is possible, but it is out of scope here.

## Acceptance criteria

- [ ] With Stop After left at Task Created, every existing unit test and `examples/` workflow passes with no edits.
- [ ] Text to 3D preview with Task Finished returns the same task as Create followed by Wait.
- [ ] File Downloaded returns the same file name, MIME type and bytes as Create, Wait, Download in sequence.
- [ ] With 10 input items, a test against mocked transport shows all 10 creates issued before the first poll.
- [ ] A timeout error names the task ID, and no second Create is issued. With Return Task On Timeout on, the pending task is returned.
- [ ] With Fail On Task Error off, a FAILED task is returned with no download attempted and no binary.
- [ ] No path issues two Creates for one input item, including after a poll error or a 429 or 5xx response.
- [ ] If anything fails after creates, the error lists every task ID created so far.
- [ ] A live smoke test passes for text to 3D preview, image to 3D and one image family, recorded in `DECISIONS.md` like the earlier milestones.
- [ ] The README and `examples/` show the one-node version next to the three-node one.

## Appendix: before and after

Text prompt to a GLB file. Before: Start, Set Prompt, Meshy Create, Meshy Wait, Meshy Download, which is 3 Meshy nodes with the ID wired between them. After: Start, Set Prompt, one Meshy node (Create, Stop After: File Downloaded).

Flexibility is kept by choosing the setting to fit the job:

| Need | Setup |
| --- | --- |
| Run it and get the file | Create with Stop After: File Downloaded |
| Look at the task before choosing a format | Create with Stop After: Task Finished, then Download in "from item" mode |
| Fire and forget, react later | Create with Stop After: Task Created, plus the Meshy Trigger |
| Process a batch of items | Create with Stop After: Task Finished or File Downloaded (creates all, then polls all) |
| Textured model from text | Two Meshy nodes: preview, then refine with the preview's `id` as Preview Task ID |
| Cancel or inspect a running task | Cancel or Get, unchanged |