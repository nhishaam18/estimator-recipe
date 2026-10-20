# Execution with bounded context

Reduce repeated history and orchestration, not image resolution/overlap, granularity, styling/typography evidence or coverage. Scripts prepare requests, merge tiles, draw annotations, validate and report; Kajoo's model still inspects every required tile and the assembled annotation.

## Working record

Keep exact runtime/run/plan paths. `node <runtime>/scripts/cest.mjs next --run <folder>` writes work-state.json and returns counts, source paths and one next operation. Pipeline/import commands also refresh it. Follow the next receipt already returned by detect/import; do not call next between successful imports.

Keep execution-notes.json as a separate small agent-written record: exact runtime/run/plan paths, explicit user decisions, current operation, visual-review outcomes, unresolved findings and report/estimate progress. Update at transitions, before long work and before compaction. Keep it around 2 KB with evidence paths/IDs. No full URL lists, screenshots/base64, DOM, result JSON, report bodies or command history. Paths alone do not prove completion.

After compaction/resume, read these small records and only the source for the next operation. Do not replay setup/discovery, remap, resample, reinstall verified dependencies or reopen completed images just to recover history. Inspect existing processes/locks before resuming. Confirm a lock owner exited before removing only that stale lock. Preserve browser-stop.json.

## One screenshot packet

1. Run all --run <folder> --through detect --minutes 4 once in the foreground and wait for it to exit. Resume partial work on the same run. On awaiting-analysis stop launching the pipeline and inspect packets.
2. Read only next.promptFile and OPEN next.image, prefixing paths with the run folder. The prompt contains hash, viewport, tile index, geometry, response schema and bounded DOM hints. Normally do not reread request.json. Never infer image content from hints.
3. Write specified JSON once to next.resultFile using the native writer. Do not echo detections in chat, embed images/base64 in shell commands, rewrite results in another tool call or reread them to prove writing succeeded. Import validates them. File-writing arguments may remain in context; avoid duplicate payloads.
4. Run import-result --run <folder> --request <next.requestId> --result-file <absolute draft path>. Read its count, warning and next packet. Scripts retain originals, validate hashes/coordinates/parents and merge overlap. Do not repeat this in prose or edit llm caches manually.
5. Correct validation failures using this packet and the specific error. For an empty result, recheck this tile once: fix omissions or preserve a genuine blank/decorative result with its reason and save the visual check in execution-notes.json. Do not restart capture. Reporting rejects entirely empty analysis; finish blocked/provisional if blank captures cannot support estimation.
6. At zero pending resume all --through report --minutes 4. Read quality findings and OPEN the assembled annotation at legible scale against raw evidence. Data validation is not visual validation. Correct affected tiles with import-result --replace and regenerate; retain the existing two-pass correction limit per affected tile per execution. Unresolved findings stay provisional.

Do not routinely load the full manifest, raw HTML/style ledger, run.json or prior results. On real failures use scripts to extract affected records/counts/paths instead of cat/head/tail of huge JSON. Never truncate required output or omit evidence to meet a token target. Keep tile dimensions, overlap, JPEG quality and visual inspection unchanged.

## Commands and later reasoning

Use one bounded serial foreground command, then its receipt. No &, nohup, sleep/ps polling loops, duplicate launches, automatic retry sweep or circuit-breaker clearing. If the platform returns a running session handle, await that same handle using its supported mechanism. Do not launch a replacement; resume only after exit.

Save the original Firecrawl response through the platform's file-saving mechanism. Do not regenerate URLs from memory or rewrite discovery as a giant shell heredoc. If direct saving is unavailable save the exact returned data once with a file tool; do not repeat Map just for another copy. Scripts normalize/group/sample it. Show every group and obtain the existing required quantities. State selected URL and representative capture counts: one starting URL does not mean one processed page.

Consolidation: read prompt/request once, consult only ambiguous component reports, and do not reload all screenshots/raw discovery. Estimation: read its request once, then relevant component reports and child definitions in small batches, consulting linked measurements as needed. Save draft rationale/assumptions and completed keys so old reports need not be reread after compaction. Preserve complete inventory coverage and styling/typography. Never guess missing measurements to save tokens.

## Middleware and verification

Agent settings summarize at 24 messages, retain six recent messages (respecting tool-call/result pairs), cap summarizer input at 12,000 estimated tokens, and clear tool outputs at 12,000 estimated tokens retaining two messages. The message-count trigger avoids relying on approximate image token estimates. Do not add a token condition beside messages expecting OR: this platform combines fields within one trigger with AND. These settings are not a provider-token ceiling. Approximate counting, images, schemas and assembled requests can differ. Tool-output clearing alone does not guarantee removal of old images or assistant tool arguments; summarization must compact those older exchanges. Do not claim isolated per-tile sessions.

After applying the recipe verify the destination agent imported these settings. Compare a fresh same-scope/model LangSmith run: input per call, calls per tile, cache creation/read, summary activity, retries and complete output quality. Billing stays external (null means unknown). Local tests cannot certify a saving percentage or visual accuracy equivalence. Report persistent large prompts without changing platform code or degrading discovery.
