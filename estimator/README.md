# Estimator 2.0.0

Canonical authoring package for the skills-first Estimator recipe. Edit this directory directly; it uses the same final Markdown/metadata layout as Sitecore Migration v3. The package publication pipeline mirrors `packages/kajoo-recipes/recipes` to its configured external repository during stage/prod deployment. Do not regenerate it from legacy `.agents/recipes` sources.

Onboarding loads one agent, two skills, Kajoo/optional Firecrawl connector definitions and a start prompt. It creates no predefined phases. At execution the estimator skill creates/reconciles four ordered tasks under one run epic, saves actual IDs and paths, and follows the shared managing-kajoo-tasks lifecycle skill. Script checkpoints and evidence remain separate from task identity bindings.

Analysis remains desktop-only through Kajoo's image-capable model. Bundled Node scripts capture prepared pages, validate native imports, annotate, consolidate and export reports/effort estimates. No standalone app, external model client, component code generation or CMS deployment is included.

Validate recipe contracts with `node --test packages/kajoo-recipes/recipes/estimator/tests/*.test.mjs`. Runtime tests live under `skills/estimator/scripts/test/`; use installed locked dependencies and preinstalled Playwright/Chromium. No platform writes are made by these local tests. Live Kajoo record creation still requires normal end-to-end validation in a test workspace.
