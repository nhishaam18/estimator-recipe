# Command contract

Run node <runtime>/scripts/cest.mjs <command>. Use --run with the exact absolute run folder returned by init. Compact stdout receipts are JSON; large data remains on disk. Default bounded stage duration is four minutes.

Read the advertised skill before resolving resources and invoke these commands with native `bash`. Save the discovery, plan, selected sample and exact run folder in run evidence and a compact chat/artifact reference. Resume the same files/checkpoints. No phases, epics or tasks are created.

| Operation | Command/options |
| --- | --- |
| Writable setup | setup --workspace /workspace |
| First-use copy/install/verify with reusable receipts | bootstrap --workspace /workspace |
| Script-owned normal transition | flow --jobs-dir <absolute folder> --id <stable step ID> --kind <kind> <options>; see [flow contract](job-contract.md) |
| Existing immutable job (compatibility/diagnosis) | job --file <absolute immutable job.json> |
| One-route recovery after settlement | recover-capture --run <folder> --url <selected route> --reason failed\|obstructed\|lazy-incomplete --diagnosis <observed evidence> |
| Dependency/browser check | verify |
| Required Firecrawl discovery | plan --url <seed> --discovery-file <saved JSON> |
| User quotas | select --plan <folder> --quotas-file <JSON keyed by group ID> |
| Approved Firecrawl sample | init --selection <plan folder> --name <name> |
| Compare/group | all --run <folder> --through group --minutes 4 |
| Capture/request preparation | all --run <folder> --through detect --minutes 4 |
| Import native analysis | import-result --run <folder> --request <id> --result-file <JSON> [--replace] |
| Annotation/report | all --run <folder> --through report --minutes 4 |
| Rebuild report | report --run <folder> |
| Consolidate list | consolidate --run <folder>, then import-consolidation --run <folder> --result-file <JSON> |
| Manual merge | merge --run <folder> --keys-file <JSON array> --name <name> |
| Undo model groups | reset-merges --run <folder> |
| Estimate preparation | estimate --run <folder> [--target <explicit user CMS/stack override>] [--rate <user hourly rate> --currency <ISO code>] |
| Estimate import | import-estimates --run <folder> --result-file <JSON> |
| Progress | status --run <folder> |
| Compact resume / next tile | next --run <folder> |
| Reserve two visual packets | batch --run <folder> |
| Import verified worker outcomes serially | settle-batch --run <folder> --batch <id> --outcomes-file <JSON> |
| Diagnose/retry a failed packet | batch --run <folder> --retry-request <id> --retry-kind transient\|correction |
| Correct an imported detection | batch --run <folder> --correction-request <id> |
| Assemble estimate fragments | assemble-estimates --run <folder> --parts-file <JSON array of run-relative paths> |


Detection/import receipts return one next packet and counts. Use next after resume, not between successful imports. Resolve prompt/image/result paths under the run folder. work-state.json saves derived progress; execution-notes.json holds compact decisions, job outcomes and quality gaps. See [context budget](context-budget.md). Wait for one bounded foreground command to exit; never background/poll/relaunch an active pipeline.

Desktop is enforced, not just a default. --viewports mobile or mixed viewports is rejected. --model on init is rejected; configure the image-capable model in Kajoo. On import-result, optional --model and --trace-id record actual analysis provenance only, never choose or call a model.

awaiting-analysis means scripts reserve packets; Estimator dispatches fresh Visual Analysis workers, then directly runs flow settle-batch for serial imports and the next reservation. No Developer execution agent. awaiting-consolidation/estimation means Estimator reads the bounded saved text request, reasons over relevant reports, writes source-bound decisions/fragments and runs script validation/import. It is not a request for user approval. Complete all pending tile imports before reporting. Keep quality correction passes bounded to two per affected tile. Browser stages honor a persisted stop; --retry-browser is an explicit operator action after inspection, never a resume default. Do not overlap operations; an interrupted lock requires checking its PID has exited before removal. Persist run/plan paths in saved run evidence and reuse them instead of repeating init.


Every URL intake starts with the Firecrawl MCP Map result, then plan/select and init --selection. The scripts consume the saved MCP response; they do not call Firecrawl directly. Sitecore is the automatic estimation target unless explicitly overridden; do not ask which CMS to use. Low-level init --urls-file remains for fixtures/diagnostics, not as a recipe intake path or Firecrawl fallback.
