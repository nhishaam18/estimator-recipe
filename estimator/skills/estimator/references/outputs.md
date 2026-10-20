# Saved outputs

The run folder is returned by init and must be saved in Kajoo task/checkpoint metadata. Paths below are relative to that folder.

| Path | Purpose |
| --- | --- |
| run.json / discovery-checkpoint.json | Scope, desktop capture state, saved stage progress and Kajoo usage unavailable markers |
| input/ | Supplied URL list or frozen discovery plan/sample |
| html/desktop, rects/desktop, scan/desktop | Prepared DOM, measured geometry and structural scans |
| shots/desktop | Original prepared full-page desktop screenshots |
| analysis/desktop | Measured CSS, typography, assets and capture warnings |
| analysis-requests/ | Native Kajoo prompts, tiles, hashes, imports and revision history |
| llm/desktop | Validated merged detections, not a direct API cache |
| consolidation/ | Native grouping request and immutable result snapshots |
| estimation/ | Source-bound effort request and result snapshots |
| browser-stop.json | Persistent browser circuit breaker; ordinary resume must not bypass it |
| export/report.md | Human/agent entry report with named component links |
| export/components/ | Numbered readable component reports and evidence appendices |
| export/discovery.json | Complete evidence/hierarchy/field/appearance record |
| export/annotated/desktop | Annotated PNGs and their JSON boundary/provenance ledgers |
| export/build-list.csv, .json, .md | Unique Section/Inner implementation inventory |
| export/component-validation.json | Excluded content, owned parts and uncertain detections |
| export/quality.json | Evidence quality and affected native request IDs |
| export/url-groups.json | Optional discovered/selected/deferred/scanned/failed group accounting |
| export/estimates.md, .json | Provisional low/likely/high labor, assumptions and optional user-rate cost |
| export/delivery-manifest.json | Delivery paths and estimate status; share with downstream agents |

Keep the complete run/evidence together for portability. No offline viewer, viewer ZIP or preview application is produced. Model usage and actual model billing remain in Kajoo. Reports must distinguish original captures from labels propagated by structural matching, and sampling from complete site coverage.

