# Runtime-created estimation tasks

Read `managing-kajoo-tasks` from its advertised skill path. It owns active tool/schema resolution, lifecycle, rank, Technical report and read-back. This reference owns Estimator's scopes and identity bindings. No phases/tasks are seeded by recipe onboarding.

## Initialize and reconcile

1. Resolve the actual current projectId from verified platform context and supported tools. Never invent IDs, create a new project or use another project's records. Check the capabilities needed now before writes.
2. Resolve this chat/task's saved session binding. For a new execution, choose one local sessionId and save the [binding template](../assets/task-bindings.example.json) at `/workspace/estimator-config/sessions/<sessionId>/kajoo-task-bindings.json` with native file tools. This local identity is distinct from the eventual script run ID and Kajoo IDs. Preserve the path in task descriptions/Technical reports so another chat can recover it. Ambiguous session context requires a focused clarification, not starting a duplicate run.
3. Before creating anything, reconcile current-project epics/tasks scoped to the saved session, following pagination. Match the session marker, task key, project, scope and references; titles alone are insufficient. Adopt an explicitly supplied task/epic only when scope matches. Read the [task plan](../assets/task-plan.json) for four sequential outcome scopes, predecessors and initial ranks. Do not create a task per URL, tile, component or tool call.
4. Create or reuse one run-scoped epic and four tasks. Put `Estimator session: <sessionId>; task key: <key>`, the binding path, scope, predecessor and acceptance evidence in each description, followed by one `## Technical report` section. Use exact supported schemas and numeric rank. New tasks use 1000, 2000, 3000, 4000; place the epic relative to existing project ordering. Preserve user-defined ranks. Persist each returned epicId/taskId/name immediately in the binding and read back its actual record/rank before continuing. Do not invent assignment IDs.
5. An uncertain create response requires reconciliation, not blind retry. Persist its session/key as pendingReconciliation, look up that scoped marker and reconcile the actual result before one retry. On resume reuse the same IDs and valid ranks. Repair a confirmed missing record only after inspecting references/dependents. Never silently duplicate or delete records.
6. Save/confirm in-progress on the actual task before direct work. Missing create/lifecycle capabilities block browser/model execution. Setup and intake before a script run use the session binding. After init returns the exact runDir, persist it immediately and retain plan/selection paths; resume the bound run instead of repeatedly invoking init.

## Execution and completion

The task-plan.json defines prepare, analyze, report and estimate scopes. Execute them sequentially, using their acceptance evidence. No phase-continuation approval is required. Continue automatically within the authorized scope; explicit URL-family quantities remain a user choice. Missing prerequisites, active locks and browser circuit breakers remain blockers.

- prepare: accepted URL scope/sample, writable setup and browser/dependency verification, one initialized run and saved paths.
- analyze: DOM grouping, prepared desktop capture and every required native prompt/image/import. After imports, run `all --through report` to create the initial annotations/report, inspect the annotated image and perform bounded corrections. This initial report is analysis evidence, not completion of the later report task. Record terminal receipts and unresolved coverage honestly.
- report: automatic refinement, native consolidation/import and report rebuild; verify current numbered reports, style/typography evidence, quality, validation and unique build list.
- estimate: native source-bound effort import, explicit assumptions/exclusions and user rate or null money; verify delivery manifest, published artifacts and Technical report. Stop before implementation.

`discovery-checkpoint.json`, pending requests/results and import hashes remain execution/evidence authority; Kajoo task status remains lifecycle authority. Bindings store IDs, scope and paths, never another set of statuses or model results. Never hand-edit script checkpoints to claim completion. Preserve browser-stop.json across task retries and ordinary resume. A live process, pending analysis or stale output file is not completion.

On resume read the binding, actual tasks/Technical reports and relevant checkpoint/evidence. Inspect a running PID/lock before another command; never remove an active lock. Reuse completed captures and imports, continuing pending requests only. Invalidate only downstream work whose inputs changed; retain earlier verified evidence and IDs.

Follow the shared skill's honest terminal statuses and verify persistence. Incomplete image/scan work stays unfinished. A provisional report may be done only as an explicitly provisional deliverable with its gaps recorded, never as complete site coverage. Do not force an epic to done while required tasks remain incomplete. Save and read back the Technical report and lifecycle fields before handoff; disclose failed persistence.

Detailed discovered/selected/deferred/scanned/failed counts, high/medium findings, exact evidence paths and estimate assumptions belong in the task Technical report and linked reports/artifacts. Final chat is a short outcome, material blocker/limitation and verified task/report links. No Sitecore Migration Artifact, specialist roster, provider client, CMS mutation, app or component generation is introduced.
