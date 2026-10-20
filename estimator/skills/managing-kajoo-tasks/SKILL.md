---
name: managing-kajoo-tasks
description: Manage Kajoo epics and tasks. Set in-progress when execution has actually started and persist an honest final status when work stops.
---

# Manage Kajoo epics and tasks

Use for creating, updating, or executing Kajoo tasks and epics in the current project. Use supported Kajoo tools; discover missing tools and check their schemas before writes. Reuse verified IDs and context, fetch missing details, and preserve unrelated fields.

## Required tools upfront

Tool names below are base names. Kajoo MCP tools may be exposed with the `kajoo__` prefix, for example `kajoo__list-tasks`, `kajoo__update-task`, or `kajoo__create-epic`. Resolve each base name to the matching tool on the Kajoo MCP server and invoke its exact exposed name. Do not treat a tool as missing merely because it is prefixed, or guess a name without checking active tools/discovery.

Check active tool schemas and load only missing tools required for the requested operation before the first write. Reuse verified context and successful results; do not require every tool for every request.

| Operation | Tools to check |
| --- | --- |
| Read/find tasks | `list-tasks`; `get-task` for details not already available |
| Read/find epics | `list-epics`, including supported task/progress details when needed |
| Create | `create-task` and/or `create-epic`; relevant lookup tools to avoid duplicates and verify links |
| Update | `update-task` and/or `update-epic`; relevant lookup tools for current state and verification |
| Execute a task | `update-task` for start and finish statuses, task lookup tools, and the tools needed to perform and verify the actual work |
| Delete | `delete-task` and/or `delete-epic`; relevant task/epic lookup tools to inspect scope, dependencies, and verify the result |

If a required capability is unavailable, explain what is missing before making changes; do not start task work if its lifecycle updates cannot be saved. Use returned records to verify writes when sufficient; fetch only missing confirmation. Deletion requires explicit authorization for the exact scope and any required tool confirmation. Do not assume deleting an epic deletes its tasks.

## Task lifecycle (required)

1. Resolve the task in the current project and read its scope, acceptance criteria, dependencies, and current status. Do not duplicate an existing task or restart completed work without a requested change.
2. Before direct task work, update its status to `in-progress` and confirm the update succeeded. For delegated work, the owner marks its Kajoo task in-progress when execution starts; the coordinator projects running workflow state only after the real dispatch is accepted. Assignment alone is not execution. If already `in-progress`, verify that it is this run's task rather than another active worker's. If a required dependency or input is missing, set `blocked` instead and explain what must be resolved. If the status update fails, report the problem and do not start execution.
3. Perform the scoped work and record concise progress and verification evidence using supported task fields. Preserve existing details. Assignment or delegation alone is not completion; track delegated work through its result.
4. Whenever work finishes or stops, update the task before the final handoff: `done` only when acceptance criteria are met and verified; `review` when implementation is complete but required review/approval remains; `blocked` when missing input, access, a dependency, or a failure prevents progress; `todo` when intentionally deferred with no active worker and no blocker. Leave `in-progress` only while work is genuinely continuing. Explain unfinished work, blockers, and the next action.
5. Confirm the final update succeeded, then report the actual outcome. If it fails, state that the saved status is stale and give the intended status; never claim it was updated. On resume after interruption, inspect current state and recover unfinished steps without repeating successful work.

## Task ownership and dispatch

The assigned owner reads the current task and completes its scoped work, verification,
outputs, final Technical report and actual Kajoo lifecycle status. The coordinator
schedules/reviews; it does not rewrite an owner's report or finish a successful task on
its behalf. A rejected result returns to the same owner for a bounded correction.
Updating a global workflow projection from a verified owner result is coordination,
not permission to manufacture or change the task's technical outcome.

Dispatch with `Work on <kajoo-task taskId="ACTUAL_ID" name="ACTUAL_NAME" />.` using
verified values. The owner calls `get-task` first, reads its scope/dependencies and
linked artifacts, then loads the required domain procedure. Do not paste the task
body, tool inventory, skill contents, acceptance checklist, configuration snapshot or
repeated boilerplate into `run-agent`. Add only genuinely new task-local facts or an
exact input/packet/postflight reference absent from the task. Required execution packets
and approval gates remain required; reference their saved paths rather than copying
their contents. If a durable instruction is missing, fix the pending task description
before dispatch; do not change a running owner's scope through a hidden long prompt.

