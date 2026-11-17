import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';

const root = new URL('../../', import.meta.url);      // autofill/
const read = path => readFileSync(new URL(path, root), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));

const VALUES = {
  websiteUrl: 'https://fictional-shop.myshopify.com', landingPage: 'https://www.fictional-shop.example/',
  platformOffer: 'Advanced', transactionType: 'Sale', commissionType: 'Percentage', publisherCommission: '7.5',
  approval: 'Auto Approval', validationDays: '30', assignedTc: 'Alex Mock-Person'
};

// A fictional Awin page at the given path. `script` runs in the page (for its own behaviour).
function awin(path, body, script = '') {
  const dom = new JSDOM(`<!doctype html><body>
    <form class="switcher"><input name="switchId" type="text"><button type="submit">Submit</button></form>
    ${body}<script>${script}</script></body>`, {url: `https://ui.awin.com${path}`, runScripts: 'dangerously', pretendToBeVisual: true});
  const {window} = dom;
  for (const f of ['config.js', 'engine.js', 'setup/fill.js']) window.eval(read(f));
  return window;
}
const fill = (w, values = VALUES, save = false) => w.TCASetupFill.fillPage(values, save);

// ---------- Pages ----------

test('tracking settings: URLs, the query string by Platform Offer, two tick boxes; Save is enabled by the changes', async () => {
  const body = `<input id="MainWebsiteURL" value="old"><input id="GlobalClickThroughPage" value="old"><input id="ClickAppend">
    <input type="checkbox" id="AppendAWC"><input type="checkbox" id="DeeplinkEnabled"><input type="checkbox" id="NoDomainDeeplink" checked>
    <button type="submit" class="btn btn-disabled" disabled id="save">Save</button>`;
  const enableOnInput = `document.addEventListener('input', () => { const b = document.getElementById('save'); b.disabled = false; b.classList.remove('btn-disabled'); });
    document.getElementById('save').addEventListener('click', () => { window.saved = (window.saved || 0) + 1; });`;
  let w = awin('/tracking-settings/us/awin/advertiser/123456/main-settings', body, enableOnInput);
  assert.equal((await fill(w)).status, 'filled');
  const $ = id => w.document.getElementById(id);
  assert.deepEqual([$('MainWebsiteURL').value, $('GlobalClickThroughPage').value, $('ClickAppend').value], [VALUES.websiteUrl, VALUES.landingPage, 'source=aw&utm_source=awin&sv1=affiliate&sv_campaign_id=!!!id!!!']);
  assert.deepEqual([$('DeeplinkEnabled').checked, $('NoDomainDeeplink').checked, $('AppendAWC').checked], [true, true, false], 'an already ticked box stays ticked');
  assert.equal(w.saved, undefined, 'Fill only never saves');

  w = awin('/tracking-settings/us/awin/advertiser/123456/main-settings', body, enableOnInput);
  const result = await fill(w, {...VALUES, platformOffer: 'Access'}, true);
  assert.equal(result.status, 'saving');
  assert.equal(w.document.getElementById('ClickAppend').value, 'source=aw');
  await tick(150);
  assert.equal(w.saved, 1);
  assert.equal((await w.TCASetupFill.verifyPage({...VALUES, platformOffer: 'Access'})).status, 'saved');
});

test('tracking settings: waits for a new programme\'s form to appear, and finds boxes by label if their ids differ', async () => {
  const w = awin('/tracking-settings/us/awin/advertiser/123456/main-settings', '<div id="app">Loading…</div>',
    `setTimeout(() => { document.getElementById('app').innerHTML =
      '<label for="w">Website URL</label><input id="w" type="text">' +
      '<label for="l">Landing Page</label><input id="l" type="text">' +
      '<label for="q">Default Query String Append</label><input id="q" type="text">' +
      '<label><input type="checkbox" id="d"> Enable Link Builder for publishers</label>' +
      '<label><input type="checkbox" id="r"> Use relative URLs for deep links</label>'; }, 400);`);
  const result = await fill(w);
  assert.equal(result.status, 'filled', result.message);
  const $ = id => w.document.getElementById(id);
  assert.deepEqual([$('w').value, $('l').value, $('q').value, $('d').checked, $('r').checked],
    [VALUES.websiteUrl, VALUES.landingPage, 'source=aw&utm_source=awin&sv1=affiliate&sv_campaign_id=!!!id!!!', true, true]);
});

