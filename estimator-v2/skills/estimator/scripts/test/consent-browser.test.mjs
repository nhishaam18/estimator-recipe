import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveBrowserRuntime} from '../lib/browser.mjs';
import {dismissConsent, inspectConsent,dismissObstructingPopups} from '../lib/pageprep.mjs';

test('consent acceptance cleans hidden remnants before evidence and never removes page content',async()=>{
 const {chromium}=resolveBrowserRuntime(),browser=await chromium.launch();
 try{
  const page=await browser.newPage();
  await page.setContent('<main><h1>Insurance privacy services</h1><p>Cookie technology article</p><button>OK</button></main><div class="cc-window" style="position:fixed;bottom:0"><p>We use cookies</p><a class="cc-allow" href="#">Accept All</a></div><div class="cc-revoke" style="display:none">Cookie Policy</div>');
  await page.locator('.cc-allow').evaluate(el=>el.addEventListener('click',e=>{e.preventDefault();el.parentElement.style.display='none';}));
  assert.equal(await dismissConsent(page),'accepted');
  assert.equal(await page.locator('.cc-window,.cc-revoke').count(),0,'hidden accepted containers are removed before saving HTML');
  assert.equal(await page.locator('main button').count(),1);
  assert.equal((await inspectConsent(page)).status,'clear');
  await page.setContent('<main><h1>Page</h1></main><div role="dialog" style="position:fixed;bottom:0"><p>This site uses cookies to provide services</p><a href="#">Configure</a></div>');
  assert.equal((await inspectConsent(page)).status,'blocked');
  await dismissConsent(page);
  assert.equal((await inspectConsent(page)).status,'clear');
 }finally{await browser.close();}
});

test('marketing popup dismissal is scoped and unresolved recognized dialogs block capture',async()=>{
 const {chromium}=resolveBrowserRuntime(),browser=await chromium.launch();try{
  const page=await browser.newPage();await page.setContent('<main><button>Close</button><h1>Normal content</h1></main><div role="dialog"><h2>Subscribe to our newsletter</h2><button aria-label="Close dialog" onclick="this.parentElement.remove()">×</button></div>');
  assert.equal((await dismissObstructingPopups(page)).dismissed,1);assert.equal(await page.locator('main button').count(),1);
  await page.setContent('<div role="dialog"><h2>Subscribe to our newsletter</h2><button>Subscribe</button></div>');
  assert.equal((await dismissObstructingPopups(page)).status,'blocked');
 }finally{await browser.close();}
});

