// Programme setup (Salesforce side): clicking Moonfill's 🚀 New Implementation button reads everything
// the setup needs from the record, asks only whether to save each page, then shows a progress bar
// (with a cancel ✕) while the background script fills the pages one by one (setup/background.js).
// Moonfill's own code is unchanged: its button's click is caught first, in the capture phase.
// "Just open the tabs" does what the button always did.
(function () {
  const engine = globalThis.TCAEngine;
  const cfg = globalThis.TCA_CONFIG;
  const T = globalThis.TCATemplates;
  const isMock = location.protocol === 'file:' && /\/mock\/[^/]+\.html$/.test(location.pathname);
  const isSalesforce = location.protocol === 'https:' && location.hostname === 'awin.lightning.force.com';
  if ((!isMock && !isSalesforce) || globalThis.TCASetupForm) return;

  const OFFERS = ['Access', 'Accelerate', 'Advanced'];
  const PAGES = ['Tracking settings', 'Invite user', 'Commission groups', 'Plugin store', 'Tracking tag settings',
    'Account details', 'Fee manager', 'Mobile tracking', 'Advertiser settings', 'Pre-join publishers'];
  const ICON = { working: '…', saved: '✓', filled: '✎', skipped: '⏭', unconfirmed: '⚠', failed: '⚠', cancelled: '·' };
  const SHOPIFY_SHOP = /Shopify\.shop\s*=\s*["']([^"']+\.myshopify\.com)["']/i;
  const { all, visible } = engine.dom;

  // ---------- reading the record ----------
  const field = label => ((engine.recordField(document, cfg, label).find(f => f.text) || {}).text || '').trim();
  function readMid() {
    const link = all(document, 'a[href*="ui.awin.com/dashboard/awin/advertiser/"]').find(visible);
    return link ? ((link.getAttribute('href').match(/advertiser\/(\d+)/) || [])[1] || '') : '';
  }
  const number = text => { const m = String(text).replace(',', '.').match(/-?\d+(\.\d+)?/); return m ? m[0] : ''; };

  // Everything the setup needs, from the record: { values, missing: [what's missing], core: bool }.
  // core: the Landing Page URL or Platform Offer is missing, so it can only run with the details
  // entered by hand. Other gaps only affect their own page.
  function readRecord() {
    const R = cfg.setupRecord;
    const missing = [];
    const site = engine.landingPageUrl(document, cfg).url || '';
    if (!site) missing.push('Landing Page URL');
    const offerText = field(cfg.platformOfferLabel);
    const platformOffer = OFFERS.find(o => offerText.toLowerCase().startsWith(o.toLowerCase())) || '';
    if (!platformOffer) missing.push(offerText ? `Platform Offer (it says "${offerText}", not Access, Accelerate or Advanced)` : 'Platform Offer');
    const core = missing.length > 0;

    // Commission group: only "Percentage" programmes are set up automatically (Sale + Percentage).
    const type = field(R.commissionType);
    const amount = number(field(R.commissionAmount));
    const commission = /^percentage$/i.test(type)
      ? (amount ? { transactionType: 'Sale', commissionType: 'Percentage', publisherCommission: amount }
        : { commissionProblem: `"${R.commissionAmount}" is empty on the record, so the commission group wasn't set.` })
      : { commissionSkip: type ? `Commission type is "${type}": set the commission group by hand` : `"${R.commissionType}" is empty on the record: set the commission group by hand` };

    if (!type) missing.push(R.commissionType);
    else if (commission.commissionProblem) missing.push(R.commissionAmount);
    const validationDays = (field(R.validationPeriod).match(/\d+/) || [''])[0];
    if (!validationDays) missing.push(R.validationPeriod);

    const values = {
      websiteUrl: site, landingPage: site, platformOffer, ...commission,
      approval: 'Manual Approval', validationDays,
      assignedTc: engine.assignedTc(document, cfg)
    };
    const note = commission.commissionSkip && type ? `Commission type is "${type}", so the commission group will be left for you (or enter it by hand).` : '';
    return { values, missing, core, note };
  }

  const ask = message => Promise.resolve().then(() => chrome.runtime.sendMessage(message)).then(a => a || { error: 'no answer' }, e => ({ error: e.message }));

  // The site check, once per 🚀, on the record's Landing Page URL: { url?, ecommerce?, note }.
  // - url: a Shopify store's own myshopify address, used as the Website URL.
  // - ecommerce (Access only): true if the site runs on one of the supported e-commerce platforms (the
  //   checklist's platform templates; signs of two count too), false if none was found. Page 1's query
  //   string depends on it. Left out when the site couldn't be read: page 1 then keeps source=aw.
  async function checkSite(site, offer) {
    const access = offer === 'Access';
    const page = await ask({ action: 'tcaReadSite', url: site, via: 'fetch' });
    if (page.error === 'permission') {
      return { note: access ? 'Platform detection isn\'t allowed (Settings), so the e-commerce platform wasn\'t checked: the query string is source=aw as usual.'
        : 'Tip: allow platform detection in Settings so Shopify stores get their myshopify address.' };
    }
    let found = page.ok ? T.detect(page.text, cfg) : null;
    let shop = page.ok && (page.text.match(SHOPIFY_SHOP) || [])[1];
    // The invisible read misses what a page's own scripts add: look again in a background tab if it
    // failed, if it looks like Shopify without the address, or (Access) if no platform showed.
    if (!page.ok || (!shop && found.name === 'Shopify') || (access && !found.name)) {
      const tab = await ask({ action: 'tcaReadSite', url: site, via: 'tab' });
      if (tab.ok) {
        if (!found || !found.name) found = T.detect(tab.text, cfg);
        shop = shop || (tab.text.match(SHOPIFY_SHOP) || [])[1];
      }
    }
    const out = {};
    const notes = [];
    if (shop) { out.url = `https://${shop.toLowerCase()}`; notes.push('Shopify store: its myshopify address is used as the Website URL.'); }
    else if (found && found.name === 'Shopify') notes.push('Looks like Shopify, but the myshopify address wasn\'t found: the Landing Page URL is used.');
    if (access) {
      const two = found && /signs of both/.test(found.reason || '');
      if (!found) notes.push('The site couldn\'t be read to check its e-commerce platform, so the query string is source=aw as usual.');
      else if (found.name || two) { out.ecommerce = true; notes.push(`E-commerce platform: ${found.name || 'found'}, so the query string is source=aw.`); }
      else { out.ecommerce = false; notes.push('No supported e-commerce platform found on the site, so the query string is utm_source=awin.'); }
    }
    return { ...out, note: notes.join(' ') };
  }

  // ---------- the dialog ----------
  // The Awin logo with its circular sweep: a mask circle whose dash grows clockwise from 12 o'clock
  // (the logo appears), holds, then moves on (the logo clears), and so on. The browser animates it
  // (SVG <animate>), so no script runs for it. data-state="still" drops the mask: the logo stays whole.
  const C = 71.13;   // the mask circle's length: 2π × 11.32 (its stroke covers the whole 32 × 32 square)
  const logoSvg = (id, cls) => `<svg class="logo${cls}" viewBox="0 0 32 32" aria-hidden="true" data-state="still"><defs><mask id="${id}">` +
    `<circle cx="16" cy="16" r="11.32" fill="none" stroke="#fff" stroke-width="22.64" stroke-dasharray="${C} ${C}" transform="rotate(-90 16 16)">` +
    `<animate attributeName="stroke-dashoffset" values="${C};0;0;-${C};-${C}" keyTimes="0;0.375;0.5;0.875;1" dur="2.4s" repeatCount="indefinite"/></circle>` +
    `</mask></defs><image width="32" height="32" mask="url(#${id})"/></svg>`;

  const host = document.createElement('div');
  host.id = 'tca-setup-form';
  const shadow = host.attachShadow({ mode: 'open' });
  const select = (name, label, options) => `<label>${label}<select name="${name}" required><option value="">Choose…</option>${options.map(o => `<option>${o}</option>`).join('')}</select></label>`;
  shadow.innerHTML = `
<style>
  :host { all: initial; }
  .backdrop { position: fixed; inset: 0; z-index: 2147483001; background: rgba(0,0,0,.35); display: flex; align-items: flex-start; justify-content: center; overflow: auto; padding: 60px 16px; }
  .dialog { width: 460px; max-width: 100%; background: #fff; color: #181818; border-radius: 8px; box-shadow: 0 8px 32px rgba(0,0,0,.3); font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; padding: 16px 18px; display: grid; gap: 10px; }
  header { font-size: 16px; font-weight: 600; }
  .muted { color: #5c5c5c; }
  .note { color: #5c5c5c; font-size: 12px; }
  .note:empty, .error:empty { display: none; }
  .error { color: #ba0517; font-weight: 600; white-space: pre-line; }
  .row { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; align-items: center; }
  button { font: inherit; font-weight: 600; padding: 6px 14px; border-radius: 4px; border: 1px solid #0176d3; background: #fff; color: #0176d3; cursor: pointer; }
  button.primary { background: #0176d3; color: #fff; }
  button:disabled { opacity: .5; cursor: default; }
  button.link { border: 0; padding: 6px 4px; text-decoration: underline; margin-right: auto; }
  .bar-row { display: flex; align-items: flex-end; gap: 10px; }
  /* The Awin logo rides along the front of the progress bar, with a circular sweep while the setup runs. */
  .track { position: relative; flex: 1; padding-top: 38px; }
  .track .bar { width: 100%; }
  .logo { position: absolute; bottom: 14px; left: 0; width: 32px; height: 32px; transform: translateX(-50%); transition: left .4s ease-out; pointer-events: none; overflow: visible; }
  .logo[data-state="still"] image { mask: none; }
  .mini .track { padding-top: 24px; }
  .mini .logo { width: 18px; height: 18px; bottom: 9px; }
  /* The hidden guy: now and then he peeks up from behind the small box's bar, then ducks back down. */
  .peek { position: absolute; bottom: 6px; width: 18px; height: 13px; overflow: hidden; transform: translateX(-50%); pointer-events: none; }
  .peek img { display: block; width: 18px; height: 13px; image-rendering: pixelated; transform: translateY(100%); }
  .peek.up img { animation: peek 2.6s ease-in-out forwards; }
  @keyframes peek { 0% { transform: translateY(100%); } 18%, 82% { transform: translateY(0); } 100% { transform: translateY(100%); } }
  .bar { flex: 1; height: 10px; background: #e5e5e5; border-radius: 5px; overflow: hidden; }
  .fill { height: 100%; width: 0; background: #0176d3; border-radius: 5px; transition: width .3s; }
  .done .fill { background: #2e844a; }
  .attention .fill { background: #dd7a01; }
  .count { font-variant-numeric: tabular-nums; color: #5c5c5c; min-width: 40px; text-align: right; }
  button.stop { width: 28px; height: 28px; padding: 0; border-radius: 50%; border: 0; background: #ba0517; color: #fff; font-size: 16px; line-height: 28px; }
  .current { font-weight: 600; }
  details summary { cursor: pointer; color: #5c5c5c; }
  ol { margin: 6px 0 0; padding-left: 22px; display: grid; gap: 3px; }
  li .msg { color: #5c5c5c; font-size: 12px; }
  li[data-status="failed"], li[data-status="unconfirmed"] { color: #ba0517; }
  li[data-status="saved"] { color: #2e844a; }
  .mini { position: fixed; right: 16px; bottom: 64px; z-index: 2147483000; width: 340px; max-width: calc(100vw - 32px); box-sizing: border-box;
    background: #fff; color: #181818; border: 1px solid #c9c9c9; border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,.18);
    font: 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; padding: 8px 10px; display: grid; gap: 6px; cursor: pointer; }
  .mini .top { display: flex; align-items: center; gap: 8px; }
  .mini .label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
  .mini .bar { height: 6px; }
  .mini button.stop { width: 22px; height: 22px; line-height: 22px; font-size: 13px; }
  .mini button.dismiss { border: 0; background: none; color: #5c5c5c; padding: 0 4px; font-size: 16px; line-height: 1; }
  .warn { background: #fef1e8; border: 1px solid #f4c7a5; border-radius: 6px; padding: 8px 10px; display: grid; gap: 6px; justify-items: start; }
  .warn-text { white-space: pre-line; }
  .session .note { font-size: 12px; }
  .session.bad .session-text { color: #ba0517; font-weight: 600; }
  form.manual { display: grid; gap: 10px; }
  form.manual[hidden] { display: none; }
  fieldset { border: 1px solid #e5e5e5; border-radius: 6px; padding: 8px 12px 12px; display: grid; gap: 8px; margin: 0; }
  legend { font-weight: 600; padding: 0 4px; }
  form.manual label { display: grid; gap: 3px; font-weight: 600; }
  form.manual input, form.manual select { font: inherit; font-weight: 400; padding: 5px 7px; border: 1px solid #c9c9c9; border-radius: 4px; }
  [hidden] { display: none !important; }
</style>
<div class="backdrop" hidden>
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="tca-setup-title">
    <header id="tca-setup-title">🚀 New Implementation setup</header>
    <div class="ask">
      <div class="muted mid"></div>
      <p>Everything is taken from the record. Save each page as it's filled?</p>
      <div class="session"><span class="session-text note"></span> <span class="session-actions" hidden><button type="button" class="link signin">Open Awin</button><button type="button" class="link recheck">Check again</button></span></div>
      <div class="warn" hidden><div class="warn-text"></div><button type="button" class="manual-open">Enter the details by hand</button></div>
      <div class="note shopify"></div>
      <div class="error" role="alert"></div>
      <div class="row">
        <button type="button" class="link tabs-only">Just open the tabs</button>
        <button type="button" class="cancel">Cancel</button>
        <button type="button" class="fill-only">Fill only</button>
        <button type="button" class="primary run">Run and save</button>
      </div>
    </div>
    <form class="manual" hidden novalidate>
      <p class="muted">Enter the details for this programme. Anything found on the record is already filled in.</p>
      <fieldset><legend>Site</legend>
        <label>Website URL<input name="websiteUrl" type="url" required></label>
        <label>Landing Page<input name="landingPage" type="url" required></label>
        ${select('platformOffer', 'Platform Offer', OFFERS)}
      </fieldset>
      <fieldset><legend>Commission group</legend>
        ${select('transactionType', 'Transaction Type', ['Sale', 'Lead'])}
        ${select('commissionType', 'Commission Type', ['Fixed', 'Percentage'])}
        <label>Publisher commission<input name="publisherCommission" type="text" required></label>
      </fieldset>
      <fieldset><legend>Advertiser settings</legend>
        ${select('approval', 'Approval of Publishers Joining', ['Manual Approval', 'Auto Approval'])}
        <label>Validation Period Days<input name="validationDays" type="number" min="1" step="1" required></label>
      </fieldset>
      <div class="error manual-error" role="alert"></div>
      <div class="row">
        <button type="button" class="link back">Back</button>
        <button type="button" class="manual-fill">Fill only</button>
        <button type="button" class="primary manual-run">Run and save</button>
      </div>
    </form>
    <div class="progress" hidden>
      <div class="bar-row">
        <div class="track">${logoSvg('tca-logo-sweep', '')}<div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="10" aria-valuenow="0"><div class="fill"></div></div></div>
        <span class="count">0 / 10</span>
        <button type="button" class="stop" title="Cancel the setup" aria-label="Cancel the setup">✕</button>
      </div>
      <div class="current" role="status" aria-live="polite">Starting…</div>
      <div class="note sv"></div>
      <div class="note chatter"></div>
      <details><summary>Details</summary>
        <ol>${PAGES.map((p, i) => `<li data-index="${i}"><span class="icon">·</span> ${p} <span class="msg"></span></li>`).join('')}</ol>
      </details>
      <div class="row"><button type="button" class="copy">Copy results</button><button type="button" class="close">Hide</button></div>
    </div>
  </div>
</div>
<div class="mini" hidden role="status" aria-live="polite" title="Show the setup's progress">
  <div class="top">
    <span class="label">🚀 Setup</span>
    <span class="count mini-count">0 / 10</span>
    <button type="button" class="stop mini-stop" title="Cancel the setup" aria-label="Cancel the setup">✕</button>
    <button type="button" class="dismiss" title="Dismiss" aria-label="Dismiss" hidden>×</button>
  </div>
  <div class="track"><span class="peek" aria-hidden="true" hidden><img alt=""></span>${logoSvg('tca-logo-sweep-mini', ' mini-logo')}<div class="bar"><div class="fill mini-fill"></div></div></div>
</div>`;
  const $ = sel => shadow.querySelector(sel);
  let mid = '';
  let record = { values: null, missing: [], core: false, note: '' };
  let blocked = [];          // MID problems: nothing can run
  let session = null;        // true signed in, false signed out, null unknown, 'checking'
  const manualForm = () => $('form.manual');
  const manualField = name => manualForm().elements[name];
  let shopping = null;   // the site check, once started
  let siteNote = '';
  let finished = 0;
  const notCreatedYet = m => /^0+$/.test(m);

  // Run buttons: never with a MID problem or while signed out of Awin; the automatic run also needs
  // the record's Landing Page URL and Platform Offer.
  function updateButtons() {
    const stop = blocked.length > 0 || session === false || session === 'checking';
    for (const b of ['.run', '.fill-only']) $(b).disabled = stop || record.core;
    for (const b of ['.manual-run', '.manual-fill']) $(b).disabled = stop;
    $('.manual-open').disabled = blocked.length > 0;
  }

  async function checkSession() {
    session = 'checking';
    $('.session').classList.remove('bad');
    $('.session-text').textContent = 'Checking you\'re signed in to Awin…';
    $('.session-actions').hidden = true;
    updateButtons();
    const answer = await ask({ action: 'tcaSetupCheckSession', mid });
    session = answer.signedIn === undefined ? null : answer.signedIn;
    if (session === false) {
      $('.session').classList.add('bad');
      $('.session-text').textContent = 'You\'re not signed in to Awin. Sign in, then click Check again.';
      $('.session-actions').hidden = false;
    } else {
      $('.session-text').textContent = session ? 'Signed in to Awin ✓' : `Couldn't check the Awin sign-in (${answer.detail || answer.error || 'no answer'}): the run will say if it's needed.`;
    }
    updateButtons();
  }

  async function open() {
    mid = readMid();
    record = readRecord();
    blocked = !mid ? ['No MID found on this record.'] : notCreatedYet(mid) ? ['This advertiser hasn\'t been created in Awin yet (the MID is 0). Create it first, then run the setup.'] : [];
    $('.ask').hidden = false;
    manualForm().hidden = true;
    $('.progress').hidden = true;
    $('.mid').textContent = [mid ? `MID ${mid}` : '', record.values.platformOffer].filter(Boolean).join(' · ');
    $('.error').textContent = blocked.join('\n');
    $('.shopify').textContent = '';
    // What the marketing checklist is missing, with the way round it.
    const gaps = record.missing.length && !blocked.length;
    $('.warn').hidden = !gaps && !record.note;
    $('.warn-text').textContent = gaps
      ? `The record is missing details the setup needs:\n• ${record.missing.join('\n• ')}${record.core ? '\nThe setup can run with them entered by hand.' : '\nThe pages that need them will be flagged, or enter them by hand.'}`
      : record.note;
    $('.tabs-only').disabled = !mid || notCreatedYet(mid);
    $('.session').hidden = blocked.length > 0;
    updateButtons();
    $('.backdrop').hidden = false;
    $(blocked.length || record.core ? '.cancel' : '.run').focus();
    shopping = null;
    siteNote = '';
    if (!blocked.length && !record.core) {
      const site = record.values.websiteUrl;
      $('.shopify').textContent = 'Checking the client\'s site…';
      shopping = checkSite(site, record.values.platformOffer).then(found => {
        if (found.url) record.values.websiteUrl = found.url;
        if ('ecommerce' in found) record.values.ecommerce = found.ecommerce;
        siteNote = found.note || '';
        $('.shopify').textContent = siteNote;
      });
    }
    if (!blocked.length) await checkSession();
  }

  async function start(save, values = record.values) {
    if (blocked.length || session === false) return;
    for (const b of ['.run', '.fill-only', '.manual-run', '.manual-fill']) $(b).disabled = true;
    if (shopping) await shopping;   // the Website URL may change for Shopify stores, and Access's query string
    // Details entered by hand for the same site keep the site check's platform result.
    if (values !== record.values && values.landingPage === record.values.landingPage && 'ecommerce' in record.values) values = { ...values, ecommerce: record.values.ecommerce };
    const answer = await ask({ action: 'tcaSetupRun', mid, values, save });
    if (!answer.ok) { $(manualForm().hidden ? '.error' : '.manual-error').textContent = `The setup couldn't start: ${answer.error}`; updateButtons(); return; }
    manualForm().hidden = true;
    finished = 0;
    running = true;
    results.length = 0;
    lastRun = { save, values, mid, siteNote, recordId: (location.pathname.match(/\/TSE__c\/([a-zA-Z0-9]+)/) || [])[1] || '' };
    $('.chatter').textContent = '';
    planPeek();
    hideMini();
    $('.mini').classList.remove('done', 'attention');
    $('.mini-stop').hidden = false;
    $('.mini-stop').disabled = false;
    $('.dismiss').hidden = true;
    setMiniLabel('Setup: starting…');
    $('.ask').hidden = true;
    $('.progress').hidden = false;
    $('.progress').classList.remove('done', 'attention');
    $('.stop').hidden = false;
    $('.stop').disabled = false;
    $('.close').textContent = 'Hide';
    $('.current').textContent = 'Starting…';
    for (const li of shadow.querySelectorAll('li')) { li.removeAttribute('data-status'); li.querySelector('.icon').textContent = '·'; li.querySelector('.msg').textContent = ''; }
    setBar(0);
    startSweep();
    setSingleView(values.platformOffer, save);   // on this record tab, while the setup works in its own tabs
  }

  // Accelerate and Advanced programmes get the record's "SingleView Setup" checklist set at the start
  // of the setup: saved with Run and save, left unsaved with Fill only. A problem here only gets a
  // note: the setup pages carry on.
  async function setSingleView(offer, save) {
    const sv = cfg.singleView;
    const note = $('.sv');
    note.textContent = '';
    if (!sv || !sv.offers.some(o => o.toLowerCase() === String(offer).toLowerCase())) return;
    note.textContent = `${sv.section}: setting it on the record…`;
    const fields = Object.entries(sv.values).map(([label, value]) => ({ label, value, excluded: false }));
    let result;
    try {
      result = await engine.run(document, { ...cfg, checklistTitle: sv.section }, fields, { mode: save ? 'save' : 'fill' });
    } catch (error) {
      result = { status: 'failed', message: error.message };
    }
    note.textContent = result.status === 'saved' ? `✓ ${sv.section} saved on the record (${Object.values(sv.values).join(', ')}).`
      : result.status === 'filled' ? `✎ ${sv.section} filled on the record, not saved: check it, then click Salesforce's Save.`
        : `⚠ ${sv.section} wasn't set: ${result.message}`;
  }

  // ---------- the Awin logo at the front of the bar ----------
  // It sweeps while the setup runs (see logoSvg) and stays whole at the end. It sits at the front of
  // the bar (never off its ends).
  const asset = name => { try { return chrome.runtime.getURL(`assets/${name}`); } catch { return ''; } };
  for (const image of shadow.querySelectorAll('.logo image')) image.setAttribute('href', asset('awin-logo.png'));
  function setSweep(on) {
    for (const svg of shadow.querySelectorAll('.logo')) {
      svg.dataset.state = on ? 'sweep' : 'still';
      try {
        if (on) { svg.setCurrentTime(0); svg.unpauseAnimations(); } else svg.pauseAnimations();
      } catch { /* no SVG animation API (tests) */ }
    }
  }
  const startSweep = () => setSweep(true);
  const stopSweep = () => setSweep(false);
  function placeLogo(n) {
    for (const el of shadow.querySelectorAll('.logo')) {
      const half = el.classList.contains('mini-logo') ? 9 : 16;
      el.style.left = `clamp(${half}px, ${(n / PAGES.length) * 100}%, calc(100% - ${half}px))`;
    }
  }

  // ---------- the hidden guy ----------
  // About one run in 20, he peeks up from behind the small box's bar once, somewhere along it, after a
  // random page (3rd to 8th). Only while the box is hidden away (the small box is showing), never in
  // the full box. Missed moments wait for the next page.
  const PEEK_CHANCE = 1 / 20;
  let peekAfter = 0;   // the page count after which he peeks this run; 0 = not this run
  function planPeek() { peekAfter = Math.random() < PEEK_CHANCE ? 3 + Math.floor(Math.random() * 6) : 0; }
  function maybePeek() {
    if (!peekAfter || !running || finished < peekAfter || mini().hidden) return;
    peekAfter = 0;
    const el = $('.peek');
    const img = el.querySelector('img');
    if (!img.getAttribute('src')) img.src = asset('runner-peek.gif');
    const front = (finished / PAGES.length) * 100;   // the logo's spot: keep clear of it
    const spot = front > 35 ? 8 + Math.random() * (front - 25) : front + 12 + Math.random() * Math.max(0, 80 - front);
    el.style.left = `${Math.min(92, spot).toFixed(1)}%`;
    el.classList.remove('up');
    el.hidden = false;
    void el.offsetWidth;   // restart the animation
    el.classList.add('up');
    setTimeout(() => { el.hidden = true; el.classList.remove('up'); }, 2700);
  }

  function setBar(n) {
    placeLogo(n);
    $('.fill').style.width = `${(n / PAGES.length) * 100}%`;
    $('.mini-fill').style.width = `${(n / PAGES.length) * 100}%`;
    $('.bar').setAttribute('aria-valuenow', String(n));
    $('.count').textContent = `${n} / ${PAGES.length}`;
    $('.mini-count').textContent = `${n} / ${PAGES.length}`;
  }

  // ---------- the small box shown after Hide, just above the Checklist Autofill panel ----------
  let running = false;
  let placing = null;
  const mini = () => $('.mini');
  function placeMini() {
    const panel = document.getElementById('tca-root') && document.getElementById('tca-root').shadowRoot && document.getElementById('tca-root').shadowRoot.querySelector('.panel');
    const top = panel ? panel.getBoundingClientRect().top : 0;
    mini().style.bottom = `${top > 0 ? Math.max(16, window.innerHeight - top + 8) : 64}px`;
  }
  function showMini() {
    mini().hidden = false;
    placeMini();
    clearInterval(placing);
    placing = setInterval(placeMini, 500);   // follows the panel as it opens and closes
    setTimeout(maybePeek, 1500);
  }
  function hideMini() {
    mini().hidden = true;
    clearInterval(placing);
  }
  function setMiniLabel(text) { $('.mini .label').textContent = `🚀 ${text}`; $('.mini').title = text; }

  function progress(update) {
    if (update.done) {
      running = false;
      $('.current').textContent = update.error || `${update.cancelled ? 'Cancelled' : 'Finished'}: ${update.summary}.`;
      setMiniLabel(update.error ? 'Setup couldn\'t run' : `Setup ${update.cancelled ? 'cancelled' : update.needsLook ? 'finished: needs a look' : 'finished'}: ${update.summary}`);
      $('.mini').classList.add(update.needsLook || update.cancelled || update.error ? 'attention' : 'done');
      $('.mini-stop').hidden = true;
      $('.dismiss').hidden = false;
      $('.stop').hidden = true;
      $('.close').textContent = 'Close';
      $('.progress').classList.add(update.needsLook || update.cancelled || update.error ? 'attention' : 'done');
      if (!update.cancelled) setBar(PAGES.length);
      stopSweep();
      // A summary for the record's Chatter, when something was saved (Run and save only).
      if (!update.error && lastRun && lastRun.save && results.some(r => r && r.status === 'saved')) postSummary(update);
      return;
    }
    const li = shadow.querySelector(`li[data-index="${update.index}"]`);
    if (!li) return;
    li.dataset.status = update.status;
    li.querySelector('.icon').textContent = ICON[update.status] || '·';
    const note = update.note || '';
    li.querySelector('.msg').textContent = update.status === 'working' ? `${update.message || 'working'}…` : update.status === 'saved' ? (note ? `— ${note}` : '') : `— ${update.message || ''}${update.diagnostics ? ` (${update.diagnostics})` : ''}`;
    if (update.status === 'working') {
      $('.current').textContent = `${PAGES[update.index]}${update.message ? `: ${update.message}` : ''}…`;
      setMiniLabel(`Setup: ${PAGES[update.index]}…`);
    } else {
      results[update.index] = update;
      finished = Math.max(finished, update.index + 1);
      setBar(finished);
      maybePeek();
    }
  }

  // ---------- a summary of the run, posted to the record's Chatter ----------
  // Moonfill's own Chatter code posts it (moonfillPost, in this tab), through the background script.
  // Chatter is only drawn while the page is showing, so a hidden tab waits until the TC comes back.
  const results = [];   // each page's last result this run
  let lastRun = null;   // { save, values, mid, recordId }
  function pageLine(r, i) {
    const message = String((r && r.message) || '').replace(/\.$/, '');
    const what = !r ? 'not started'
      : r.status === 'saved' ? (/^Already up to date/i.test(message) ? 'already up to date' : 'saved')
        : r.status === 'skipped' ? `skipped (${message.replace(/^Skipped:\s*/i, '')})`
          : r.status === 'filled' ? 'filled, not saved'
            : r.status === 'cancelled' ? 'not started (cancelled)'
              : `needs a look: ${message}`;
    const v = lastRun.values;
    const detail = i === 2 && r && r.status === 'saved' && v.transactionType ? ` (${v.transactionType}, ${v.commissionType}, ${v.publisherCommission}${v.commissionType === 'Percentage' ? '%' : ''})` : '';
    return `${(r && ICON[r.status]) || '·'} ${PAGES[i]}: ${what}${detail}`;
  }
  function summaryText(update) {
    let tool = 'AutoSetup';
    try { const m = chrome.runtime.getManifest(); tool = `${m.name} v${m.version_name || m.version}`; } catch { /* tests */ }
    const offer = lastRun.values.platformOffer;
    return [
      `🚀 Programme setup${lastRun.mid ? ` for MID ${lastRun.mid}` : ''}${offer ? ` (${offer})` : ''}: ${update.cancelled ? 'cancelled' : update.needsLook ? 'done, some pages need a look' : 'done'}`,
      `${update.summary}.`,
      ...PAGES.map((p, i) => pageLine(results[i], i)),
      $('.sv').textContent,
      lastRun.siteNote && `Site check: ${lastRun.siteNote}`,
      `Posted by ${tool}.`
    ].filter(Boolean).join('\n');
  }
  function postSummary(update) {
    const note = $('.chatter');
    const text = summaryText(update);
    const run = lastRun;
    const post = async () => {
      if (run !== lastRun) return;   // a new run has started since
      note.textContent = 'Posting a summary to the record\'s Chatter…';
      const answer = await ask({ action: 'tcaSetupChatter', text, recordId: run.recordId });
      note.textContent = answer.ok ? '✓ Summary posted to the record\'s Chatter.'
        : `⚠ The summary wasn't posted to Chatter: ${answer.error || 'no answer'}. Copy results has the same details.`;
    };
    if (document.visibilityState !== 'hidden') { post(); return; }
    note.textContent = 'The summary will be posted to the record\'s Chatter when you come back to this tab.';
    const onShow = () => {
      if (document.visibilityState === 'hidden') return;
      document.removeEventListener('visibilitychange', onShow);
      post();
    };
    document.addEventListener('visibilitychange', onShow);
  }

  // The results as text (page, status, message, structure report), to paste to whoever maintains it.
  $('.copy').addEventListener('click', async () => {
    const text = [`MID ${mid.replace(/\d{4,}/g, '#')} setup`, ...[...shadow.querySelectorAll('li')].map(li => li.textContent.replace(/\s+/g, ' ').trim()), $('.current').textContent, $('.sv').textContent, $('.chatter').textContent].filter(Boolean).join('\n');
    try { await navigator.clipboard.writeText(text); $('.copy').textContent = 'Copied'; } catch { $('.copy').textContent = 'Copy failed'; }
    setTimeout(() => { $('.copy').textContent = 'Copy results'; }, 2000);
  });

  // ---------- the details entered by hand (when the record is missing some) ----------
  function openManual() {
    const v = record.values;
    manualForm().reset();
    for (const name of ['websiteUrl', 'landingPage', 'platformOffer', 'transactionType', 'commissionType', 'publisherCommission', 'approval', 'validationDays']) {
      if (v[name]) manualField(name).value = v[name];
    }
    if (!v.approval) manualField('approval').value = 'Manual Approval';
    $('.manual-error').textContent = '';
    $('.ask').hidden = true;
    manualForm().hidden = false;
    updateButtons();
    const first = [...manualForm().elements].find(el => (el.tagName === 'INPUT' || el.tagName === 'SELECT') && !el.value);
    (first || $('.manual-run')).focus();
  }

  function manualValues() {
    const names = ['websiteUrl', 'landingPage', 'platformOffer', 'transactionType', 'commissionType', 'publisherCommission', 'approval', 'validationDays'];
    const v = Object.fromEntries(names.map(name => [name, String(manualField(name).value).trim()]));
    const empty = names.filter(name => !v[name]).map(name => manualField(name).closest('label').firstChild.textContent.trim());
    if (empty.length) throw new Error(`Please fill in: ${empty.join(', ')}.`);
    for (const name of ['websiteUrl', 'landingPage']) if (!/^https?:\/\/[^\s/]+\.[^\s]+$/i.test(v[name])) throw new Error(`${name === 'websiteUrl' ? 'Website URL' : 'Landing Page'} must be a full web address starting with https://.`);
    if (!/^\d+$/.test(v.validationDays) || +v.validationDays < 1) throw new Error('Validation Period Days must be a whole number of days.');
    v.publisherCommission = number(v.publisherCommission) || v.publisherCommission;
    return { ...v, assignedTc: record.values.assignedTc };
  }

  function startManual(save) {
    let v;
    try { v = manualValues(); } catch (error) { $('.manual-error').textContent = error.message; return; }
    start(save, v);
  }
  $('.manual-open').addEventListener('click', openManual);
  $('.back').addEventListener('click', () => { manualForm().hidden = true; $('.ask').hidden = false; });
  $('.manual-run').addEventListener('click', () => startManual(true));
  $('.manual-fill').addEventListener('click', () => startManual(false));
  $('.signin').addEventListener('click', () => window.open('https://ui.awin.com/', '_blank'));
  $('.recheck').addEventListener('click', checkSession);

  const close = () => { $('.backdrop').hidden = true; };
  // Hide during a run (or Close with results still worth seeing) leaves the small box on screen.
  const hide = () => { close(); if (running) showMini(); };
  mini().addEventListener('click', () => { hideMini(); $('.backdrop').hidden = false; });
  $('.dismiss').addEventListener('click', event => { event.stopPropagation(); hideMini(); });
  $('.mini-stop').addEventListener('click', event => { event.stopPropagation(); cancelRun(); });
  $('.run').addEventListener('click', () => start(true));
  $('.fill-only').addEventListener('click', () => start(false));
  $('.cancel').addEventListener('click', close);
  $('.close').addEventListener('click', hide);   // during a run: hides the dialog, the run carries on
  function cancelRun() {
    for (const b of ['.stop', '.mini-stop']) $(b).disabled = true;
    $('.current').textContent = 'Cancelling: the page being filled is finished first…';
    setMiniLabel('Cancelling after this page…');
    ask({ action: 'tcaSetupCancel' });
  }
  $('.stop').addEventListener('click', cancelRun);
  $('.backdrop').addEventListener('keydown', e => { if (e.key === 'Escape') hide(); });
  $('.tabs-only').addEventListener('click', () => { if (mid && !notCreatedYet(mid)) ask({ action: 'createNITabs', mid }); close(); });

  // Moonfill's 🚀 button: caught before its own click handler runs.
  window.addEventListener('click', event => {
    const button = event.target && event.target.closest && event.target.closest('button.mf-impl');
    if (!button || button.disabled) return;
    event.stopImmediatePropagation();
    event.preventDefault();
    open();
  }, true);

  try {
    chrome.runtime.onMessage.addListener(message => {
      if (message && message.action === 'tcaSetupProgress') progress(message);
      return undefined;
    });
  } catch { /* no extension messaging (tests) */ }

  (document.body || document.documentElement).appendChild(host);
  globalThis.TCASetupForm = { open, start, progress, readRecord, openManual };
})();
