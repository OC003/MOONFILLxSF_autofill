// Programme setup, stage 3 (Salesforce side): clicking Moonfill's 🚀 New Implementation button opens
// this form instead of the bare tabs. The TC checks the values read from the record and the client's
// site, answers the rest, and presses Run setup; the background script then fills and saves the pages
// one by one (setup/background.js), and progress shows here. Moonfill's own code is unchanged: its
// button's click is caught first, in the capture phase. "Just open the tabs" does what it always did.
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
  const ICON = { working: '…', saved: '✓', filled: '✎', skipped: '⏭', unconfirmed: '⚠', failed: '⚠' };
  const SHOPIFY_SHOP = /Shopify\.shop\s*=\s*["']([^"']+\.myshopify\.com)["']/i;
  const SAVE_KEY = 'tcaSetupSave';
  const { all, visible } = engine.dom;

  // ---------- reading the record ----------
  function readMid() {
    const link = all(document, 'a[href*="ui.awin.com/dashboard/awin/advertiser/"]').find(visible);
    return link ? ((link.getAttribute('href').match(/advertiser\/(\d+)/) || [])[1] || '') : '';
  }
  function readOffer() {
    const text = (engine.recordField(document, cfg, cfg.platformOfferLabel).find(f => f.text) || {}).text || '';
    return OFFERS.find(o => text.trim().toLowerCase().startsWith(o.toLowerCase())) || '';
  }
  const ask = message => Promise.resolve().then(() => chrome.runtime.sendMessage(message)).then(a => a || { error: 'no answer' }, e => ({ error: e.message }));

  // The store's own myshopify address, if the site is a Shopify shop: { url } or { note }.
  async function shopifyAddress(site) {
    const page = await ask({ action: 'tcaReadSite', url: site, via: 'fetch' });
    if (page.error === 'permission') return { note: 'To fill in a Shopify store\'s myshopify address automatically, turn on platform detection in Settings.' };
    let shop = page.ok && (page.text.match(SHOPIFY_SHOP) || [])[1];
    const looksShopify = page.ok && T.detect(page.text, cfg).name === 'Shopify';
    if (!shop && (!page.ok || looksShopify)) {
      const tab = await ask({ action: 'tcaReadSite', url: site, via: 'tab' });
      shop = tab.ok && (tab.text.match(SHOPIFY_SHOP) || [])[1];
    }
    if (shop) return { url: `https://${shop.toLowerCase()}`, note: 'Shopify store: Website URL set to its myshopify address.' };
    return { note: looksShopify ? 'Looks like Shopify, but the myshopify address wasn\'t found: enter it by hand.' : '' };
  }

  // ---------- the form ----------
  const host = document.createElement('div');
  host.id = 'tca-setup-form';
  const shadow = host.attachShadow({ mode: 'open' });
  const select = (name, label, options) => `<label>${label}<select name="${name}" required><option value="">Choose…</option>${options.map(o => `<option>${o}</option>`).join('')}</select></label>`;
  shadow.innerHTML = `
<style>
  :host { all: initial; }
  .backdrop { position: fixed; inset: 0; z-index: 2147483001; background: rgba(0,0,0,.35); display: flex; align-items: flex-start; justify-content: center; overflow: auto; padding: 40px 16px; }
  .dialog { width: 520px; max-width: 100%; background: #fff; color: #181818; border-radius: 8px; box-shadow: 0 8px 32px rgba(0,0,0,.3); font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  header { padding: 14px 18px 4px; font-size: 16px; font-weight: 600; }
  .sub { padding: 0 18px; color: #5c5c5c; }
  form { padding: 10px 18px 18px; display: grid; gap: 10px; }
  fieldset { border: 1px solid #e5e5e5; border-radius: 6px; padding: 8px 12px 12px; display: grid; gap: 8px; margin: 0; }
  legend { font-weight: 600; padding: 0 4px; }
  label { display: grid; gap: 3px; font-weight: 600; }
  input, select { font: inherit; font-weight: 400; padding: 5px 7px; border: 1px solid #c9c9c9; border-radius: 4px; }
  label.tick { display: flex; gap: 8px; align-items: center; font-weight: 400; }
  .note { color: #5c5c5c; font-size: 12px; font-weight: 400; }
  .note:empty { display: none; }
  .error { color: #ba0517; font-weight: 600; }
  .error:empty { display: none; }
  .row { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
  button { font: inherit; font-weight: 600; padding: 6px 14px; border-radius: 4px; border: 1px solid #0176d3; background: #fff; color: #0176d3; cursor: pointer; }
  button.primary { background: #0176d3; color: #fff; }
  button.link { border: 0; padding: 6px 4px; text-decoration: underline; margin-right: auto; }
  ol { margin: 0; padding: 10px 18px 4px 40px; display: grid; gap: 4px; }
  li .msg { color: #5c5c5c; font-size: 12px; }
  li[data-status="failed"], li[data-status="unconfirmed"] { color: #ba0517; }
  li[data-status="saved"] { color: #2e844a; }
  .progress { padding-bottom: 14px; }
  .progress .summary { padding: 6px 18px; font-weight: 600; }
  .progress .row { padding: 0 18px; }
  [hidden] { display: none !important; }
</style>
<div class="backdrop" hidden>
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="tca-setup-title">
    <header id="tca-setup-title">🚀 New Implementation setup</header>
    <div class="sub mid"></div>
    <form novalidate>
      <fieldset><legend>From the record (check)</legend>
        <label>Website URL<input name="websiteUrl" type="url" required></label>
        <div class="note shopify"></div>
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
      <label class="tick"><input type="checkbox" name="save"> Save each page <span class="note">(off: pages are filled for you to check and save yourself)</span></label>
      <div class="error" role="alert"></div>
      <div class="row">
        <button type="button" class="link tabs-only">Just open the tabs</button>
        <button type="button" class="cancel">Cancel</button>
        <button type="submit" class="primary">Run setup</button>
      </div>
    </form>
    <div class="progress" hidden>
      <ol>${PAGES.map((p, i) => `<li data-index="${i}"><span class="icon">·</span> ${p} <span class="msg"></span></li>`).join('')}</ol>
      <div class="summary" role="status" aria-live="polite">Running… The pages open in a tab group and are done one at a time.</div>
      <div class="row"><button type="button" class="close">Close</button></div>
    </div>
  </div>
</div>`;
  const $ = sel => shadow.querySelector(sel);
  const form = $('form');
  const field = name => form.elements[name];
  let mid = '';

  async function open() {
    mid = readMid();
    form.reset();
    $('.error').textContent = '';
    $('.shopify').textContent = '';
    $('form').hidden = false;
    $('.progress').hidden = true;
    for (const li of shadow.querySelectorAll('li')) { li.removeAttribute('data-status'); li.querySelector('.icon').textContent = '·'; li.querySelector('.msg').textContent = ''; }
    $('.mid').textContent = mid ? `MID ${mid}` : 'No MID found on this record.';
    const site = engine.landingPageUrl(document, cfg).url || '';
    field('websiteUrl').value = site;
    field('landingPage').value = site;
    field('platformOffer').value = readOffer();
    try { field('save').checked = !!(await chrome.storage.local.get(SAVE_KEY))[SAVE_KEY]; } catch { /* default off */ }
    $('.backdrop').hidden = false;
    field('transactionType').focus();
    if (site) {
      $('.shopify').textContent = 'Checking whether the site is a Shopify store…';
      const shop = await shopifyAddress(site);
      if (shop.url && field('websiteUrl').value === site) field('websiteUrl').value = shop.url;
      $('.shopify').textContent = shop.note || '';
    }
  }

  function values() {
    const v = Object.fromEntries(['websiteUrl', 'landingPage', 'platformOffer', 'transactionType', 'commissionType', 'publisherCommission', 'approval', 'validationDays']
      .map(name => [name, String(field(name).value).trim()]));
    const missing = Object.entries(v).filter(([, value]) => !value).map(([name]) => field(name).closest('label').firstChild.textContent.trim());
    if (missing.length) throw new Error(`Please fill in: ${missing.join(', ')}.`);
    for (const name of ['websiteUrl', 'landingPage']) if (!/^https?:\/\/[^\s/]+\.[^\s]+$/i.test(v[name])) throw new Error(`${name === 'websiteUrl' ? 'Website URL' : 'Landing Page'} must be a full web address starting with https://.`);
    if (!/^\d+$/.test(v.validationDays) || +v.validationDays < 1) throw new Error('Validation Period Days must be a whole number of days.');
    return { ...v, assignedTc: engine.assignedTc(document, cfg) };
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    let v;
    try { v = values(); } catch (error) { $('.error').textContent = error.message; return; }
    if (!mid) { $('.error').textContent = 'No MID found on this record.'; return; }
    const save = field('save').checked;
    try { await chrome.storage.local.set({ [SAVE_KEY]: save }); } catch { /* not remembered */ }
    const answer = await ask({ action: 'tcaSetupRun', mid, values: v, save });
    if (!answer.ok) { $('.error').textContent = `The setup couldn't start: ${answer.error}`; return; }
    $('form').hidden = true;
    $('.progress').hidden = false;
  });

  function progress(update) {
    if (update.done) {
      $('.summary').textContent = update.error || `Finished: ${update.summary}.`;
      return;
    }
    const li = shadow.querySelector(`li[data-index="${update.index}"]`);
    if (!li) return;
    li.dataset.status = update.status;
    li.querySelector('.icon').textContent = ICON[update.status] || '·';
    li.querySelector('.msg').textContent = update.status === 'working' ? 'working…' : update.status === 'saved' ? '' : `— ${update.message || ''}${update.diagnostics ? ` (${update.diagnostics})` : ''}`;
  }

  const close = () => { $('.backdrop').hidden = true; };
  $('.cancel').addEventListener('click', close);
  $('.close').addEventListener('click', close);
  $('.backdrop').addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  $('.tabs-only').addEventListener('click', () => { if (mid) ask({ action: 'createNITabs', mid }); close(); });

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
  globalThis.TCASetupForm = { open, values, progress };
})();
