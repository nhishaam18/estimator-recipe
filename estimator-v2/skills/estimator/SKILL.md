---
name: estimator
description: Execute bounded Estimator Developer assignments using saved jobs, scripts and evidence. Discover URLs through Firecrawl, capture desktop pages, import visual results, produce component/style reports and effort estimates.
---

# Developer entry

Read this advertised SKILL.md to stage resources. Resolve scripts against its exact path, preserving `/mnt/skills/workspace/...` or `/mnt/skills/agents/<id>/...`. Packaged skills are read-only. Use native read/write/bash. No nested agents, external model API, application, CMS implementation or deployment.

## Assigned job first

Read only the supplied immutable job.json (max 64 KB). Keep its path and original assignment across summaries. With the supplied absolute runtime, execute one foreground command:

`node <runtime>/scripts/cest.mjs job --file <absolute job.json>`

Return receiptFile, status, counts, blockers and at most two packet paths. Do not read more references, list directories, search for scripts, inspect images or reconstruct history for a successful routine assignment. The command saves logs/progress and its receipt. Repeating it returns the receipt without repeating work. Replayed/reused packets never authorize redispatch. A blocked receipt is a result to return, not permission to write diagnostics or repair scripts. Read [job contract](references/job-contract.md) only when creating/diagnosing an assignment.

## First discovery

Read [setup](references/setup.md) only on first use or actual setup failure. Run `node <skill>/scripts/cest.mjs bootstrap --workspace /workspace` once; save receipt/runtime paths immediately. Later jobs use that runtime without repeating setup/npm/browser verification. Bootstrap reuses verified receipts when identities match.

Always use Firecrawl Map for the starting URL, reusing an exact-scope saved response on resume. Immediately save the complete result, or copy an actual platform-provided result file, before other reads. Never reconstruct URLs from memory, re-Map because output was cleared, or silently narrow a successful response. Execute a discover-plan job on that saved file; return EVERY group ID/pattern/count/suggestion. Orchestrator obtains explicit quantities and freezes the sample. Read [URL planning](references/url-planning.md) only for discovery. Unavailable complete output or a connector failure is blocked, not a loop of different limits.

## Scope and accuracy

- Desktop only at 1440×900, full-page captures. Accept/dismiss or remove recognized consent/popups and recheck before capture. Preserve network stops; no mobile-only families.
- Visual Analysis owns screenshot interpretation. Preserve Section + Inner components, composite cards, standalone CTAs, repeated occurrences and owned primitive fields. Annotation and implementation counting differ. Never bypass source/geometry/ownership validation, invent unseen content or force lower counts.
- Reports retain fields/elements, CSS, assets, fonts and typography. Consolidation cannot merge parent and child. Estimates count unique implementation once. Sitecore is default. Do not ask which CMS; use explicit overrides. Monetary cost requires a user-supplied rate/currency.
- Reuse discovery-checkpoint.json, approved selection and saved results. No phases/tasks, retired viewer/ZIP or code generation. Stop at reports and estimates and disclose gaps.

Only for native consolidation, estimates, publication or a separate diagnosed failure: read the matching row in [Developer assignments](references/developer-jobs.md), then the relevant reference. [Full workflow](references/workflow.md) and [commands](references/commands.md) are reference material, not mandatory startup reads.
