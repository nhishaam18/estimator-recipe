# Setup

Read the advertised SKILL.md first using native `read`; Kajoo stages its registered supporting files. Resolve `<skill>` from that exact path, retaining the full workspace or agent scope. Read references with `read`, write run configuration with `write`/`edit`, and invoke packaged Node scripts with native `bash`. Installed skills are read-only; never install dependencies or store evidence under `/mnt/skills`.

1. From the staged skill, run with native bash: node <skill>/scripts/cest.mjs setup --workspace /workspace
2. Use the returned writable runtime (/workspace/estimator-runtime/estimator). In runtime/scripts run npm ci --ignore-scripts.
3. Run node <runtime>/scripts/cest.mjs verify using the returned absolute runtime path. It checks Sharp and launches the preinstalled Playwright/Chromium pair. Do not install browser packages or repair caches.
4. Set CEST_RUNS_DIR=/workspace/estimator in the command environment for all operations. setup returns this path; it does not modify subsequent shell environments.
5. Developer needs native file/command tools and Firecrawl; Orchestrator needs kajoo/run-agent; Visual Analysis needs native image-reading/file-writing tools and its focused skill. verify does not test child-agent availability or model image access. No application, launch entry or credential file is created.

Only run trusted packaged scripts. Runtime dependencies are Cheerio and Sharp plus their locked dependencies. Keep the full relative package layout when transferring it.

Save returned runtime and run paths in the run evidence and a compact chat/artifact reference. No project records are required. On resume reuse the saved runtime/run paths and verified compatible dependencies. Do not repeatedly copy resources, install packages or initialize a new run merely because the chat resumed. When updated script resources are required, verify no process is active, refresh the writable runtime deliberately, verify it and keep run evidence separate.

