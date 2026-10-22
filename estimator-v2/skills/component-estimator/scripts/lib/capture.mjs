import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchBrowser } from './browser.mjs';
import sharp from 'sharp';
import { logJob, outOfTime } from './jobs.mjs';
import { attachRequestPolicy } from './requestpolicy.mjs';
import { getRun, inRun, updateRun, writeJson, readJson } from './store.mjs';
import { compareViewport, hasShot, VIEWPORT_SIZES } from './types.mjs';
import { dismissConsent, loadLazyContent } from './pageprep.mjs';
import { computeSimilarity } from './similarity.mjs';
import { looksBlocked, looksLikeShell, scanHtml } from './vendor/scanner.mjs';
import { collectWebsiteEvidence, observeAssets } from './websiteanalysis.mjs';
const UA = 'Mozilla/5.0 (compatible; EstimatorBot/0.1)';
const bounded=(value,fallback,min,max)=>Number.isFinite(Number(value))?Math.min(max,Math.max(min,Number(value))):fallback;
const contextOptions={userAgent:UA,viewport:VIEWPORT_SIZES.desktop,reducedMotion:'reduce',deviceScaleFactor:1,serviceWorkers:'block'};
async function browserSession(browser,viewport=VIEWPORT_SIZES.desktop){
    const context=await browser.newContext({...contextOptions,viewport}),allowed=new Set();let creating=false;
    context.on('page',page=>{if(creating){creating=false;allowed.add(page);}else void page.close({runBeforeUnload:false}).catch(()=>{});});
    // Popups have no page policy yet. Block their first HTTP navigation as well
    // as closing the unexpected tab; do not let it bypass the request gate.
    await context.route(/^https?:\/\//i,async route=>{let page;try{page=route.request().frame().page();}catch{}try{if(allowed.has(page))await route.fallback();else await route.abort('blockedbyclient');}catch{/* Context/page may already be closing. */}});
    return {context,async newPage(){creating=true;try{const page=await context.newPage();allowed.add(page);return page;}finally{creating=false;}}};
}
async function settleLayout(page) {
    let previous='',stable=0;
    for(let i=0;i<10;i++){
        const current=await page.evaluate(()=>JSON.stringify([document.readyState,document.body?.childElementCount,document.documentElement?.scrollHeight,document.body?.innerText?.length??0]));
        stable=current===previous?stable+1:0;previous=current;
        if(stable>=2)return true;
        await page.waitForTimeout(150);
    }
    return false;
}
async function waitForVisualAssets(page,policy,shot) {
    const deadline=Date.now()+8000;let stable=0;
    const kinds=shot?['stylesheet','image','font']:['stylesheet'];
    while(Date.now()<deadline){
        const pending=policy.snapshot().pendingTypes;
        const missingStyles=await page.evaluate(()=>Array.from(document.querySelectorAll('link[rel="stylesheet"]')).some(l=>!l.disabled&&l.media!=='print'&&!l.sheet));
        if(!missingStyles&&kinds.every(k=>!(pending[k]>0)))stable++;else stable=0;
        if(stable>=3)return true;
        await page.waitForTimeout(100);
    }
    return false;
}
// Runs in the page. The selector scheme is identical to the DOM scanner's css path, so rectangles and
// scanner components can be joined by selector.
function collectRects() {
    const TAGS = new Set(['div', 'section', 'article', 'header', 'footer', 'nav', 'main', 'aside', 'ul', 'ol', 'li', 'form', 'figure', 'details',
        'table', 'a', 'button', 'img', 'picture', 'video', 'iframe', 'input', 'select', 'textarea', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'blockquote']);
    const cssPath = (el) => {
        const parts = [];
        let cur = el;
        while (cur && cur.tagName.toLowerCase() !== 'html') {
            const t = cur.tagName.toLowerCase();
            const id = cur.getAttribute('id');
            if (id && /^[A-Za-z_][\w-]{0,40}$/.test(id) && !/\d{4,}/.test(id)) {
                parts.push(`${t}#${id}`);
                break;
            }
            const parent = cur.parentElement;
            if (!parent)
                parts.push(t);
            else {
                const same = Array.from(parent.children).filter((s) => s.tagName === cur.tagName);
                parts.push(same.length === 1 ? t : `${t}:nth-of-type(${same.indexOf(cur) + 1})`);
            }
            cur = parent;
        }
        return parts.reverse().join(' > ');
    };
    const out = [];
    for (const el of Array.from(document.body.querySelectorAll('*'))) {
        const t = el.tagName.toLowerCase();
        if (!TAGS.has(t) || el.closest('svg'))
            continue;
        const r = el.getBoundingClientRect();
        if (r.width < 24 || r.height < 12 || r.width * r.height < 800)
            continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0)
            continue;
        const media = { interactive: el.matches('button,input,select,textarea,a[href],[role="button"],[role="dialog"]') };
        if (t === 'img') {
            media.mediaKind = 'image';
            const img = el;
            // Non-default image sizing is retained as uncertain rather than risking false exclusions.
            media.mediaUncertain = cs.objectFit !== 'fill' && cs.objectFit !== 'cover';
            if (cs.objectFit === 'contain' && img.naturalWidth && img.naturalHeight && cs.objectPosition === '50% 50%' && parseFloat(cs.borderLeftWidth) === 0 && parseFloat(cs.paddingLeft) === 0) {
                const scale = Math.min(r.width / img.naturalWidth, r.height / img.naturalHeight);
                const w = img.naturalWidth * scale, h = img.naturalHeight * scale;
                media.mediaBox = { x: r.left + window.scrollX + (r.width - w) / 2, y: r.top + window.scrollY + (r.height - h) / 2, w, h };
                media.mediaUncertain = false;
            }
        }
        else if (cs.backgroundImage !== 'none') {
            media.mediaKind = 'background';
            media.mediaUncertain = true;
        }
        out.push({ ...media, s: cssPath(el), t, x: Math.round(r.left + window.scrollX), y: Math.round(r.top + window.scrollY), w: Math.round(r.width), h: Math.round(r.height), p: cs.position });
    }
    // keep the largest candidates when a page is huge
    return out.length > 4000 ? out.sort((a, b) => b.w * b.h - a.w * a.h).slice(0, 4000) : out;
}
/**
 * shot: true  full capture (consent, lazy loading, full-page screenshot, HTML, rectangles, scan).
 * shot: false light pass for comparison: consent handled, HTML, rectangles and scan saved, no screenshot and no scroll through the page.
 */
