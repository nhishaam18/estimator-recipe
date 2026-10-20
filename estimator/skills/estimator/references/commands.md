# Command contract

Run node <runtime>/scripts/cest.mjs <command>. Use --run with the exact absolute run folder returned by init. Compact stdout receipts are JSON; large data remains on disk. Default bounded stage duration is four minutes.

Read the advertised skill before resolving resources and invoke these commands with native `bash`. Before execution follow [task workflow](task-workflow.md): skill-created Kajoo records replace onboarding phases. Record the exact returned run folder in the existing session binding. Scripts never create or update Kajoo epics/tasks; the agent uses the shared task skill and supported Kajoo tools for that lifecycle.

| Operation | Command/options |
| --- | --- |
| Writable setup | setup --workspace /workspace |
| Dependency/browser check | verify |
| Explicit URL list | init --urls-file <file> --name <name> |
| Requested discovery | plan --url <seed> --discovery-file <saved JSON> |
| User quotas | select --plan <folder> --quotas-file <JSON keyed by group ID> |
| Approved sample | init --selection <plan folder> --name <name> |
| Compare/group | all --run <folder> --through group --minutes 4 |
| Capture/request preparation | all --run <folder> --through detect --minutes 4 |
| Import native analysis | import-result --run <folder> --request <id> --result-file <JSON> [--replace] |
| Annotation/report | all --run <folder> --through report --minutes 4 |
| Rebuild report | report --run <folder> |
| Consolidate list | consolidate --run <folder>, then import-consolidation --run <folder> --result-file <JSON> |
| Manual merge | merge --run <folder> --keys-file <JSON array> --name <name> |
| Undo model groups | reset-merges --run <folder> |
| Estimate preparation | estimate --run <folder> [--target <CMS/stack>] [--rate <user hourly rate> --currency <ISO code>] |
| Estimate import | import-estimates --run <folder> --result-file <JSON> |
| Progress | status --run <folder> |

Desktop is enforced, not just a default. --viewports mobile or mixed viewports is rejected. --model on init is rejected; configure the image-capable model in Kajoo. On import-result, optional --model and --trace-id record actual analysis provenance only, never choose or call a model.

awaiting-analysis/consolidation/estimation means the agent must read the saved request and perform native reasoning, write JSON, and import it. It is not a request for user approval. Complete all pending tile imports before reporting. Keep quality correction passes bounded to two per affected tile. Browser stages honor a persisted stop; --retry-browser is an explicit operator action after inspection, never a resume default. Do not overlap operations; an interrupted lock requires checking its PID has exited before removal. Persist run/plan paths in Kajoo tasks and reuse them instead of repeating init.

