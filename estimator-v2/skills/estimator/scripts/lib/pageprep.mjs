// Consent managers: click "accept" first (the site is left in its normal accepted state), then hide whatever is still on screen.
const ACCEPT_SELECTORS = [
    '#onetrust-accept-btn-handler', '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll', '#CybotCookiebotDialogBodyButtonAccept',
    '.cc-allow', '.cc-accept', '.cc-btn.cc-dismiss', '#cookie-accept', '#accept-cookies', '#acceptCookies', '.cookie-accept', '.js-accept-cookies',
    '[data-testid="cookie-accept"]', '[data-cookiebanner="accept_button"]', 'button[aria-label*="accept" i][aria-label*="cookie" i]',
    '.fc-cta-consent', '.truste-consent-button', '#truste-consent-button', '.osano-cm-accept-all', '.iubenda-cs-accept-btn', '#didomi-notice-agree-button',
    '.qc-cmp2-summary-buttons button[mode="primary"]', '#sp-cc-accept', '.cmplz-accept', '.cky-btn-accept', '#wt-cli-accept-all-btn', '.klaro .cm-btn-accept-all',
];
const ACCEPT_TEXT = /^(accept( all)?( cookies)?|allow( all)?( cookies)?|i agree|agree( and close)?|got it|ok(ay)?|accept & close|accept and continue|consent|alles akzeptieren|akzeptieren|tout accepter|accepter|accetta( tutto)?|aceptar( todo)?|aceitar|toestaan|alles toestaan|godkänn|accepter alle)$/i;
const BANNER_SELECTORS = [
    '#onetrust-consent-sdk', '#onetrust-banner-sdk', '#CybotCookiebotDialog', '#cookiebanner', '#cookie-banner', '#cookie-notice', '#cookie-law-info-bar', '.cookie-banner',
    '.cookie-notice', '.cookie-consent', '.cc-window', '.cc-banner', '.cc-revoke', '#cmpbox', '#didomi-host', '.didomi-popup-container', '.fc-consent-root', '#usercentrics-root',
    '#truste-consent-track', '.osano-cm-window', '.iubenda-cs-container', '#cmplz-cookiebanner-container', '.cmplz-cookiebanner', '.cky-consent-container', '#qc-cmp2-container',
    '.klaro', '[id*="cookie-banner" i]', '[class*="cookie-banner" i]', '[id*="consent-banner" i]', '[class*="consent-banner" i]', '[aria-label*="cookie" i][role="dialog"]',
];
export async function dismissConsent(page) {
    let result = 'none';
    const frames = page.frames();
    for (const frame of frames) {
        for (const sel of ACCEPT_SELECTORS) {
            try {
                const loc = frame.locator(sel).first();
                if (await loc.isVisible({ timeout: 100 })) {
                    await loc.click({ timeout: 1500 });
                    result = 'accepted';
                    break;
                }
            }
            catch {
                /* not present or not clickable */
            }
        }
        if (result === 'accepted')
            break;
    }
    if (result === 'none') {
        for (const frame of frames) {
            try {
                const buttons = frame.locator('button, [role="button"], a.button, a.btn, input[type="button"], input[type="submit"]');
                const n = Math.min(await buttons.count(), 60);
                for (let i = 0; i < n; i++) {
                    const b = buttons.nth(i);
                    const label = ((await b.innerText({ timeout: 150 }).catch(() => '')) || (await b.getAttribute('value').catch(() => '')) || '').trim();
                    if (!label || label.length > 30 || !ACCEPT_TEXT.test(label))
                        continue;
                    // only buttons inside something consent-like, so an "OK" elsewhere is never clicked
                    const inBanner = await b
                        .evaluate((el) => {
                        let cur = el;
                        for (let d = 0; cur && d < 8; d++, cur = cur.parentElement) {
                            const t = `${cur.getAttribute('id') ?? ''} ${cur.getAttribute('class') ?? ''} ${cur.getAttribute('aria-label') ?? ''}`;
                            if (/cookie|consent|gdpr|privacy|cmp|banner/i.test(t))
                                return true;
                            if (cur.tagName !== 'BODY' && /cookie|consent/i.test(cur.innerText?.slice(0, 600) ?? '') && getComputedStyle(cur).position === 'fixed')
                                return true;
                        }
                        return false;
                    })
                        .catch(() => false);
                    if (inBanner && (await b.isVisible().catch(() => false))) {
                        await b.click({ timeout: 1500 });
                        result = 'accepted';
                        break;
                    }
                }
            }
            catch {
                /* frame detached */
            }
            if (result === 'accepted')
                break;
        }
    }
    if (result === 'accepted')
        await page.waitForTimeout(600);
    // Whatever is left: remove known banner containers and any fixed layer that talks about cookies or consent.
    const hidden = await page
        .evaluate((selectors) => {
        let n = 0;
        const hide = (el) => {
            // removed from the DOM so the saved HTML and the structure scan do not contain the banner either
            el.remove();
            n++;
        };
        for (const sel of selectors)
            document.querySelectorAll(sel).forEach((el) => hide(el));
        for (const el of Array.from(document.body.querySelectorAll('div, section, aside, form, dialog'))) {
            const cs = getComputedStyle(el);
            if (cs.position !== 'fixed' && cs.position !== 'sticky')
                continue;
            if (el.offsetHeight === 0)
                continue;
            const text = el.innerText ?? '';
            if (text.length > 1200 || !/cookie|consent|gdpr/i.test(text))
                continue;
            if (!el.querySelector('button, a, input'))
                continue;
            hide(el);
        }
        // Consent dialogs often lock page scroll. Only undo an actual lock, and only when a banner was removed: forcing overflow
        // on sites whose body is the scroll container turns the page into a 900 px box and breaks the full-page screenshot.
        if (n > 0) {
            for (const e of [document.documentElement, document.body]) {
                const cs = getComputedStyle(e);
                if (cs.overflowY === 'hidden')
                    e.style.setProperty('overflow', 'visible', 'important');
                if (e === document.body && cs.position === 'fixed')
                    e.style.removeProperty('position');
            }
        }
        return n;
    }, BANNER_SELECTORS)
        .catch(() => 0);
    if (hidden > 0 && result === 'none')
        result = 'removed';
    return result;
}

