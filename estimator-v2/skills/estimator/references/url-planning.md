# Firecrawl URL discovery and sampling

For every provided starting URL, use the configured Firecrawl MCP Map operation and save only its complete URL list as {"links":["https://..."]}, omitting title/name/description. Firecrawl is required, not optional. Stop with the missing capability if it cannot run; do not use a direct URL list, seed-only scan or another crawler as a fallback. Reuse an already saved result for the same scope on resume. Run plan --url <seed> --discovery-file <json>. The script normalizes same-host/www HTTP URLs, deduplicates and groups provisional path families. It returns all group IDs/patterns/counts and suggestions.

Return every group to Orchestrator, which shows it in Kajoo chat and asks for each integer quantity, zero or all. Do not infer consent from auto-approved tools. Save quotas keyed by group ID; run select --plan <folder> --quotas-file <json>. A seeded random sample is persisted for resume; never choose the first N implicitly or resample on retry. Run init --selection <same folder> once and retain its exact returned run folder.

Only selected URLs enter the desktop light scan. DOM comparison chooses representative full captures within that sample; other selected pages may receive propagated labels. Deferred URLs are untouched, failures are not replaced, and no LLM classifies the raw discovery list. export/url-groups.json distinguishes discovery totals from scanned sample totals. Host scope is the seed host plus www equivalent; other subdomains require a separate scope choice. Sampled coverage is not proof of all website components.

