import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export const SCRIPTS_DIR=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const SKILL_DIR=path.resolve(SCRIPTS_DIR,'..');
export function loadSkillSettings(){
 const settings=JSON.parse(readFileSync(path.join(SKILL_DIR,'settings.json'),'utf8'));
 for(const key of Object.keys(settings))if(/key|secret|token|password/i.test(key))throw new Error('Settings must not contain provider credentials');
 return settings;
}