Parallel owners write separate task/attempt outputs and their own task records. They
must not replace the same artifact, file or checkout concurrently. Declare an integration
owner that waits for all required outputs before combining shared configuration. If
isolation cannot be established, serialize the conflicting work. Fetch current records
before writes and preserve unrelated fields; this is not a substitute for isolation.

## Technical report and output

Keep one `## Technical report` section at the end of the existing task `description`.
Create it from the task template; for an existing task without one, append it once.
Use the supported `update-task` description field, never a new DTO/API field. Before
updating, read the latest task and preserve all requirements, acceptance criteria and
other sections above the report exactly. Replace only this final section, not the whole
task with a summary, and never continually append duplicate reports. Preserve unrelated
fields and another active worker's work.

Write a readable Markdown report with the attempt identity and outcome, verified
configuration or changes, checks and material limitations, blockers/next owner, and
references to the structured result and supporting evidence. Never include secrets or
raw bulk logs. Replace the current report for a new attempt, retaining prior attempt
files in the domain's evidence folder. Task status remains the lifecycle authority and
domain evidence remains the validation authority; a report alone does not prove success.

Save and read back the description with the honest final lifecycle status before the
handoff. If persistence fails, report it rather than claiming a saved handoff. Coordinators
fetch this section to locate evidence and preserve it during status-only updates. Final
chat gives only a short user-facing outcome, material blocker/next action and task link;
detailed findings stay in the task's final Technical report section.

## When to create records

- Create a task when the user requests tracking or when an agreed piece of work needs its own owner, status, verification, or follow-up. Keep each task focused on one independently verifiable outcome; split work only when parts need separate tracking or handoffs.
- Create an epic when an agreed larger outcome needs several related tasks coordinated together. Give it a clear shared goal; a standalone task does not require an epic. Reuse a suitable existing epic rather than creating another for the same outcome.
- Check relevant existing records before creating anything. Extend or resume matching work instead of duplicating it. Do not create records for every tool call, small execution step, quick question, or speculative idea unless the user asks to track it.

## Create and update

- Create only needed records with clear names, concise scope, and verifiable acceptance criteria. Use `draft` for unready tasks and `todo` for ready tasks unless execution is starting immediately.
- Link tasks to the correct project epic and assign real agent IDs when requested. Reuse existing records; narrow lookups rather than listing everything repeatedly.
- For epics, record the shared outcome and related tasks. Prefer derived status; do not force an epic to `done` while required tasks remain incomplete. Preserve explicit overrides unless a change is requested. Epic overrides support `todo`, `in-progress`, and `done`, not task-only statuses such as `blocked`.
- A metadata-only edit or read-only status request does not start task execution. Do not change execution status merely because a task was viewed or renamed. Do not delete tasks or epics without explicit authorization.

## Plan order

- Persist the intended display order with an explicit numeric `rank` for each epic and each task in an ordered plan. Task ranks order tasks within their phase; dependencies and task descriptions do not determine display order.
- Decide ranks before creating records, including parallel creates. For a new ordered set, use distinct ranks spaced by 1000 (1000, 2000, 3000, ...). Never rely on creation timestamps, returned IDs, call order or numbered titles to establish the sequence.
- When adding to an existing phase or plan, inspect the relevant siblings and place the new record relative to their existing order. Preserve valid ranks and user-defined ordering; do not reset unrelated records or recreate tasks to repair order.
- On resume, reuse the same IDs and existing valid ranks. Repair missing, duplicate or inconsistent ranks only within the ordered set being prepared, respecting explicit user ordering. Read back the ranks and confirm the intended sequence before reporting the plan ready. A rank-only repair does not change task status or authorize execution.

## Markdown references

Use `<kajoo-task taskId="TASK_ID" name="TASK_NAME" />` and `<kajoo-epic epicId="EPIC_ID" name="EPIC_NAME" />` in user-facing descriptions and summaries. These examples are escaped with backticks: replace placeholders with verified IDs/names and remove backticks in actual output. Escape &, ", <, and > in names as &amp;, &quot;, &lt;, and &gt;. Do not add projectId or chatId attributes. If an ID or name is unknown, use ordinary text.
