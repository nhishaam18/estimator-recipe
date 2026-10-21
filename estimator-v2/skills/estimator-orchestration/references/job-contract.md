# Durable Developer assignments

Orchestrator writes immutable JSON under one coordination directory, e.g. /workspace/estimator-config/jobs/. Use a new unique lowercase id for each assignment; never overwrite dispatched jobs or their input files. Pass only jobFile and absolute runtime to Developer. Developer reads jobFile and invokes `node <runtime>/scripts/cest.mjs job --file <jobFile>`. Jobs contain data, never shell command text.

Every job has schemaVersion: 1, id (letters/digits/dashes, max 80), kind and the row's fields. Paths must be absolute. Unknown fields are rejected. Include target only for a user CMS override, rate/currency only when explicitly supplied by the user.

| kind | Required fields | Deterministic work |
| --- | --- | --- |
| discover-plan | url, discoveryFile, runsDir from bootstrap | Group complete saved Firecrawl output; does not call Map |
| prepare | planDir, planFingerprint from discovery receipt, quotasFile, runsDir from bootstrap; optional name | Verify reviewed plan, freeze quotas, initialize/reuse binding, advance four minutes through detection, reserve two packets if ready |
| advance | runDir | Resume checkpoint through detection, reserve when ready |
| settle-batch | runDir, batchId, outcomesFile | Validate/import serially, reserve next only without failed/empty results |
| recover-capture | runDir, url, reason; diagnosis for observed missing content | One selected route; reason failed, obstructed or lazy-incomplete; preserve revisions |
| report | runDir | Resume through annotation/report; pending detections block |
| prepare-consolidation | runDir | Produce compact source-bound inventory/request |
| import-consolidation | runDir, resultFile | Validate/import native grouping |
| prepare-estimates | runDir; optional target/rate/currency | Prepare source-bound estimate request |
| import-estimates | runDir, resultFile | Validate/import native reasoning |
| assemble-estimates | runDir, partsFile | Assemble/check fragments and completeness |

Example (replace illustrative IDs with actual values):

```json
{"schemaVersion":1,"id":"settle-batch-001","kind":"settle-batch","runDir":"/workspace/estimator/example","batchId":"11111111-1111-1111-1111-111111111111","outcomesFile":"/workspace/estimator-config/jobs/outcomes-001.json"}
```

The outcomes file must be a **bare array**, max two objects with requestId, **jobId**, status and optional concise reason. Never use {jobs:[...]}, platformRunId, resultFile, receipt or extra fields:

```json
[{"requestId":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","jobId":"verified-platform-job-id","status":"completed"}]
```

Obtain jobId/status from actual Kajoo job results. Status is completed, failed, blocked, cancelled, running or unknown; ready is not a platform status. For unknown only, jobId may be absent. Scripts validate identity, assigned files and source/schema evidence; they cannot query Kajoo status themselves. Running/unknown holds reservations. Failed/empty imports return needs-diagnosis without allocating more work.

Receipts live under receipts/<id>/receipt.json next to jobs; original assignment, input fingerprints, progress and per-command logs remain on disk. Return compact paths/counts/packets, not raw logs/DOM/reports. Completed or blocked jobs replay their receipt. Changed inputs under the same ID are rejected; a real correction needs a new diagnosis/reconciliation assignment. Progress without a final receipt or an interrupted lock means uncertain execution: inspect actual owner/files before proceeding, never delete and replay automatically.

One invocation can run several deterministic commands with no model between them. Routine jobs should require one command and a short response. Return exact blockers and log paths instead of searching source code. Native consolidation/estimates/publication are separate assignments.