test('pages that come pre-filled are skipped, and the plugin is skipped for Access', async () => {
  assert.equal((await fill(awin('/awin/merchant/123456/settings/invite-user', '<input id="email">'))).status, 'skipped');
  assert.equal((await fill(awin('/provider/finance/fee-manager/en/123456', ''))).status, 'skipped');
  const plugin = await fill(awin('/advertiser-mastertag/us/awin/123456/plugins', ''), {...VALUES, platformOffer: 'Access'});
  assert.deepEqual([plugin.status, plugin.message], ['skipped', 'Skipped: not needed for Access.']);
});

// A dropdown built from plain elements, opened by a click, as on newer Awin pages.
const customDropdown = (label, options) => `<div class="field"><span class="field-title">${label}</span>
  <div class="ng-select" tabindex="0"><div class="ng-value">Choose</div></div>
  <ul class="ng-dropdown" hidden>${options.map(o => `<li role="option" class="ng-option">${o}</li>`).join('')}</ul></div>`;
const dropdownScript = `document.addEventListener('click', e => {
  const trigger = e.target.closest('.ng-select');
  if (trigger) { trigger.nextElementSibling.hidden = false; return; }
  const option = e.target.closest('.ng-option');
  if (option) { const list = option.parentElement; list.previousElementSibling.querySelector('.ng-value').textContent = option.textContent; list.hidden = true; }
});`;

test('commission groups: opens the edit view, then fills the two custom dropdowns and the commission by their labels', async () => {
  const w = awin('/commission-manager/us/awin/merchant/123456/commission-groups', `
    <button type="submit" class="btn edit-table" id="edit">Edit Commission Groups</button>
    <div id="editor" hidden>${customDropdown('Transaction Type', ['Sale', 'Lead'])}${customDropdown('Commission Type', ['Fixed', 'Percentage'])}
      <div class="field"><label>Publisher Commission</label><input type="text" class="rate"></div><button type="button">Save</button></div>`,
  `${dropdownScript} document.getElementById('edit').addEventListener('click', () => { document.getElementById('editor').hidden = false; });`);
  const result = await fill(w);
  assert.equal(result.status, 'filled', result.message);
  const values = [...w.document.querySelectorAll('.ng-value')].map(v => v.textContent);
  assert.deepEqual(values, ['Sale', 'Percentage']);
  assert.equal(w.document.querySelector('.rate').value, '7.5');
});

test('commission groups on a new programme: clicks "Add Default Commission Group" to show the fields', async () => {
  const w = awin('/commission-manager/us/awin/merchant/123456/commission-groups', `
    <button type="button" class="btn" id="add">Add Default Commission Group</button>
    <div id="editor" hidden>${customDropdown('Transaction Type', ['Sale', 'Lead'])}${customDropdown('Commission Type', ['Fixed', 'Percentage'])}
      <div class="field"><label>Publisher Commission</label><input type="text" class="rate"></div><button type="button">Save</button></div>`,
  `${dropdownScript} document.getElementById('add').addEventListener('click', () => { document.getElementById('editor').hidden = false; window.added = (window.added || 0) + 1; });`);
  const result = await fill(w);
  assert.equal(result.status, 'filled', result.message);
  assert.equal(w.added, 1, 'clicked once');
  assert.deepEqual([...w.document.querySelectorAll('.ng-value')].map(v => v.textContent), ['Sale', 'Percentage']);
  assert.equal(w.document.querySelector('.rate').value, '7.5');
});

