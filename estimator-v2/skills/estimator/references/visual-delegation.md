# Isolated visual jobs

Estimator coordinates; Visual Analysis inspects images. Scripts capture, validate/import detections, refine boundaries, merge overlaps, draw boxes and build the unique list/reports. Preserve all current granularity, CSS/typography and evidence requirements; this is a context separation, not a simplified detector.

Resolve Visual Analysis's actual agent ID from Kajoo's advertised available_agents list, not from a hardcoded database ID. The orchestrator needs kajoo/run-agent; the child uses only its focused visual skill and platform-native image/file tools. If the agent or tool is missing, stop with the configuration gap rather than silently falling back to the main growing conversation. Configure an image-capable model for the child; do not downgrade capability automatically to reduce cost.

## Detection dispatch

On awaiting-analysis, read the compact next receipt. Call run-agent with the Visual Analysis agent ID and a message containing ONLY mode=detect, the exact runDir, requestId, promptFile, image and resultFile. Paths come from that receipt. Omit `runId` for each new packet, including corrections: Kajoo creates a fresh child chat/checkpoint. Do not forward the parent's history, full URL list, other results or screenshots; omit background unless a short packet-specific constraint is essential.

Example message (replace paths/IDs with actual receipt values):

```text
mode=detect
runDir=/workspace/estimator/<run>
requestId=<next.requestId>
promptFile=<next.promptFile>
image=<next.image>
resultFile=<next.resultFile>
Inspect only this packet using estimator-visual-analysis. Save the required JSON; return a compact receipt.
```

After calling run-agent, end that response and await Kajoo's automatic result delivery. Do not launch the next child or pipeline concurrently and do not poll job status; use status tooling only when the user requests it. Save the outstanding request/job IDs in execution-notes.json before dispatch so a resumed parent does not duplicate an active job. Record completion after receiving its result.

The orchestrator does NOT read the image or full detection JSON. For a ready receipt, run import-result with the expected requestId and original assigned resultFile, not an arbitrary path from prose. Script validation is authoritative for data integrity. On blocked/missing/malformed output, keep that packet pending and diagnose the specific gap. Empty detections require focused visual recheck; use a new job with the same packet, not a capture restart. Corrections write a separate draft filename, then import-result --replace; never overwrite archived original responses. Each affected tile still has at most two correction passes per execution. Do not automatically resume old runIds to save setup cost, or start retries while a child is active.

## Annotation review and correction

After report generation, run review --run <folder>. It prepares full-width paired raw/annotated crops with overlap and returns one pending review packet. Dispatch mode=review with its requestId, promptFile, rawImage, annotatedImage and resultFile to a fresh Visual Analysis run (omit runId). Import with import-review --run <folder> --request <id> --result-file <assigned file>. Follow the next receipt until every current review packet has a receipt.

A needs-correction or blocked review is NOT approval to proceed. Read its small findings file, dispatch focused detection corrections for supported affected requestIds, import replacements and regenerate report/review packets. If IDs are missing, scripts/targeted evidence extraction identify the overlapping source tile; do not guess or resend the entire run. Review image changes invalidate previous receipts automatically. Review status never overrides automated quality.json or promotes annotation-only boxes into Build List families. Record unresolved findings as provisional, bounded by the existing correction limit; never loop until a forced pass.

Consolidation can change labels/ownership; after the final regenerated report, repeat review for changed images/ledgers and reuse intact unchanged receipts. Before delivery require complete current review accounting or explicitly disclose outstanding review/quality gaps. Keep reports/estimates provisional where evidence is unresolved. Review pass is not a semantic completeness or implementation-readiness guarantee.

Sub-agent status evaluation adds a model call, and platform instructions/tools/memory are still supplied. Benchmark total parent + child + result-check cost and output quality. Isolation is supported locally by creating a child chat when runId is omitted; verify local2 behavior with distinct child chat IDs and bounded input sizes. Sub-agent traces may share the parent's LangSmith thread for display while their checkpoints remain separate. No platform-code change or deployment is part of this recipe update.
