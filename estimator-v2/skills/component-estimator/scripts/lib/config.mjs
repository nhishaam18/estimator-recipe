// Runtime settings contain no model-provider credentials.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCRIPTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SKILL_DIR = path.resolve(SCRIPTS_DIR, '..');

/** settings.json merged over nothing: it is the single source of defaults for a run. */
export function loadSkillSettings() {
  const file = path.join(SKILL_DIR, 'settings.json');
  const json = JSON.parse(readFileSync(file, 'utf8'));
  for (const k of Object.keys(json)) if (/key|secret|token|password/i.test(k)) throw new Error(`settings.json must not hold secrets (found "${k}").`);
  return json;
}
