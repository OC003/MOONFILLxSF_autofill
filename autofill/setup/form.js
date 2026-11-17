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

  // Everything the setup needs, from the record: { values, blocked: [reasons] }.
  function readRecord() {
    const R = cfg.setupRecord;
    const blocked = [];
    const site = engine.landingPageUrl(document, cfg).url || '';
    if (!site) blocked.push('The record has no Landing Page URL.');
    const offerText = field(cfg.platformOfferLabel);
    const platformOffer = OFFERS.find(o => offerText.toLowerCase().startsWith(o.toLowerCase())) || '';
    if (!platformOffer) blocked.push(offerText ? `Platform Offer "${offerText}" isn't Access, Accelerate or Advanced.` : 'The record has no Platform Offer.');

    // Commission group: only "Percentage" programmes are set up automatically (Sale + Percentage).
    const type = field(R.commissionType);
    const amount = number(field(R.commissionAmount));
    const commission = /^percentage$/i.test(type)
      ? (amount ? { transactionType: 'Sale', commissionType: 'Percentage', publisherCommission: amount }
        : { commissionProblem: `"${R.commissionAmount}" is empty on the record, so the commission group wasn't set.` })
      : { commissionSkip: type ? `Commission type is "${type}": set the commission group by hand` : `"${R.commissionType}" is empty on the record: set the commission group by hand` };

    const values = {
      websiteUrl: site, landingPage: site, platformOffer, ...commission,
      approval: 'Manual Approval',
      validationDays: (field(R.validationPeriod).match(/\d+/) || [''])[0],
      assignedTc: engine.assignedTc(document, cfg)
    };
    return { values, blocked };
  }

  const ask = message => Promise.resolve().then(() => chrome.runtime.sendMessage(message)).then(a => a || { error: 'no answer' }, e => ({ error: e.message }));

  // The store's own myshopify address, if the site is a Shopify shop: { url } or { note }.
  async function shopifyAddress(site) {
    const page = await ask({ action: 'tcaReadSite', url: site, via: 'fetch' });
    if (page.error === 'permission') return { note: 'Tip: allow platform detection in Settings so Shopify stores get their myshopify address.' };
    let shop = page.ok && (page.text.match(SHOPIFY_SHOP) || [])[1];
    const looksShopify = page.ok && T.detect(page.text, cfg).name === 'Shopify';
    if (!shop && (!page.ok || looksShopify)) {
      const tab = await ask({ action: 'tcaReadSite', url: site, via: 'tab' });
      shop = tab.ok && (tab.text.match(SHOPIFY_SHOP) || [])[1];
    }
    if (shop) return { url: `https://${shop.toLowerCase()}`, note: 'Shopify store: its myshopify address is used as the Website URL.' };
    return { note: looksShopify ? 'Looks like Shopify, but the myshopify address wasn\'t found: the Landing Page URL is used.' : '' };
  }

  // ---------- the dialog ----------
  const host = document.createElement('div');
  host.id = 'tca-setup-form';
  const shadow = host.attachShadow({ mode: 'open' });
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
  .bar-row { display: flex; align-items: center; gap: 10px; }
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
  [hidden] { display: none !important; }
</style>
<div class="backdrop" hidden>
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="tca-setup-title">
    <header id="tca-setup-title">🚀 New Implementation setup</header>
    <div class="ask">
      <div class="muted mid"></div>
      <p>Everything is taken from the record. Save each page as it's filled?</p>
      <div class="note shopify"></div>
      <div class="error" role="alert"></div>
      <div class="row">
        <button type="button" class="link tabs-only">Just open the tabs</button>
        <button type="button" class="cancel">Cancel</button>
        <button type="button" class="fill-only">Fill only</button>
        <button type="button" class="primary run">Run and save</button>
      </div>
    </div>
    <div class="progress" hidden>
      <div class="bar-row">
        <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="10" aria-valuenow="0"><div class="fill"></div></div>
        <span class="count">0 / 10</span>
        <button type="button" class="stop" title="Cancel the setup" aria-label="Cancel the setup">✕</button>
      </div>
      <div class="current" role="status" aria-live="polite">Starting…</div>
      <details><summary>Details</summary>
        <ol>${PAGES.map((p, i) => `<li data-index="${i}"><span class="icon">·</span> ${p} <span class="msg"></span></li>`).join('')}</ol>
      </details>
      <div class="row"><button type="button" class="copy">Copy results</button><button type="button" class="close">Hide</button></div>
    </div>
  </div>
