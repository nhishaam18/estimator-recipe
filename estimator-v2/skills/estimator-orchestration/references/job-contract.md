# Script-owned execution contract

Estimator invokes the packaged runtime directly with native bash. There is no Developer execution agent. The flow command constructs immutable job JSON, binds it to the executing runtime, invokes the existing locked pipeline and saves a compact coordination checkpoint. No model is called inside scripts.

## Normal commands

Run node <runtime>/scripts/cest.mjs flow --jobs-dir /workspace/estimator-config/jobs --kind <kind> <options>. Omit --id: scripts derive a stable operation ID from the arguments; report and consolidation/estimate preparation also bind the current saved evidence revision. Repeat identical arguments on unchanged evidence only to reconcile the SAME step; a replay is not a new stage or permission to dispatch a worker. Changed report/inventory evidence gives a new preparation operation ID without guessing one. For status=partial, run flow --kind advance --run <same runDir> --after <continueAfter> with the same jobs-dir. Copy continueAfter exactly. Blocked/uncertain receipts do not authorize a new operation or automatic retry without a diagnosed evidence change. An explicit --id is for an existing legacy job only, not a routine command or a substitute for requestId/batchId.

| kind | Options | Script-controlled work |
| --- | --- | --- |
| discover-plan | --url, --discovery-file, --runs-dir | Group complete saved Firecrawl output; return EVERY group and planFingerprint |
| prepare | --plan, --plan-fingerprint, --quotas-file, --runs-dir; optional --name | Verify reviewed plan, freeze quotas, initialize/reuse run, advance through detection, reserve two packets |
| advance | --run, --after <continueAfter from a partial receipt> | Resume same run through detection and reserve when ready |
| settle-batch | --run, --batch, --outcomes-file | Validate/import serially, retain siblings, reserve next only on successful nonempty settlement |
| recover-capture | --run, --url, --reason; --diagnosis for observed gap | One selected route; failed, obstructed or lazy-incomplete |
| report | --run | Script annotation/report assembly; pending detections block |
| prepare-consolidation | --run | Save compact native grouping request |
| import-consolidation | --run, --result-file | Validate/import source-bound grouping; regenerate report afterward |
| prepare-estimates | --run; optional --target, --rate, --currency | Save current unique inventory request; Sitecore default, explicit rate/currency only |
| import-estimates | --run, --result-file | Validate/import native estimates |
| assemble-estimates | --run, --parts-file | Assemble run-relative fragment files and validate complete coverage |

Normal examples (replace placeholders with actual saved paths; omit --id):
```sh
node <runtime>/scripts/cest.mjs flow --jobs-dir /workspace/estimator-config/jobs --kind prepare --plan <planDir> --plan-fingerprint <planFingerprint> --quotas-file <quotasFile> --runs-dir <runsDir>
node <runtime>/scripts/cest.mjs flow --jobs-dir /workspace/estimator-config/jobs --kind settle-batch --run <runDir> --batch <batchId> --outcomes-file <outcomesFile>
```

Identity boundaries: `runDir` is the absolute saved run folder; `operationId`/`continueAfter` identify one flow step; `batchId` identifies a visual reservation; 64-hex-character `requestId` identifies one screenshot analysis packet; `jobId` comes from the actual Kajoo run-agent result. Copy each from its own saved receipt. Never derive one from another, reuse a screenshot requestId as `--id`, or use a worker's `ready` text as a platform status. Estimation has a separate requestId in estimation/request.json; its `batch-001` IDs are for estimate packets, not visual reservations.

## Model return envelope

Estimator saves the actual verified Kajoo outcomes as a bare array, max two objects. This is the platform bridge input, not a manually authored pipeline job:
```json
[{"requestId":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","jobId":"verified-platform-job-id","status":"completed"}]
```
Only requestId, jobId, status and optional concise reason. Never {jobs:[...]}, platformRunId, receipt or ready. Status: completed|failed|blocked|cancelled|running|unknown; only unknown may omit jobId. A worker's ready/blocked text does not establish platform status. Scripts validate identity/source/draft geometry; they do not query Kajoo status. Unknown/running keeps slots. Failed/empty imports stop at needs-diagnosis.

## Durable state, replay and recovery

Flow creates jobs/<operationId>.json and receipts/<operationId>/receipt.json. Checkpoints under coordination/<scope-hash>.json point to the exact runtime/run/plan, latest receipt, counts and pending packet paths. Keep user decisions and bootstrap/verification receipt paths alongside that checkpoint; restore those small pointers after summaries. A replay cannot roll back a later checkpoint. `next/status` is diagnostic state, not a dispatch assignment; only a fresh visual-batches reservation supplies a writable per-attempt resultFile.

Unknown flow options are rejected. Existing job --file remains for compatibility/diagnostics: schemaVersion:1, id, kind, optional runtime and camelCase fields matching the options above. Runtime binds to the executing tree. Cached receipts, input fingerprints, progress, command.json and stdout/stderr logs remain authoritative. Referenced input files must remain immutable; changed bytes under the same step fail.

A blocked or interrupted step is not permission to delete locks or replay work. Verify actual owner/files and original command entrypoint first. New IDs follow a diagnosed correction, not blind retry. Existing wrong-path cached receipts are preserved; use corrected runtime and a new step only after reconciling batch/outcomes. A missing dependency-bearing runtime blocks, never executes under /mnt/skills. Bootstrap refreshes scripts only when idle.

One foreground flow invocation can execute several deterministic commands without model decisions between them. Return/read only compact receipt fields in normal loops. No per-command Developer delegation or source-code exploration.
