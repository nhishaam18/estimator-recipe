# Bounded Developer assignments

Developer owns technical execution; Estimator only coordinates and asks users, and Visual Analysis only inspects assigned source tiles. No nested delegation. Read this reference and the relevant existing contract only for the current assignment. Use fresh jobs with saved handoffs rather than carrying the whole run.

| Assignment | Work and return |
| --- | --- |
| discover | Reuse writable setup/verified dependencies; call Firecrawl Map for the seed unless the saved exact-scope response exists. Save response, normalize/deduplicate/group via plan. Return plan path plus EVERY group ID/pattern/count/suggested quantity; no raw URL list. Await sampling choices. |
| prepare | Validate the user-approved quantities, select/init/resume, run all --through detect --minutes 4 serially. Return partial checkpoint or call batch and return its at-most-two packets. |
| settle-batch | Read the orchestrator's small outcomes file containing verified platform job IDs/statuses, then settle-batch. Import completed drafts serially. Retain successes, diagnose each failed item, hold active/unknown reservations, then reserve new pending work only when safe. |
| diagnose | Read only affected error records, source metadata and quality findings. Fix authorized script/config/file errors locally; never invent visual detections. Return a focused correction reservation or unresolved blocker. Recapture only an obstructed/failed affected route after real preparation correction; preserve browser-stop.json and authorized scope. |
| report/consolidate | Generate annotations/reports and run deterministic quality checks. Use saved list for native consolidation, consult ambiguous reports, import and regenerate. No paired-region review, automatic screenshot second pass or forced low component count. Return counts/findings/paths. |
| estimate-batch | Prepare/reuse the current source-bound estimate request. Read at most ten unique component reports plus linked child/measurement evidence. Save a fragment with requestId, assumptions and items; record completed keys/fragment paths in estimation/progress.json and return partial or assemble complete fragments. Each fresh job reads only pending keys; parent composition excludes separately counted children. |
| deliver | Verify actual files, current estimate coverage, counts, unresolved quality and sampling/propagation limits. Publish through assigned artifact tools and save receipts. Return verified links and compact totals; never raw evidence. |

Return a saved job receipt (status, runDir/planDir, completed/pending counts, affected request IDs, errorFile when needed and next assignment). Keep parent-bound payloads small except the required complete group table. Do not read images or detection JSON merely to summarize them; scripts return counts and exact errors. Preserve the complete readable field/style/typography reports for downstream agents.

For the same recurring technical error, make at most one diagnosed repair attempt, then return blocked if it recurs. Do not cycle through fresh jobs indefinitely. Pending, paused or in-progress platform jobs map to running/unknown, never a terminal blocked outcome. A cancelled job requires resumed user authorization before a retry; a child saying blocked is not itself proof of platform termination.

## Batch ownership

`batch --run <folder>` reserves at most TWO distinct pending requests, with unique draft paths for this attempt. Save the batchFile path and return its receipt. A reused active batch is only for reconciliation; it must not be dispatched again. Allocation/imports are serialized by locks. Visual workers may read shared source images but must write only their assigned drafts; they never touch run/checkpoint/manifest/llm/export files.

`settle-batch --run <folder> --batch <id> --outcomes-file <file>` accepts verified status records: requestId, jobId, status=completed|failed|blocked|cancelled|running|unknown, and optional concise reason. Match the original assigned file, not a path suggested by a model. Completed drafts are source/schema validated and imported serially. Failed/blocked/cancelled outputs are retained but not automatically accepted; running/unknown jobs keep reservations. Never claim platform job status from a model's own ready sentence.

After diagnosis use `batch --retry-request <id> --retry-kind transient|correction` for failed imports/jobs; one transient retry or at most two visual corrections. For a successfully imported detection requiring correction, use `batch --correction-request <id>`. It creates a fresh path and imports with replacement while retaining original evidence. No retry/correction may overlap an active batch. A failed packet does not discard valid siblings. If limits are exhausted, finish partial/blocked with quality gaps. No automated permission prompts for ordinary recovery, circuit-breaker deletion, scope expansion or fresh whole-run restart.

## Estimation fragments

Fragments use the existing estimate response shape: requestId, assumptions, items. Save them under estimation/drafts/<requestId>/ with distinct names and keep fragment paths/completed keys in progress.json. Final `assemble-estimates --run <folder> --parts-file <JSON array of run-relative fragment paths>` reads/combines them deterministically, then the existing importer checks current source binding, every key exactly once, ordered ranges and user-only rate/currency. Never pass fragments into the parent's context or fabricate missing estimates to finish.
