# Requested URL discovery and sampling

Use the supplied URL list directly by default. If the user asks for Firecrawl, call firecrawl/firecrawl_map once for the seed and save the entire JSON result. Run plan --url <seed> --discovery-file <json>. The script normalizes same-host/www HTTP URLs, deduplicates and groups provisional path families. It returns all group IDs/patterns/counts and suggestions.

Show every group in Kajoo chat and ask for each integer quantity, zero or all. Do not infer consent from auto-approved tools. Save quotas keyed by group ID; run select --plan <folder> --quotas-file <json>. A seeded random sample is persisted for resume; never choose the first N implicitly or resample on retry. Run init --selection <same folder> once and retain its exact returned run folder.

Only selected URLs enter the desktop light scan. DOM comparison chooses representative full captures within that sample; other selected pages may receive propagated labels. Deferred URLs are untouched, failures are not replaced, and no LLM classifies the raw discovery list. export/url-groups.json distinguishes discovery totals from scanned sample totals. Host scope is the seed host plus www equivalent; other subdomains require a separate scope choice. Sampled coverage is not proof of all website components.

