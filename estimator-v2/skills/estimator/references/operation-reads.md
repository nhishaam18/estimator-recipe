# Conditional reference reads

Read the short entry once; do not preload every reference.

| Operation | Read only |
| --- | --- |
| First discovery/setup | [setup](setup.md), [URL planning](url-planning.md) |
| Normal script transitions | [flow contract](job-contract.md) |
| Native text consolidation/estimates | [estimation](estimation.md); relevant assigned component/child reports, at most ten unique items per chunk |
| Publication | [outputs](outputs.md), [developer handoff](developer-handoff.md) |
| Capture failure | [capture recovery](capture-recovery.md), named receipt/log |
| Import failure | Named error; [annotation contract](annotation-contract.md) only if required |
| Resume/context loss | [context budget](context-budget.md), exact saved coordination checkpoint |

Estimator executes scripts directly and reads compact receipts. There is no Developer execution agent. Model reasoning is limited to screenshot analysis by Visual Analysis and bounded consolidation/estimates by Estimator. Manual merges/undo require the exact user request. Cancelled work requires resumed user authorization.
