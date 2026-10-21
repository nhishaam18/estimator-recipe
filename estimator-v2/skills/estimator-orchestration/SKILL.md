---
name: estimator-orchestration
description: Use when coordinating Estimator website discovery, user sampling choices, Developer technical jobs and up to two isolated Visual Analysis jobs without loading detailed evidence into the main chat.
---

# Estimator coordination

Coordinate only. Resolve Developer and Visual Analysis IDs from Kajoo's advertised available_agents list. Never hardcode IDs or ask a child to launch another agent: Kajoo children cannot delegate. Use the assigned workers' models; Visual Analysis requires image capability. Missing agents/tools are blockers, not reasons to absorb their work into the main chat.

## Flow

1. Obtain the starting URL if missing. Always use Firecrawl discovery through Developer; never silently analyse only the seed. Start a fresh Developer job (omit runId) for discover, asking for saved plan path and every group ID/pattern/count/suggested quantity, not the raw URL list. Reuse an existing exact-scope discovery/plan on resume.
2. Present every group's count in Kajoo chat and obtain explicit quantities, including zero/all. Automatic tool approval is not sampling consent. Save those exact choices as small coordination data and pass the file path to a fresh Developer prepare job. Never expand the sample or replace failed URLs without authorization.
3. Developer freezes selection, initializes/resumes the run, runs bounded serial capture and prepares a batch. A partial receipt means send a fresh Developer continuation using its saved paths; do not restart setup or capture. The technical skill/scripts belong to Developer, not this chat.
4. When a NEW batch receipt contains reserved packets, save dispatch intent (batch ID and request IDs) in coordination notes BEFORE calling tools. Dispatch at most TWO run-agent calls in the SAME assistant tool-call batch, each to Visual Analysis with one packet's runDir/requestId/promptFile/image/resultFile. Omit runId and history/background for each independent job. Do not infer concurrency enforcement from middlewareConfig.maxConcurrency; the script allocates at most two packets. End the turn after dispatch and wait for Kajoo's automatic batch results. If the runtime cannot dispatch concurrently, run the same assigned packets serially without changing their paths or allocating replacements.
5. Save actual platform job IDs/statuses and compact receipts in a coordination outcomes file. Give its path and batch ID to a fresh Developer settle-batch job. Developer imports completed results serially and reserves the next batch. You never import, edit manifests or merged detections, draw annotations, inspect screenshots, reason over component reports or run technical shell commands.
6. Repeat until Developer reports detection accounting complete. Developer generates annotations, quality findings and the unique Build List; it proposes focused corrections where needed, consolidates components, estimates effort and validates/publishes saved reports. There is NO automatic paired raw/annotated-region second pass. Keep unresolved findings provisional and disclose that script checks do not establish visual completeness.
7. Developer estimation jobs process at most ten unique items per fresh job, saving fragments/progress and assembling source-bound complete estimates through scripts. Deliver only verified report/artifact links, coverage counts, Section/Inner totals, effort range and material limitations. Target CMS defaults to Sitecore; do not ask which CMS. Monetary cost requires an explicitly supplied rate/currency. Stop at reports/estimates, never implementation/deployment.

## Context, resume and errors

Keep coordination notes around 2 KB: runtime/run/plan paths, user decisions, active batch/request/job IDs, counts, last receipt path and blockers. Detailed evidence stays on disk. Use fresh Developer jobs per bounded assignment; repeatedly continuing one long Developer chat merely moves the context problem. Parent and child model/result-check costs all count when comparing traces.

An existing/reused batch is NOT a new dispatch authorization. On resume inspect saved dispatch intent and automatic platform job results; never redispatch active, unknown or ambiguously started work. Ask Developer to reconcile files/statuses. If status cannot be established, remain blocked rather than invent termination. Do not poll healthy jobs or run a sleep loop.

Route file/capture/dependency/import errors to Developer. Route Developer's concise packet-specific validation feedback to a fresh Visual Analysis correction job using a new reserved output path. Preserve successful results; never rerun a whole batch/site because one packet failed. Retry only after diagnosis: at most one transient retry, or two visual correction passes per request. Browser rate limiting/network stops preserve the circuit breaker and require explicit diagnosed recovery. Run-wide storage failures pause new dispatches. Credentials, permissions or scope changes are the user's decisions; routine validation is handled automatically.

Require worker receipts with status (completed/partial/blocked/failed/awaiting-input), saved output/error path, affected scope, counts and recommended next job. Visual Analysis may return ready, but only a verified platform completion plus Developer's source/schema validation accepts its file. A child failure or cancellation is not proof that no file was written. Reconcile before retrying, retain evidence and never hide unresolved failures behind a success summary.