test('a missing option stops the page with a clear message, and nothing is saved', async () => {
  const w = awin('/commission-manager/us/awin/merchant/123456/commission-groups', `${customDropdown('Transaction Type', ['Lead'])}${customDropdown('Commission Type', ['Fixed'])}
    <label>Publisher Commission <input type="text"></label><button type="button" onclick="window.saved = true">Save</button>`, dropdownScript);
  const result = await fill(w, VALUES, true);
  assert.equal(result.status, 'failed');
  assert.match(result.message, /"Transaction Type": option "Sale" didn't appear/);
  assert.match(result.diagnostics, /visible controls/);
  await tick(150);
  assert.equal(w.saved, undefined);
});

test('plugin store: dismisses the new-Awin prompt, adds the R.O.EYE plugin with its code line, saves in the plugin menu', async () => {
  const w = awin('/advertiser-mastertag/us/awin/123456/plugins', `
    <div class="prompt"><a class="button button--primary">Open Plugin Store in New Awin</a><button class="button button--ghost" onclick="this.parentElement.remove()">Stay here for now</button></div>
    <a class="btn btn-sm btn-icon" id="add">Add Plugin</a>
    <div class="modal" id="menu" hidden><select><option>Choose…</option><option>Google Tag</option><option>R.O.EYE - Consent - SingleView</option></select>
      <textarea></textarea><button type="button" id="save">Save</button></div>`,
  `document.getElementById('add').addEventListener('click', () => { document.getElementById('menu').hidden = false; });
   document.getElementById('save').addEventListener('click', () => { window.saved = true; });`);
  const result = await fill(w, VALUES, true);
  assert.equal(result.status, 'saving', result.message);
  assert.equal(w.document.querySelector('.prompt'), null);
  assert.equal(w.document.querySelector('#menu select').selectedOptions[0].text, 'R.O.EYE - Consent - SingleView');
  assert.equal(w.document.querySelector('#menu textarea').value, 'AWIN.Tracking.RoEye = AWIN.Tracking.RoEye || {};');
  await tick(150);
  assert.equal(w.saved, true);
});

test('tracking tag settings: the dropdown offering "Conversion Tag and Image Pixel integrated" is set', async () => {
  const w = awin('/advertiser-mastertag/us/awin/123456/trackingtagsettings', `${customDropdown('Integration', ['Conversion Tag only', 'Conversion Tag and Image Pixel integrated'])}<button type="button">Save</button>`, dropdownScript);
  assert.equal((await fill(w)).status, 'filled');
  assert.equal(w.document.querySelector('.ng-value').textContent, 'Conversion Tag and Image Pixel integrated');
});

test('account details, mobile tracking and advertiser settings: the agreed fields only', async () => {
  let w = awin('/provider/merchant-settings/123456/account-details/network/awin', `<input type="checkbox" id="crossDevice">
    <input type="checkbox" id="ipTrackingEnabled"><input type="checkbox" id="referer_truncation_isDomainIncludeInvalid"><button id="tracking-masterdata-submit">Save</button>`);
  assert.equal((await fill(w)).status, 'filled');
  assert.deepEqual(['crossDevice', 'ipTrackingEnabled', 'referer_truncation_isDomainIncludeInvalid'].map(id => w.document.getElementById(id).checked), [false, true, true]);

  w = awin('/provider/merchant-settings/123456/mobile-tracking/network/awin', `
    <label><input type="radio" name="strategy" value="a" checked> Redirect solution<span>Tracking is not implemented on mobile site, however…</span></label>
    <label><input type="radio" name="strategy" value="b"> Tracking is implemented on mobile site<span>The advertiser…</span></label>
    <button id="updateChanges" type="submit">Update Changes</button>`);
  assert.equal((await fill(w)).status, 'filled');
  assert.equal(w.document.querySelector('input[name="strategy"]:checked').value, 'b');

  w = awin('/provider/migrated-advertiser-settings/123456', `
    <label for="a1">Approval of Publishers Joining</label><select id="a1"><option value="0">Manual Approval</option><option value="1">Auto Approval</option></select>
    <label for="d1">Validation Period Days</label><input type="number" id="d1" value="45">
    <label for="n1">Name</label><input id="n1" value="Fictional Ltd"><button id="migrated_advertiser_settings_save">Save</button>`);
  assert.equal((await fill(w)).status, 'filled');
  assert.deepEqual([w.document.getElementById('a1').value, w.document.getElementById('d1').value, w.document.getElementById('n1').value], ['1', '30', 'Fictional Ltd']);
  assert.equal((await w.TCASetupFill.verifyPage(VALUES)).status, 'saved');
});

const prejoin = rows => awin('/provider/pre-join-publishers', `<form id="list"><table>
  ${rows.map(id => `<tr><td><input type="checkbox" name="publishers[]"></td><td>${id}</td><td>Publisher name</td></tr>`).join('')}
  </table><button type="submit" class="btn" onclick="event.preventDefault(); window.submitted = (window.submitted || 0) + 1">Submit</button></form>`);

test('pre-join publishers: ticks exactly 45628 and 111 (not 1111) and submits their form', async () => {
  const w = prejoin(['1111', '45628', '111']);
  const result = await fill(w, VALUES, true);
  assert.equal(result.status, 'saving', result.message);
  assert.deepEqual([...w.document.querySelectorAll('input[type="checkbox"]')].map(b => b.checked), [false, true, true]);
  await tick(150);
  assert.equal(w.submitted, 1);
  assert.equal(w.document.querySelector('.switcher input').value, '', 'the account switcher is never touched');
});

test('pre-join publishers: none listed means probably already done; one missing is a failure', async () => {
  assert.equal((await fill(prejoin(['999']))).status, 'unconfirmed');
  const one = await fill(prejoin(['45628']));
  assert.deepEqual([one.status, one.message], ['failed', 'Publisher 111 not found with a tick box.']);
});

test('after Save, an error on the page is reported as failed', async () => {
  const w = awin('/provider/pre-join-publishers', '<div class="alert alert-danger">Something went wrong, please try again</div>');
  const result = await w.TCASetupFill.verifyPage(VALUES);
  assert.equal(result.status, 'failed');
  assert.match(result.message, /Something went wrong/);
});

// ---------- Background runner ----------

function runner(answers) {
  const sent = [];
  const created = [];
  const context = vm.createContext({console, setTimeout, clearTimeout, URL});
  const listeners = [];
  context.chrome = {
    runtime: {onMessage: {addListener: l => listeners.push(l)}},
    tabs: {
      create: async o => { const tab = {id: 100 + created.length, ...o}; created.push(tab); return tab; },
      get: async id => ({id, status: 'complete'}),
      group: async () => 1,
      sendMessage: async (tabId, m) => { sent.push([tabId, m.action, m.symbol || m.status || m.index]); return answers(tabId - 100, m); },
      onUpdated: {addListener: () => {}, removeListener: () => {}}
    },
    tabGroups: {update: async () => {}},
    notifications: {create: (id, o) => { context.notified = o; }}
  };
  context.usage = [];
  context.TCAUsageWorker = {add: e => context.usage.push(e)};
  vm.runInContext('const NI_URLS = mid => Array.from({length: 10}, (_, i) => `https://ui.awin.com/page${i}/${mid}`);', context);
  vm.runInContext(read('setup/background.js'), context);
  Object.assign(context.TCASetupRunner.T, {settle: 1, reloadStart: 5, answer: 50, retryWait: 1});
  const start = message => new Promise(resolve => listeners[0](message, {tab: {id: 7}}, resolve));
  return {context, sent, created, start};
}

test('runner: opens the 10 pages, does them one at a time, retries pre-join, carries on after a failure', async () => {
  let prejoinTries = 0;
  const {context, sent, created, start} = runner((index, m) => {
    if (m.action === 'tcaSetupMark') return {ok: true};
    if (m.action === 'tcaSetupFill') {
      if ([1, 6].includes(index)) return {status: 'skipped', message: 'Skipped.'};
      if (index === 2) return {status: 'failed', message: '"Transaction Type" not found on the page.'};
      return {status: 'saving', page: index === 9 ? 'prejoin' : `p${index}`};
    }
    if (m.action === 'tcaSetupVerify') {
      if (index === 9 && ++prejoinTries < 3) return {status: 'failed', message: 'The page shows an error'};
      return {status: 'saved', message: 'Saved.'};
    }
    return undefined;
  });
  assert.deepEqual(plain(await start({action: 'tcaSetupRun', mid: '123456', values: VALUES, save: true})), {ok: true});
  for (let i = 0; i < 200 && !context.notified; i++) await tick(10);
  assert.equal(created.length, 10);
  assert.ok(created.every(t => t.active === false), 'tabs open in the background');
  const order = sent.filter(([, action]) => action === 'tcaSetupFill').map(([tab]) => tab);
  assert.deepEqual(order, [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 109, 109], 'one page at a time; pre-join tried 3 times');
  const progress = sent.filter(([, action]) => action === 'tcaSetupProgress');
  assert.ok(progress.length >= 21 && progress.every(([tab]) => tab === 7), 'progress (working + result per page, then done) goes to the record tab');
  const marks = sent.filter(([, action]) => action === 'tcaSetupMark').map(([tab, , symbol]) => [tab, symbol]);
  assert.deepEqual(marks.map(m => m[1]), ['✓', '⏭', '⚠', '✓', '✓', '✓', '⏭', '✓', '✓', '✓']);
  assert.match(context.notified.title, /Setup for MID 123456: needs a look/);
  assert.match(context.notified.message, /7 saved, 2 skipped, 1 need a look/);
  assert.match(context.notified.message, /Commission groups: "Transaction Type" not found/);
  assert.deepEqual(plain(context.usage), [{tool: 'New Implementation', action: 'setup', outcome: 'failed', reason: 'setup-page-failed', tc: 'Alex Mock-Person'}]);
});

test('runner: gives up on pre-join after 5 attempts and says so', async () => {
  const {context, start} = runner((index, m) => {
    if (m.action === 'tcaSetupFill') return index === 9 ? {status: 'saving', page: 'prejoin'} : {status: 'skipped', message: 'Skipped.'};
    if (m.action === 'tcaSetupVerify') return {status: 'failed', message: 'The page shows an error'};
    return {ok: true};
  });
  await start({action: 'tcaSetupRun', mid: '1', values: VALUES, save: true});
  for (let i = 0; i < 200 && !context.notified; i++) await tick(10);
  assert.match(context.notified.message, /Pre-join publishers: The page shows an error \(tried 5 times\)/);
});

// ---------- The form on the Salesforce record ----------

async function record(chrome) {
  const path = 'dev/mock/lightning-record.html';
  const dom = await JSDOM.fromFile(fileURLToPath(new URL(path, root)), {url: new URL(`${path}?scenario=success`, root).href, runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true});
  await new Promise(resolve => dom.window.addEventListener('load', resolve));
  const {window} = dom;
  window.chrome = chrome;
  for (const f of ['fields.js', 'config.js', 'settings.js', 'templates.js', 'engine.js', 'setup/form.js']) window.eval(read(f));
  return window;
}
function fakeChrome(site = () => ({error: 'permission'})) {
  const chrome = {
    messages: [], local: {},
    runtime: {sendMessage: async m => { chrome.messages.push(m); return m.action === 'tcaReadSite' ? site(m) : {ok: true}; }, onMessage: {addListener: l => { chrome.listener = l; }}},
    storage: {local: {get: async k => ({[k]: chrome.local[k]}), set: async o => Object.assign(chrome.local, o)}}
  };
  return chrome;
}
const formRoot = window => window.document.getElementById('tca-setup-form').shadowRoot;

test('form: the 🚀 click opens the setup form instead of Moonfill\'s tabs, filled in from the record', async () => {
  const chrome = fakeChrome();
  const window = await record(chrome);
  window.document.querySelector('button.mf-impl').click();
  await tick(30);
  assert.equal(window.moonfillNIClicks, undefined, "Moonfill's own click handler didn't run");
  const ui = formRoot(window);
  assert.equal(ui.querySelector('.backdrop').hidden, false);
  const f = ui.querySelector('form').elements;
  assert.deepEqual([f.websiteUrl.value, f.landingPage.value, f.platformOffer.value], ['https://shop.example.com/', 'https://shop.example.com/', 'Advanced']);
  assert.equal(ui.querySelector('.mid').textContent, 'MID 123456');
  assert.match(ui.querySelector('.shopify').textContent, /turn on platform detection in Settings/);
  assert.equal(f.save.checked, true, 'saving is on by default');
});

test('form: Shopify stores get their myshopify address as the Website URL', async () => {
  const chrome = fakeChrome(() => ({ok: true, status: 200, text: '<script>Shopify.shop = "fictional-shop.myshopify.com";</script> cdn.shopify.com'}));
  const window = await record(chrome);
  await window.TCASetupForm.open();
  const f = formRoot(window).querySelector('form').elements;
  assert.equal(f.websiteUrl.value, 'https://fictional-shop.myshopify.com');
  assert.equal(f.landingPage.value, 'https://shop.example.com/');
});

test('form: Run setup checks the answers, then starts the run with them; Just open the tabs is Moonfill\'s old behaviour', async () => {
  const chrome = fakeChrome();
  const window = await record(chrome);
  await window.TCASetupForm.open();
  const ui = formRoot(window);
  const f = ui.querySelector('form').elements;
  ui.querySelector('button[type="submit"]').click();
  await tick();
  assert.match(ui.querySelector('.error').textContent, /Please fill in: Transaction Type, Commission Type, Publisher commission, Approval of Publishers Joining, Validation Period Days/);
  Object.assign(f.transactionType, {value: 'Lead'}); f.commissionType.value = 'Fixed'; f.publisherCommission.value = '5'; f.approval.value = 'Manual Approval'; f.validationDays.value = '3.5';
  ui.querySelector('button[type="submit"]').click();
  await tick();
  assert.match(ui.querySelector('.error').textContent, /whole number of days/);
  f.validationDays.value = '30';
  ui.querySelector('button[type="submit"]').click();
  await tick();
  const run = chrome.messages.find(m => m.action === 'tcaSetupRun');
  assert.deepEqual(plain(run), {action: 'tcaSetupRun', mid: '123456', save: true, values: {
    websiteUrl: 'https://shop.example.com/', landingPage: 'https://shop.example.com/', platformOffer: 'Advanced', transactionType: 'Lead', commissionType: 'Fixed',
    publisherCommission: '5', approval: 'Manual Approval', validationDays: '30', assignedTc: 'Alex Mock-Person'}});
  assert.equal(chrome.local.tcaSetupSave, true, 'the save choice is remembered');
  assert.equal(ui.querySelector('.progress').hidden, false);
  chrome.listener({action: 'tcaSetupProgress', index: 2, status: 'failed', message: 'Not found.'});
  chrome.listener({action: 'tcaSetupProgress', done: true, summary: '8 saved, 1 need a look'});
  assert.match(ui.querySelector('li[data-index="2"]').textContent, /⚠ Commission groups — Not found\./);
  assert.equal(ui.querySelector('.summary').textContent, 'Finished: 8 saved, 1 need a look.');

  await window.TCASetupForm.open();
  ui.querySelector('.tabs-only').click();
  await tick();
  assert.deepEqual(plain(chrome.messages.at(-1)), {action: 'createNITabs', mid: '123456'});
});

test('manifest: the setup filler runs on ui.awin.com only, top frame, with no panel of its own', async () => {
  const manifest = JSON.parse(read('../manifest.json'));
  const entry = manifest.content_scripts.find(c => c.js.includes('autofill/setup/fill.js'));
  assert.deepEqual(plain(entry.matches), ['https://ui.awin.com/*']);
  assert.deepEqual(plain(entry.js), ['autofill/config.js', 'autofill/engine.js', 'autofill/setup/fill.js']);
  assert.equal(entry.all_frames, undefined);
  const w = awin('/tracking-settings/us/awin/advertiser/1/main-settings', '');
  assert.equal(w.document.querySelector('[id^="tca-"]'), null, 'nothing is added to Awin pages');
});

test('form: turning Save each page off is remembered for the next run', async () => {
  const chrome = fakeChrome();
  chrome.local.tcaSetupSave = false;
  const window = await record(chrome);
  await window.TCASetupForm.open();
  assert.equal(formRoot(window).querySelector('form').elements.save.checked, false);
});

