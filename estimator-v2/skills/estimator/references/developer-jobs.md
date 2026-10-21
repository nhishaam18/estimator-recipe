# Assignment-specific reads

Routine jobs read job.json, invoke cest.mjs job, and return its receipt. Do not read this table every time. [Job contract](job-contract.md) is for creating/diagnosing assignments.

| Judgment assignment | Read only | Limits |
| --- | --- | --- |
| First discovery/setup | [setup](setup.md), [URL planning](url-planning.md) | Bootstrap once; save Map immediately, plan/group, stop for user quotas |
| Native consolidation | [estimation](estimation.md) | Compact inventory; consult ambiguous reports, import, regenerate. No parent/child merge |
| Native estimates | [estimation](estimation.md) | At most ten unique items and relevant children/styles/evidence; save fragments/progress then assemble; no invented rate |
| Publication | [outputs](outputs.md), [handoff](developer-handoff.md) | Verify files/coverage, use assigned artifact tools, save receipts, reconcile uncertain writes |
| Capture failure | [capture recovery](capture-recovery.md) | Supported one-route recovery after settlement; no ad-hoc scripts or image analysis |
| Import failure | [job contract](job-contract.md); [annotation contract](annotation-contract.md) only if the finding requires it | Read named errors only; reserve correction for fresh Visual Analysis, never reconstruct detections |
| Other recurring error | Named error receipt; [commands](commands.md) only if needed | One focused diagnosis, then blocked if no packaged remedy; no source editing or repeated fresh repair jobs |

[Context budget](context-budget.md) is recovery guidance, not another startup read. Return compact paths/counts and next assignment. Cancellation needs resumed user authorization; a worker's own ready/blocked text does not establish platform status. Manual merge/undo remains an exact user-requested chat operation.