export async function captureOne(browser, entry, viewport, runId, opts = {}) {
    const shotWanted = opts.shot !== false;
    const size = VIEWPORT_SIZES[viewport];
    const settings=opts.settings??(await getRun(runId)).settings;
    const ownedContext=!opts.context;
    const session=ownedContext?await browserSession(browser,size):null;
    const ctx = opts.context??session.context;
    let page,assetObserver,requestPolicy,lifetime;
    const readinessWarnings = [];
    const waitForFonts = async () => {
        const loaded = await page.evaluate(async () => {
            let timer;
            try {
                return await Promise.race([document.fonts.ready.then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), 8000); })]);
            }
            finally {
                clearTimeout(timer);
            }
        }).catch(() => false);
        if (!loaded)
            readinessWarnings.push('Font readiness timed out or was unavailable; typography may be incomplete');
    };
    const state = { status: 'pending' };
    let phase='setup';
    try {
        page=await (opts.newPage?opts.newPage():session?session.newPage():ctx.newPage());await page.setViewportSize(size);page.setDefaultTimeout(5000);
        page.on('response',response=>{if(response.status()===429){state.rateLimitStatus=429;void page.close({runBeforeUnload:false}).catch(()=>{});}});
        const pageBudget=Math.min(opts.deadline?Math.max(1,opts.deadline-Date.now()):60000,bounded(settings.pageBudgetMs,45000,1000,60000));
        lifetime=setTimeout(()=>{state.budgetExceeded=true;void page.close({runBeforeUnload:false}).catch(()=>{});},pageBudget);
        assetObserver=shotWanted?observeAssets(page):null;
        requestPolicy=await attachRequestPolicy(page,{shot:shotWanted,settings});
        phase='navigation';
        const remaining=opts.deadline?Math.max(1,opts.deadline-Date.now()):30000;
        const resp = await page.goto(entry.url, { waitUntil: 'domcontentloaded', timeout: Math.min(remaining,bounded(settings.navigationTimeoutMs,25000,1000,30000)) });
        state.httpStatus=resp?.status()??0;
        if(state.httpStatus>=400)throw new Error(`HTTP ${state.httpStatus}`);
        phase='readiness';
        if(!await settleLayout(page))readinessWarnings.push('DOM/layout readiness limit reached; dynamic content may still be changing');
        if (shotWanted)
            await waitForFonts();
        let consent = await dismissConsent(page);
        let lazy = { images: 0, pending: 0 };
        if (shotWanted)
            lazy = await loadLazyContent(page);
        else
            await page.waitForTimeout(900);
        // banners that show up after scrolling or a delay
        const later = await dismissConsent(page);
        if (consent === 'none')
            consent = later;
        if (later !== 'none')
            await page.evaluate(() => window.scrollTo(0, 0));
        // Scrolling can trigger fonts in below-the-fold content.
        if (shotWanted)
            await waitForFonts();
        if(!await waitForVisualAssets(page,requestPolicy,shotWanted))readinessWarnings.push('Visual asset readiness limit reached; stylesheet/background/image/font content may be incomplete');
        const status = resp?.status() ?? 0;
        const ctype = resp?.headers()['content-type'] ?? '';
        if (ctype && !/html|xml/i.test(ctype))
            throw new Error(`Not an HTML page (${ctype.split(';')[0]})`);
        if (!(await page.evaluate(() => !!document.documentElement && !!document.body).catch(() => false)))
            throw new Error('The page has no HTML content to scan');
        const shotRel = `shots/${viewport}/${entry.slug}.png`;
        phase='evidence';
        let dims;
        if (shotWanted) {
            await mkdir(path.dirname(inRun(runId, shotRel)), { recursive: true });
            await page.screenshot({ path: inRun(runId, shotRel), fullPage: true, animations: 'disabled', scale: 'css' });
            const meta = await sharp(inRun(runId, shotRel)).metadata();
            dims = { width: meta.width, height: meta.height };
        }
        else {
            dims = await page.evaluate(() => ({ width: document.documentElement?.clientWidth || window.innerWidth, height: document.documentElement?.scrollHeight || document.body?.scrollHeight || 0 }));
        }
        const html = await page.content();
        const rects = await page.evaluate(collectRects);
        await mkdir(path.dirname(inRun(runId, `html/${viewport}/${entry.slug}.html`)), { recursive: true });
        await writeFile(inRun(runId, `html/${viewport}/${entry.slug}.html`), html, 'utf8');
        await writeJson(inRun(runId, `rects/${viewport}/${entry.slug}.json`), rects);
        const scan = scanHtml(html, entry.url);
        const bySelector = new Map(rects.map((r) => [r.s, r]));
        for (const c of scan.components) {
            const r = bySelector.get(c.selector);
            c.box = r ? { x: r.x, y: r.y, w: r.w, h: r.h } : null;
        }
        await writeJson(inRun(runId, `scan/${viewport}/${entry.slug}.json`), scan);
        const flags = [...(consent === 'none' ? [] : [`cookie banner: ${consent}`]),...readinessWarnings,...(requestPolicy?.snapshot().warnings??[])];
        if (lazy.pending)
            flags.push(`${lazy.pending} of ${lazy.images} images did not finish loading`);
        const [shell, why] = looksLikeShell(html);
        if (shell)
            flags.push(`empty shell: ${why}`);
        if (looksBlocked(status, html))
            flags.push('bot protection page');
        if (shotWanted && assetObserver) {
            try {
                const evidencePath = `analysis/${viewport}/${entry.slug}.json`;
                const evidence = await collectWebsiteEvidence(page, { requestedUrl: entry.url, viewport, consent, screenshot: shotRel,
                    rects, scan, network: assetObserver.snapshot(), warnings: [...flags, ...readinessWarnings] });
                evidence.browserNetwork=requestPolicy?.snapshot()??null;
                await writeJson(inRun(runId, evidencePath), evidence);
                state.evidence = { path: evidencePath, summary: evidence.summary };
                flags.push(...evidence.warnings.filter(w => !flags.includes(w)));
            }
            catch (e) {
                flags.push(`Website analysis unavailable: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
            }
        }
        Object.assign(state, { status: status >= 200 && status < 400 ? 'ok' : 'failed', httpStatus: status, width: dims.width, height: dims.height, flags, shot: shotWanted });
        if (state.status === 'failed')
            state.error = `HTTP ${status}`;
    }
    catch (e) {
        Object.assign(state, { status: 'failed', ...(state.rateLimitStatus?{httpStatus:state.rateLimitStatus}:{}), failureKind:phase, error: state.rateLimitStatus?'HTTP 429 rate limit observed; browser workload stopped':state.budgetExceeded?'Page lifetime budget exceeded; URL deferred for inspection':(e instanceof Error ? e.message : String(e)).split('\n')[0] });
    }
    finally {
        assetObserver?.dispose();
        clearTimeout(lifetime);
        if(page)await page.close({runBeforeUnload:false}).catch(()=>{});
        // Optional analysis catches its own errors. A terminal network stop or
        // page-budget expiry must still override a previously assigned success.
        if(state.rateLimitStatus||state.budgetExceeded)Object.assign(state,{status:'failed',failureKind:phase,...(state.rateLimitStatus?{httpStatus:429}:{}),error:state.rateLimitStatus?'HTTP 429 rate limit observed; browser workload stopped':'Page lifetime budget exceeded; URL deferred for inspection'});
        if(requestPolicy){state.network=requestPolicy.snapshot();await requestPolicy.dispose();}
        if(ownedContext)await ctx.close();
    }
    await updateRun(runId, (run) => {
        const p = run.pages.find((x) => x.url === entry.url);
        if (p)
            p.viewports[viewport] = state;
    });
    return state;
}

/** A context belongs to this stage/run only. Tabs are serial; storage/consent can
 * be reused for same-site pages, never across unrelated runs or workspaces. */
export async function captureSequence(browser,run,tasks,job,{shot=true}={}) {
    const stopped=await readJson(inRun(run.id,'browser-stop.json'),null);
    if(stopped){job.stopReason=stopped.reason;job.cancelRequested=true;logJob(job,`Browser workload remains stopped: ${stopped.reason}. Inspect the cause before explicit --retry-browser.`);return;}
    const session=await browserSession(browser),context=session.context;
    const interval=bounded(run.settings.urlIntervalMs,1000,250,30000);
    const failureLimit=bounded(run.settings.maxConsecutivePageFailures,2,1,2);
    let failures=0;
    logJob(job,`Browser safety: one shared stage context, one page at a time, ${interval}ms between URLs; no automatic retry sweep`);
    try{
        for(const [index,{p,v}]of tasks.entries()){
            if(outOfTime(job))break;
            if(index){const remaining=job.deadline?Math.max(0,job.deadline-Date.now()):interval;await new Promise(r=>setTimeout(r,Math.min(interval,remaining)));}
            if(outOfTime(job))break;
            logJob(job,`${shot?'Capturing':'Scanning'} ${p.url} (${v})`);
            const state=await captureOne(browser,p,v,run.id,{shot,context,newPage:()=>session.newPage(),settings:run.settings,deadline:job.deadline});
            job.done++;
            outOfTime(job);
            failures=state.status==='failed'?failures+1:0;
            if([403,429,503].includes(state.httpStatus)||failures>=failureLimit){
                job.stopReason=state.httpStatus>=400?`HTTP ${state.httpStatus}; browser workload stopped, remaining URLs deferred`:`${failures} consecutive page failures; remaining URLs deferred`;
                job.cancelRequested=true;logJob(job,job.stopReason);break;
            }
        }
    }finally{await context.close();if(job.stopReason)await writeJson(inRun(run.id,'browser-stop.json'),{version:1,at:new Date().toISOString(),reason:job.stopReason,completed:job.done,total:tasks.length});}
}
export async function captureRun(runId, job, only) {
    const run = await getRun(runId);
    const targets = run.pages.filter((p) => !only || only.includes(p.url));
    // resumable: a page that already has a screenshot on a viewport is not captured again
    const tasks = targets.flatMap((p) => run.viewports.map((v) => ({ p, v }))).filter(({ p, v }) => !(p.viewports[v]?.status === 'ok' && hasShot(p.viewports[v])));
    job.total = tasks.length;
    const browser = await launchBrowser();
    try {
        await captureSequence(browser,run,tasks,job);
    }
    finally {
        await browser.close();
    }
    if (run.mode === 'compare-first' && !job.cancelRequested) {
        // the full capture sees lazily rendered sections the light pass did not, so refresh the groups; the selection is kept
        const fresh = await getRun(runId);
        await computeSimilarity(fresh, compareViewport(fresh.viewports), fresh.settings.threshold);
    }
}
/** Compare-first, step one: a light pass over every page on the comparison viewport (no screenshots). */
export async function scanRun(runId, job) {
    const run = await getRun(runId);
    const vp = compareViewport(run.viewports);
    const todo = run.pages.filter((p) => p.viewports[vp]?.status !== 'ok');
    job.total = todo.length;
    const browser = await launchBrowser();
    try {
        await captureSequence(browser,run,todo.map(p=>({p,v:vp})),job,{shot:false});
    }
    finally {
        await browser.close();
    }
}
