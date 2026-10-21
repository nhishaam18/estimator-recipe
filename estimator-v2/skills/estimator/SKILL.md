---
name: estimator
description: "Use when running the script-controlled desktop Estimator pipeline: Firecrawl grouping/sampling, captures, Kajoo screenshot-result imports, component/style reports and effort estimates."
---

# Packaged Estimator runtime

Estimator runs these trusted scripts directly with native bash. There is no Developer execution agent. Read this advertised SKILL.md once to stage resources; preserve its exact /mnt/skills/workspace/... or /mnt/skills/agents/<id>/... scope. The skill projection is read-only. No external model API, provider key, app/server, CMS implementation or deployment.

## Setup once and execute

On first use read [setup](references/setup.md) and run `node <skill>/scripts/cest.mjs bootstrap --workspace /workspace`. Immediately save its literal runtime, runsDir, receiptPath and verificationReceiptPath. Reuse that runtime after summaries. Recover a lost path from its bootstrap receipt; never substitute /mnt/skills for processing or reinstall there.

Use [flow contract](references/job-contract.md). Run `node <runtime>/scripts/cest.mjs flow --jobs-dir /workspace/estimator-config/jobs --id <stable-step-id> --kind <operation> <options>` directly. Scripts create immutable job files and checkpoints, execute deterministic stages and return compact receipts. Do not manually write routine job JSON or launch another agent to execute it. Repeating a step returns its receipt; it does not authorize another model dispatch. Changed inputs require reconciliation and a new ID. Partial progress uses a new advance step on the same run; blocked or uncertain execution stops.

Always use Firecrawl Map for a new starting URL, immediately persist the complete result and run flow discover-plan. Prefer an actual connector result file; inline-only output must be saved once without inventing a file handle or reducing the result. [URL planning](references/url-planning.md) defines script grouping. Show every group count and ask explicit quantities for each. Save approved quotas; flow prepare selects/initializes/captures and reserves packets. Never scan deferred URLs, resample on resume or treat tool approval as sampling consent.

## Model boundary and accuracy

Scripts prepare at most two screenshot packets; Estimator dispatches fresh Visual Analysis workers, waits for actual Kajoo outcomes and runs flow settle-batch directly. Only Visual Analysis interprets screenshots. Workers write isolated drafts; scripts validate source/geometry/parent ownership, import serially, draw annotations, refine families and generate reports. Estimator does not inspect screenshots or reconstruct detections. See [visual delegation](references/visual-delegation.md).

- Desktop only at 1440×900, full-page capture. Accept/dismiss or remove recognized consent/popups and recheck before capture. Use preinstalled Playwright/matching Chromium, bounded serial network-safe capture and preserved stops.
- Preserve Section + Inner components, composite cards/slider items/hero shortcuts, standalone CTAs, every supported occurrence and owned primitive fields. Annotation and unique implementation counts differ. No mobile-only families, forced low counts or unseen content.
- Reports retain component anatomy/fields, CSS, assets, fonts and typography. No automatic paired-region second pass. [Workflow](references/workflow.md) and [commands](references/commands.md) are conditional references, not repeated startup reads.
- Prepare consolidation/estimates via scripts; Estimator reasons over bounded saved text requests/evidence and saves source-bound decisions/fragments. Scripts validate/import/assemble. See [estimation](references/estimation.md); do not add an execution agent.
- Sitecore is default. Do not ask which CMS; explicit overrides only. Count each unique implementation once; parent composition excludes separately counted child work. Monetary cost requires user-supplied rate/currency.
- Reuse discovery-checkpoint.json, approved selection and imported results. Stop at reports and estimates, disclose gaps and publish only actual files. No phases/tasks, retired review viewer/ZIP, code generation or automatic CMS developer dispatch.