/** Verify recognized consent UI is absent from the rendered capture, including frames.
 * This is a bounded heuristic, not proof that every possible overlay was recognized.
 */
export async function inspectConsent(page) {
    const remaining = [], errors = [];
    for (const [frameIndex, frame] of page.frames().entries()) {
        try {
            const count = await frame.evaluate(selectors => {
                const visible = el => {
                    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
                    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) !== 0 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight;
                };
                const found = new Set();
                for (const selector of selectors) for (const el of document.querySelectorAll(selector)) if (visible(el)) found.add(el);
                for (const el of document.querySelectorAll('div,section,aside,form,dialog')) {
                    const s = getComputedStyle(el), text = el.innerText ?? '';
                    if (['fixed','sticky'].includes(s.position) && text.length <= 1200 && /cookie|consent|gdpr/i.test(text) && el.querySelector('button,a,input') && visible(el)) found.add(el);
                }
                return found.size;
            }, BANNER_SELECTORS);
            if (count) remaining.push({frameIndex,count});
        } catch { errors.push({frameIndex,reason:'Consent visibility inspection failed or frame detached'}); }
    }
    return {status:remaining.length?'blocked':errors.length?'unknown':'clear',remaining,errors,basis:'recognized consent containers and rendered fixed/sticky consent UI; unrecognized overlays still require image review'};
}
/** Scroll through the page so lazy images load, turn lazy attributes into real ones, then wait (bounded) for images to decode. */
export async function dismissObstructingPopups(page) {
    let dismissed=0;const remaining=[];
    for(const [frameIndex,frame] of page.frames().entries()){
      const dialogs=frame.locator('[role="dialog"],[aria-modal="true"],dialog[open],[class*="newsletter-modal"],[id*="newsletter-popup"]');
      for(let i=Math.min(await dialogs.count(),20)-1;i>=0;i--){
        const dialog=dialogs.nth(i);if(!await dialog.isVisible().catch(()=>false))continue;
        const marker=((await dialog.innerText().catch(()=>''))+' '+(await dialog.getAttribute('aria-label').catch(()=>''))).slice(0,4000);
        // Never accept purchases, authentication, legal gates or permissions.
        if(!/newsletter|subscribe|sign up|stay (?:in touch|updated)|select (?:your )?(?:country|region|location)|welcome offer|special offer/i.test(marker))continue;
        const close=dialog.locator('button,[role="button"],a');let closed=false;
        for(let j=0;j<Math.min(await close.count(),20);j++){
          const control=close.nth(j),label=((await control.getAttribute('aria-label').catch(()=>''))||(await control.innerText().catch(()=>''))).trim();
          if(!/^(?:close(?: dialog| popup| modal)?|dismiss|no thanks|not now|maybe later|×|✕|x)$/i.test(label))continue;
          if(await control.isVisible().catch(()=>false)){await control.click({timeout:1000}).catch(()=>{});closed=!await dialog.isVisible().catch(()=>true);if(closed){dismissed++;break;}}
        }
        if(!closed)remaining.push({frameIndex,index:i,reason:'Recognized obstructing popup has no working safe dismissal control'});
      }
    }
    return {status:remaining.length?'blocked':'clear',dismissed,remaining,basis:'bounded recognized marketing/location dialogs; unrecognized overlays require image review'};
}
export async function loadLazyContent(page, maxSteps = 60) {
    await page
        .evaluate(() => {
        document.querySelectorAll('img[loading="lazy"], iframe[loading="lazy"]').forEach((el) => el.setAttribute('loading', 'eager'));
    })
        .catch(() => { });
    let last = -1;
    for (let i = 0; i < maxSteps; i++) {
        const height = await page.evaluate(() => document.documentElement?.scrollHeight ?? 0);
        await page.evaluate(() => window.scrollBy(0, Math.round(window.innerHeight * 0.7)));
        await page.waitForTimeout(220);
        const pos = await page.evaluate(() => window.scrollY + window.innerHeight).catch(() => 0);
        if (pos >= height - 2 && height === last)
            break;
        last = height;
    }
    // lazy-load libraries keep the real URL in a data attribute until the image nears the viewport
    await page
        .evaluate(() => {
        const pick = (el, names) => names.map((n) => el.getAttribute(n)).find((v) => v && v.trim());
        document.querySelectorAll('img').forEach((img) => {
            const src = pick(img, ['data-src', 'data-lazy-src', 'data-original', 'data-lazy']);
            const cur = img.getAttribute('src');
            if (src && (!cur || cur.startsWith('data:')))
                img.setAttribute('src', src);
            const set = pick(img, ['data-srcset', 'data-lazy-srcset']);
            if (set && !img.getAttribute('srcset'))
                img.setAttribute('srcset', set);
        });
        document.querySelectorAll('source').forEach((so) => {
            const set = pick(so, ['data-srcset']);
            if (set && !so.getAttribute('srcset'))
                so.setAttribute('srcset', set);
        });
        document.querySelectorAll('video[preload="none"]').forEach((v) => v.setAttribute('preload', 'metadata'));
    })
        .catch(() => { });
    const stats = await page
        .evaluate(async () => {
        const imgs = Array.from(document.images);
        const deadline = Date.now() + 15000;
        const pending = () => imgs.filter((i) => !i.complete);
        while (pending().length && Date.now() < deadline)
            await new Promise((r) => setTimeout(r, 250));
        await Promise.all(imgs.filter((i) => i.complete && i.naturalWidth > 0).map((i) => i.decode().catch(() => { })));
        return { images: imgs.length, pending: pending().length };
    })
        .catch(() => ({ images: 0, pending: 0 }));
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(400);
    return stats;
}
