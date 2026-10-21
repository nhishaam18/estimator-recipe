# Setup once, then reuse

Read the advertised SKILL.md first using native read to stage resources. Preserve its exact /mnt/skills/workspace/... or /mnt/skills/agents/<id>/... scope. Skills are read-only; invoke trusted Node scripts with native bash.

First use: `node <skill>/scripts/cest.mjs bootstrap --workspace /workspace`.

Bootstrap materializes /workspace/estimator-runtime/estimator, installs locked dependencies via npm ci --ignore-scripts, verifies Node/Sharp and preinstalled Playwright/matching Chromium, and writes atomic receipts under /workspace/estimator-runtime/.bootstrap/. It never downloads browsers or calls a model. Source, lock, Node, installed dependency and browser identities bind verification. Matching receipts avoid copying/installing/browser launch. Image access by the model is not tested.

Save runtime, runsDir, receiptPath and verificationReceiptPath immediately before other calls. Fresh jobs use the returned runtime directly; do not bootstrap simply because their chat is empty. Set CEST_RUNS_DIR to returned runsDir for low-level plan/select/init; absolute runDir jobs resolve their own run root. No app/server/provider key is created.

Failures return a saved blocked receipt/log path. No fallback browser installation, repeated npm commands or guessed paths. Reconcile locks before recovery. A deliberately updated recipe may bootstrap again when idle; source hashing refreshes runtime without removing run evidence. Legacy setup is copy-only and verify is a diagnostic probe, not the normal first-use sequence.
