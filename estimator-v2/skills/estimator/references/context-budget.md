# Small context with durable assignments

Routine Developer jobs read entry skill and immutable job.json, invoke one job command, return compact receipt. Do not reread the full workflow, probe setup or inspect directories. Original assignment is in jobFile, not a lossy summary. Keep jobFile/runtime/runDir/receipt and remaining objective in every summary; recover only that small file after context loss.

Save setup receipts and complete Firecrawl output immediately before other tool reads. Store detailed evidence in files, not conversation summaries or tool caches. Never repeat Map/capture because a result was cleared. Keep execution-notes/coordination around 2 KB with decisions, IDs, counts, pending/errors, estimate progress and limitations.

Middleware balances evidence retention against loss: Developer summarizes at 40 messages, keeps 12, summary input cap 24K estimated tokens; clears older tool outputs at 40K retaining eight. Orchestrator summarizes at 24, keeps eight, summary input cap 16K; clears at 24K retaining six. Visual Analysis is unchanged. These are not provider token ceilings; a fresh agent still receives platform instructions/tools. Lower retention alone is not a cost optimization when it causes rework. Short jobs should finish before summarization; durable assignments remain authoritative.

One foreground job command, no shell backgrounding/polling/duplicate processes. Scripts hold locks, validate batches/imports and reserve at most two packets; middleware maxConcurrency does not enforce fan-out. Unknown ownership/stops blocks until reconciled. Return a blocked receipt instead of enlarging the same job into debugging. One separate supported recovery/diagnosis, then preserve gaps. Never read images or invent detection JSON as Developer.

Keep source hashes, resolution, overlap, Section/Inner boundaries, CTAs, owned fields and complete typography/styles. No automatic paired-region pass. Consolidate compact inventory with ambiguous evidence only; estimate ten unique items with relevant children/evidence, save fragments and assemble. Do not drop fields/components to save tokens.

Benchmark all agents/result checks using identical frozen inputs and cache conditions. Inspect calls, cache creation, retries, persisted outputs and annotation/build-list quality. Parallelism reduces latency, not necessarily cost. No recipe setting changes Kajoo's global system prompt, cache TTL or completion evaluator; these remain outside this update. Deterministic tests cannot certify a live cost reduction.