</div>`;
  const $ = sel => shadow.querySelector(sel);
  let mid = '';
  let record = { values: null, blocked: [] };
  let shopping = null;   // the Shopify check, once started
  let finished = 0;
  const notCreatedYet = m => /^0+$/.test(m);

  async function open() {
    mid = readMid();
    record = readRecord();
    if (!mid) record.blocked.unshift('No MID found on this record.');
    else if (notCreatedYet(mid)) record.blocked.unshift('This advertiser hasn\'t been created in Awin yet (the MID is 0). Create it first, then run the setup.');
    $('.ask').hidden = false;
    $('.progress').hidden = true;
    $('.mid').textContent = [mid ? `MID ${mid}` : '', record.values.platformOffer].filter(Boolean).join(' · ');
    $('.error').textContent = record.blocked.join('\n');
    $('.shopify').textContent = '';
    const blocked = record.blocked.length > 0;
    for (const b of ['.run', '.fill-only']) $(b).disabled = blocked;
    $('.tabs-only').disabled = !mid || notCreatedYet(mid);
    $('.backdrop').hidden = false;
    $(blocked ? '.cancel' : '.run').focus();
    shopping = null;
    if (!blocked) {
      const site = record.values.websiteUrl;
      $('.shopify').textContent = 'Checking whether the site is a Shopify store…';
      shopping = shopifyAddress(site).then(shop => {
        if (shop.url) record.values.websiteUrl = shop.url;
        $('.shopify').textContent = shop.note || '';
      });
    }
  }

  async function start(save) {
    if (record.blocked.length) return;
    for (const b of ['.run', '.fill-only']) $(b).disabled = true;
    if (shopping) await shopping;   // the Website URL may change for Shopify stores
    const answer = await ask({ action: 'tcaSetupRun', mid, values: record.values, save });
    if (!answer.ok) { $('.error').textContent = `The setup couldn't start: ${answer.error}`; for (const b of ['.run', '.fill-only']) $(b).disabled = false; return; }
    finished = 0;
    $('.ask').hidden = true;
    $('.progress').hidden = false;
    $('.progress').classList.remove('done', 'attention');
    $('.stop').hidden = false;
    $('.stop').disabled = false;
    $('.close').textContent = 'Hide';
    $('.current').textContent = 'Starting…';
    for (const li of shadow.querySelectorAll('li')) { li.removeAttribute('data-status'); li.querySelector('.icon').textContent = '·'; li.querySelector('.msg').textContent = ''; }
    setBar(0);
  }

  function setBar(n) {
    $('.fill').style.width = `${(n / PAGES.length) * 100}%`;
    $('.bar').setAttribute('aria-valuenow', String(n));
    $('.count').textContent = `${n} / ${PAGES.length}`;
  }

  function progress(update) {
    if (update.done) {
      $('.current').textContent = update.error || `${update.cancelled ? 'Cancelled' : 'Finished'}: ${update.summary}.`;
      $('.stop').hidden = true;
      $('.close').textContent = 'Close';
      $('.progress').classList.add(update.needsLook || update.cancelled || update.error ? 'attention' : 'done');
      if (!update.cancelled) setBar(PAGES.length);
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
    } else {
      finished = Math.max(finished, update.index + 1);
      setBar(finished);
    }
  }

  // The results as text (page, status, message, structure report), to paste to whoever maintains it.
  $('.copy').addEventListener('click', async () => {
    const text = [`MID ${mid.replace(/\d{4,}/g, '#')} setup`, ...[...shadow.querySelectorAll('li')].map(li => li.textContent.replace(/\s+/g, ' ').trim()), $('.current').textContent].join('\n');
    try { await navigator.clipboard.writeText(text); $('.copy').textContent = 'Copied'; } catch { $('.copy').textContent = 'Copy failed'; }
    setTimeout(() => { $('.copy').textContent = 'Copy results'; }, 2000);
  });

  const close = () => { $('.backdrop').hidden = true; };
  $('.run').addEventListener('click', () => start(true));
  $('.fill-only').addEventListener('click', () => start(false));
  $('.cancel').addEventListener('click', close);
  $('.close').addEventListener('click', close);   // during a run: hides the dialog, the run carries on
  $('.stop').addEventListener('click', () => {
    $('.stop').disabled = true;
    $('.current').textContent = 'Cancelling: the page being filled is finished first…';
    ask({ action: 'tcaSetupCancel' });
  });
  $('.backdrop').addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
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
  globalThis.TCASetupForm = { open, start, progress, readRecord };
})();
