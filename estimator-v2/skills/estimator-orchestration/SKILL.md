---
name: estimator-orchestration
description: Coordinate Estimator discovery, user sampling, deterministic Developer jobs and up to two isolated Visual Analysis jobs without loading detailed evidence.
---

# Coordinate only

Resolve Developer/Visual Analysis IDs from advertised available_agents. No nested delegation or hardcoded IDs. Omit runId/history/background for independent jobs. Visual Analysis needs image access. Missing capabilities block; do not absorb technical work here.

1. First discovery: give Developer the starting URL and ask it to stage its skill, bootstrap once, immediately save returned runtime/verification receipts, call Firecrawl Map and immediately persist the full response before another read. It executes a discover-plan job and returns the plan plus EVERY group ID/pattern/count/suggestion. Reuse exact-scope saved discovery on resume; never shrink successful Map output or retry different limits because output was cleared.
2. Show all group counts in Kajoo chat and obtain explicit quantities including zero/all. Save quotas keyed by group ID. Tool approval is not sampling consent; no scope expansion/substitution.
3. Use [job contract](references/job-contract.md) to write a small immutable job.json under /workspace/estimator-config/jobs/, with a new lowercase id. For prepare include schemaVersion:1, kind:prepare, absolute planDir/quotasFile/runsDir, planFingerprint from the discovery receipt, and optional name. Send only jobFile and saved runtime to a fresh Developer: read entry skill and job, execute `node <runtime>/scripts/cest.mjs job --file <jobFile>`, return receipt. The command selects/initializes/resumes, captures serially for four minutes and reserves up to two packets. Partial means a new advance job on the same runDir; never repeat bootstrap/init. Do not request source-code exploration between successful receipts.
4. For a NEW reservation, save dispatch intent first. Launch at most TWO Visual Analysis run-agent calls in the SAME assistant tool-call batch; each receives only runDir/requestId/promptFile/image/resultFile. Omit runId and history; workers write unique assigned drafts. End the turn and wait for automatic batch results, no polling. If concurrent dispatch is unavailable, execute assigned packets serially without reallocating paths. Replayed/reused reservations require reconciliation, never duplicate dispatch.
5. Save verified platform outcomes in the exact bare array below, max two objects. Write a new settle-batch job with runDir, batchId, outcomesFile. Developer executes one job command; scripts validate/import and reserve next work only after successful nonempty settlement. Do not edit shared evidence, run technical commands or inspect screenshots/reports here.
6. Repeat until accounting is complete, then separate report/consolidation/estimate/delivery assignments. Developer reasons over compact inventory and at most ten unique items per estimate job, saves fragments and assembles via scripts. NO automatic paired raw/annotated-region second pass. Preserve field/style/typography reports, quality findings and Section/Inner accuracy; script checks are not visual completeness proof. Sitecore default, explicit user overrides only. Rate/currency must be supplied by the user. No phases/tasks, app, CMS implementation, external model API or deployment; stop at reports and estimates.

## Exact outcomes contract

```json
[{"requestId":"actual-64-character-request-hash","jobId":"actual-platform-job-id","status":"completed"}]
```

Only requestId, jobId, status and optional concise reason. Never {jobs:[...]}, platformRunId, receipt, resultFile or ready. Status: completed|failed|blocked|cancelled|running|unknown; only unknown may omit jobId. Use actual platform results, not a worker's own ready/blocked text. Scripts validate source/draft identity; they do not query Kajoo status. Running/unknown holds slots. Failed/empty imports stop at needs-diagnosis.

## Small durable state and bounded failures

Keep around 2 KB: runtime/verification paths, run/plan/jobFile, choices, active batch/request/job IDs, counts, receipt and blockers. Preserve original assignment paths across summaries. Never overwrite dispatched jobs/inputs. Do not forward logs/DOM/styles/detections or repeat healthy status jobs; startup/result checks also cost tokens.

Blocked routine receipts end that assignment. Separate schema/file diagnosis reads named logs only. Capture gaps use one separate recover-capture job after settlement: selected url, reason failed|obstructed|lazy-incomplete, concise observed diagnosis. No ad-hoc diagnostics/script editing or repeated repair jobs. Changed capture source can require new tiles for that page; unrelated pages remain intact. Import gaps use explicit reserved Visual Analysis corrections, max two; one diagnosed transient retry. Preserve successes, stops and uncertain writes. Cancelled work requires resumed user authorization; credentials/scope are user decisions. Unknown job/lock ownership blocks, not permission to delete/relaunch.

Deliver verified report/artifact links, complete/partial/blocked status, coverage counts, Section/Inner totals, effort range and material limitations. No guaranteed savings or whole-site/interaction completeness claims from sampling.

