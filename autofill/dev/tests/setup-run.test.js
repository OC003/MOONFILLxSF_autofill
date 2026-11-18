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
  Object.assign(window.TCASetupFill.T, {quiet: 30, quietMax: 1500, recheck: 60});
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

test('tracking settings: if the page loads its saved settings over the typed values, they are typed again', async () => {
  const w = awin('/tracking-settings/us/awin/advertiser/123456/main-settings', `<input id="MainWebsiteURL"><input id="GlobalClickThroughPage"><input id="ClickAppend">
    <input type="checkbox" id="DeeplinkEnabled"><input type="checkbox" id="NoDomainDeeplink">`,
  `let late = true; document.addEventListener('input', () => {
     if (!late) return; late = false;
     setTimeout(() => { for (const id of ['MainWebsiteURL', 'GlobalClickThroughPage', 'ClickAppend']) document.getElementById(id).value = 'from the server'; }, 20);
   });`);
  const result = await fill(w);
  assert.equal(result.status, 'filled', result.message);
  assert.equal(w.document.getElementById('MainWebsiteURL').value, VALUES.websiteUrl);
  assert.equal(w.document.getElementById('ClickAppend').value, 'source=aw&utm_source=awin&sv1=affiliate&sv_campaign_id=!!!id!!!');
});

test('tracking settings: every "Add to Accepted Domains" prompt under a new address is clicked before saving', async () => {
  const w = awin('/tracking-settings/us/awin/advertiser/123456/main-settings', `<div><input id="MainWebsiteURL"><div class="warn" id="warn1" hidden>⚠ <span class="link">Add to Accepted Domains</span></div></div>
    <div><input id="GlobalClickThroughPage"><div class="warn" id="warn2" hidden>⚠ <span class="link">Add to Accepted Domains</span></div></div>
    <input id="ClickAppend"><input type="checkbox" id="DeeplinkEnabled"><input type="checkbox" id="NoDomainDeeplink"><button id="save">Save</button>`,
  `document.getElementById('MainWebsiteURL').addEventListener('change', () => { document.getElementById('warn1').hidden = false; });
   document.getElementById('GlobalClickThroughPage').addEventListener('change', () => { document.getElementById('warn2').hidden = false; });
   window.accepted = 0;
   document.addEventListener('click', e => { const w = e.target.closest('.warn'); if (w) { w.remove(); window.accepted++; } });
   document.getElementById('save').addEventListener('click', () => { window.savedWith = window.accepted; });`);
  const result = await fill(w, VALUES, true);
  assert.equal(result.status, 'saving', result.message);
  assert.equal(w.accepted, 2);
  assert.equal(result.note, 'Added to Accepted Domains 2 times.');
  await tick(150);
  assert.equal(w.savedWith, 2, 'both were added before Save was clicked');
});

test('commission groups: if the row can\'t be found, the result describes the page (structure only)', async () => {
  const w = awin('/commission-manager/us/awin/merchant/123456/commission-groups', `
    <button type="button" id="add">Add Default Commission Group</button>
    <div class="grid"><span class="h">Transaction Type</span><span class="h">Commission Type</span>
      <div class="cells" id="cells" hidden><input type="text" value="Secret group 98765"><div class="ng-select"></div></div></div>`,
  `document.getElementById('add').addEventListener('click', () => { document.getElementById('cells').hidden = false; });`);
  Object.assign(w.TCASetupFill.T, {quietMax: 200});
  const result = await fill(w);
  assert.equal(result.status, 'failed');
  assert.match(result.diagnostics, /clicked "Add Default Commission Group" \(button\)/);
  assert.match(result.diagnostics, /"Transaction Type" heading: span\.h < div\.grid/);
  assert.match(result.diagnostics, /2 box\(es\) outside any row: input:text in div\.cells < div\.grid \| div\.ng-select in div\.cells < div\.grid/);
  assert.doesNotMatch(result.diagnostics, /Secret|98765/, 'no values');
});

test('a greyed-out Save is fine when the page already shows every value (nothing to save)', async () => {
  const body = `<input id="MainWebsiteURL" value="${VALUES.websiteUrl}"><input id="GlobalClickThroughPage" value="${VALUES.landingPage}">
    <input id="ClickAppend" value="source=aw&amp;utm_source=awin&amp;sv1=affiliate&amp;sv_campaign_id=!!!id!!!">
    <input type="checkbox" id="DeeplinkEnabled" checked><input type="checkbox" id="NoDomainDeeplink" checked><button class="btn btn-disabled" disabled>Save</button>`;
  const w = awin('/tracking-settings/us/awin/advertiser/123456/main-settings', body);
  const result = await fill(w, VALUES, true);
  assert.deepEqual([result.status, result.message], ['saved', 'Already up to date: nothing needed saving.']);
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

test('plugin store: a single-line text box in the plugin menu takes the code, and the result says which box', async () => {
  const w = awin('/advertiser-mastertag/us/awin/123456/plugins', `
    <input type="text" placeholder="Search plugins" class="search">
    <a class="btn" id="add">Add Plugin</a>
    <form class="modal" id="menu" hidden><select><option>Choose…</option><option>R.O.EYE - Consent - SingleView</option></select>
      <label for="snippet">Custom code</label><input type="text" id="snippet"><button type="button" id="save">Save</button></form>`,
  `document.getElementById('add').addEventListener('click', () => { document.getElementById('menu').hidden = false; });`);
  const result = await fill(w);
  assert.equal(result.status, 'filled', result.message);
  assert.equal(w.document.getElementById('snippet').value, 'AWIN.Tracking.RoEye = AWIN.Tracking.RoEye || {};');
  assert.equal(w.document.querySelector('.search').value, '', 'the search box is left alone');
  assert.match(result.message, /Code typed into: single-line text box input#snippet "Custom code"\./);
});

// Commission groups as on Awin: a table with column headings and, once "Add Default Commission Group"
// is clicked, a row of six boxes: three left alone, then Transaction Type, Commission Type, Publisher Commission.
const box = (kind, options = []) => kind === 'text' ? '<input type="text">'
  : `<div class="ng-select" tabindex="0"><div class="ng-value">Choose</div></div><ul class="ng-dropdown" hidden>${options.map(o => `<li role="option" class="ng-option">${o}</li>`).join('')}</ul>`;
function commissionPage({headings = ['Name', 'Description', 'Group code', 'Transaction Type', 'Commission Type', 'Publisher Commission'], add = '<button type="button" id="add">Add Default Commission Group</button>', transaction = ['Sale', 'Lead'], grid = false} = {}) {
  const cells = [box('text'), box('text'), box('text'), box('select', transaction), box('select', ['Fixed', 'Percentage']), box('text')];
  const table = grid
    ? `<div role="grid"><div role="row">${headings.map(h => `<div role="columnheader">${h}</div>`).join('')}</div><div role="row" id="new" hidden>${cells.map(c => `<div role="gridcell">${c}</div>`).join('')}</div></div>`
    : `<table><thead><tr>${headings.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody><tr id="new" hidden>${cells.map(c => `<td>${c}</td>`).join('')}</tr></tbody></table>`;
  return awin('/commission-manager/us/awin/merchant/123456/commission-groups', `${add}${table}<button type="button" onclick="window.saved = true">Save</button>`,
    `${dropdownScript} document.getElementById('add').addEventListener('click', e => { e.preventDefault(); document.getElementById('new').hidden = false; window.added = (window.added || 0) + 1; });`);
}
const rowValues = w => [...w.document.querySelectorAll('#new input[type="text"]')].map(i => i.value).concat([...w.document.querySelectorAll('#new .ng-value')].map(v => v.textContent));

test('commission groups: clicks Add Default Commission Group (even though the headings already show), then fills boxes 4, 5 and 6', async () => {
  const w = commissionPage();
  const result = await fill(w);
  assert.equal(result.status, 'filled', result.message);
  assert.equal(w.added, 1);
  assert.deepEqual(rowValues(w), ['', '', '', '7.5', 'Sale', 'Percentage'], 'boxes 1–3 left alone');
});

test('commission groups: works by position when the headings are named differently, in a grid made of divs, with a "+" link', async () => {
  const w = commissionPage({headings: ['A', 'B', 'C', 'Type', 'Kind', 'Rate'], grid: true, add: '<a href="#" id="add">+ Add Default Commission Group</a>'});
  const result = await fill(w);
  assert.equal(result.status, 'filled', result.message);
  assert.deepEqual(rowValues(w), ['', '', '', '7.5', 'Sale', 'Percentage']);
});

test('a missing option stops the page with a clear message, and nothing is saved', async () => {
  const w = commissionPage({transaction: ['Lead']});
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

test('plugin store: the code goes into a code editor (CodeMirror-style), and is retyped if the page redraws the form', async () => {
  const w = awin('/advertiser-mastertag/us/awin/123456/plugins', `
    <a class="btn btn-sm btn-icon" id="add">Add Plugin</a>
    <div class="modal" id="menu" hidden><select id="pick"><option>Choose…</option><option>R.O.EYE - Consent - SingleView</option></select>
      <div id="config"></div><button type="button" id="save">Save</button></div>`,
  `const draw = () => { document.getElementById('config').innerHTML = '<div class="CodeMirror"><textarea style="position:absolute"></textarea><div class="CodeMirror-code"></div></div>'; };
   document.addEventListener('input', e => { const cm = e.target.closest('.CodeMirror'); if (cm) cm.querySelector('.CodeMirror-code').textContent = e.target.value; });
   document.getElementById('add').addEventListener('click', () => { document.getElementById('menu').hidden = false; });
   // Choosing the plugin draws its settings, then redraws them once a little later (clearing what was typed).
   document.getElementById('pick').addEventListener('change', () => { draw(); setTimeout(draw, 1500); });`);
  const result = await fill(w);
  assert.equal(result.status, 'filled', result.message);
  assert.equal(w.document.querySelector('.CodeMirror-code').textContent, 'AWIN.Tracking.RoEye = AWIN.Tracking.RoEye || {};');
});

test('plugin store: the code goes into the box titled "Set-up", not another box in the menu', async () => {
  const w = awin('/advertiser-mastertag/us/awin/123456/plugins', `
    <a class="btn" id="add">Add Plugin</a>
    <div class="modal" id="menu" hidden><select><option>Choose…</option><option>R.O.EYE - Consent - SingleView</option></select>
      <div class="block"><h4>Set-up</h4><div class="CodeMirror"><textarea></textarea><div class="CodeMirror-code"></div></div></div>
      <div class="block"><h4>Notes</h4><textarea class="notes"></textarea></div>
      <button type="button">Save</button></div>`,
  `document.addEventListener('input', e => { const cm = e.target.closest('.CodeMirror'); if (cm) cm.querySelector('.CodeMirror-code').textContent = e.target.value; });
   document.getElementById('add').addEventListener('click', () => { document.getElementById('menu').hidden = false; });`);
  const result = await fill(w);
  assert.equal(result.status, 'filled', result.message);
  assert.equal(w.document.querySelector('.CodeMirror-code').textContent, 'AWIN.Tracking.RoEye = AWIN.Tracking.RoEye || {};');
  assert.equal(w.document.querySelector('.notes').value, '', 'the other box is left alone');
  assert.match(result.message, /Code typed into: "Set-up" CodeMirror editor/);
});

// A CodeMirror 5-style editor that ignores typing in a background tab (as on Awin): only its own
// setValue changes it. The page's side is simulated by running setEditorInPage in the page.
function unfocusedEditorPage() {
  const w = awin('/advertiser-mastertag/us/awin/123456/plugins', `
    <a class="btn" id="add">Add Plugin</a>
    <div class="modal" id="menu" hidden><select><option>Choose…</option><option>R.O.EYE - Consent - SingleView</option></select>
      <div class="block"><h4>Set-up</h4><div class="CodeMirror" id="cm"><textarea></textarea><div class="CodeMirror-code"></div></div></div>
      <button type="button">Save</button></div>`,
  `document.getElementById('add').addEventListener('click', () => { document.getElementById('menu').hidden = false; });
   const cm = document.getElementById('cm');
   cm.CodeMirror = { value: '', setValue(v) { this.value = v; cm.querySelector('.CodeMirror-code').textContent = v; }, save() {} };`);
  return w;
}

test('plugin store: when the code editor ignores typing, the code is set through the editor itself', async () => {
  const w = unfocusedEditorPage();
  const {context} = runner(() => ({ok: true}));
  const inPage = w.eval(`(${context.TCASetupRunner.setEditorInPage.toString()})`);
  const asked = [];
  w.chrome = {runtime: {sendMessage: async m => { asked.push(m.action); return inPage(m.code); }}};
  const result = await fill(w);
  assert.equal(result.status, 'filled', result.message);
  assert.deepEqual(asked, ['tcaSetupSetEditor']);
  assert.equal(w.document.querySelector('.CodeMirror-code').textContent, 'AWIN.Tracking.RoEye = AWIN.Tracking.RoEye || {};');
  assert.equal(w.document.getElementById('cm').CodeMirror.value, 'AWIN.Tracking.RoEye = AWIN.Tracking.RoEye || {};');
  assert.equal(w.document.querySelector('[data-tca-code-target]'), null, 'the marker is removed afterwards');
  assert.match(result.message, /Code set through the editor \(CodeMirror\) in: "Set-up" CodeMirror editor/);
});

test('plugin store: if the editor can\'t be set either, the page stops before saving and says why', async () => {
  const w = unfocusedEditorPage();
  w.chrome = {runtime: {sendMessage: async () => ({error: 'no editor controls found'})}};
  const result = await fill(w, VALUES, true);
  assert.equal(result.status, 'failed');
  assert.match(result.message, /The plugin code didn't stay in the "Set-up" CodeMirror editor/);
});

test('background: sets an editor from the page side only for Awin pages, in the page\'s own world', async () => {
  const {context} = runner(() => ({ok: true}));
  const listeners = [];
  const calls = [];
  const ctx = vm.createContext({console, setTimeout, clearTimeout, setInterval, clearInterval, URL});
  ctx.chrome = {runtime: {onMessage: {addListener: l => listeners.push(l)}}, scripting: {executeScript: async o => { calls.push(o); return [{result: {editor: 'CodeMirror'}}]; }}};
  vm.runInContext(read('setup/background.js'), ctx);
  const ask = (message, sender) => new Promise(resolve => { for (const l of listeners) if (l(message, sender, resolve) === true) return; resolve('unanswered'); });
  const ok = await ask({action: 'tcaSetupSetEditor', code: 'x'}, {tab: {id: 9}, frameId: 0, url: 'https://ui.awin.com/advertiser-mastertag/us/awin/1/plugins'});
  assert.deepEqual(plain(ok), {editor: 'CodeMirror'});
  assert.equal(calls[0].world, 'MAIN');
  assert.deepEqual(plain(calls[0].target), {tabId: 9, frameIds: [0]});
  assert.deepEqual(plain(calls[0].args), ['x']);
  const refused = await ask({action: 'tcaSetupSetEditor', code: 'x'}, {tab: {id: 9}, url: 'https://example.com/'});
  assert.deepEqual(plain(refused), {error: 'not an Awin page'});
  assert.equal(calls.length, 1);
  void context;
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
  const done = await fill(prejoin(['999']));
  assert.deepEqual([done.status, done.message], ['skipped', 'Already pre-joined: publishers 45628 and 111 have no tick box.']);
  const one = await fill(prejoin(['45628']));
  assert.deepEqual([one.status, one.message], ['failed', 'Publisher 111 not found with a tick box.']);
});

test('after Save, an error on the page is reported as failed', async () => {
  const w = awin('/provider/pre-join-publishers', '<div class="alert alert-danger">Something went wrong, please try again</div>');
  const result = await w.TCASetupFill.verifyPage(VALUES);
  assert.equal(result.status, 'failed');
  assert.match(result.message, /Something went wrong/);
});

// An ag-Grid like Awin's commission groups: headings with col-ids; cells only become editable after
// "Edit Commission Groups", and then open an editor on double-click: a popup list for the two
// dropdown columns, an inline box for Publisher Commission (Enter commits).
function agGridPage({add = false, rows = 1, commitKey = 'Enter', till = false} = {}) {
  const cols = [['name', 'Name'], ['desc', 'Description'], ['code', 'Group code'], ['txn', 'Transaction Type'], ['type', 'Commission Type'], ['rate', 'Publisher Commission']];
  const row = i => `<div class="ag-row" role="row" row-index="${i}">${cols.map(([id], c) => `<div class="ag-cell" role="gridcell" col-id="${id}" aria-colindex="${c + 1}">${id === 'name' ? 'Default' : ''}</div>`).join('')}</div>`;
  return awin('/commission-manager/us/awin/merchant/123456/commission-groups', `
    ${add ? '<button type="button" class="btn btn-add" id="add">Add Default Commission Group</button>' : '<button type="button" class="btn btn-add" id="edit">Edit Commission Groups</button>'}
    <div class="ag-root-wrapper"><div class="ag-root">
      <div class="ag-header-row" role="row">${cols.map(([id, t]) => `<div class="ag-header-cell" role="columnheader" col-id="${id}"><span class="ag-header-cell-text">${t}</span></div>`).join('')}</div>
      <div class="ag-center-cols-container" id="body">${Array.from({length: add ? 0 : rows}, (_, i) => row(i)).join('')}</div>
    </div></div><button type="button" onclick="window.saved = true">Save</button>`,
  `window.editable = false; const options = {txn: ['Sale', 'Lead'], type: ['Fixed', 'Percentage']};
   const editBtn = document.getElementById('edit'); if (editBtn) editBtn.addEventListener('click', () => { window.editable = true; });
   const addBtn = document.getElementById('add'); if (addBtn) addBtn.addEventListener('click', () => { window.editable = true; document.getElementById('body').insertAdjacentHTML('beforeend', ${JSON.stringify(row(0))}); });
   document.addEventListener('dblclick', e => {
     const cell = e.target.closest('.ag-cell'); if (!cell || !window.editable) return;
     const id = cell.getAttribute('col-id');
     if (options[id]) {
       cell.classList.add('ag-cell-popup-editing');
       document.body.insertAdjacentHTML('beforeend', '<div class="ag-popup-editor">' + options[id].map(o => '<div class="ag-list-item">' + o + '</div>').join('') + '</div>');
       document.querySelector('.ag-popup-editor').addEventListener('click', ev => { const item = ev.target.closest('.ag-list-item'); if (!item) return; cell.textContent = item.textContent; cell.classList.remove('ag-cell-popup-editing'); ev.currentTarget.remove(); });
     } else if (id === 'rate') {
       cell.classList.add('ag-cell-inline-editing'); cell.innerHTML = '<input type="text" class="ag-input-field-input">';
       // Awin's box fills in from the right like a till: the digits typed, divided by 100, as a percentage.
       if (${till}) cell.querySelector('input').addEventListener('input', ev => { const d = ev.target.value.replace(/\D/g, ''); ev.target.value = d ? (d / 100).toFixed(2) + '%' : ''; });
       cell.querySelector('input').addEventListener('keydown', ev => { if (ev.key === ${JSON.stringify(commitKey)}) { const v = ev.target.value.replace(/%$/, ''); cell.classList.remove('ag-cell-inline-editing'); cell.textContent = v + '%'; } });
     }
   });`);
}
const agValues = w => ['txn', 'type', 'rate'].map(id => w.document.querySelector(`.ag-row .ag-cell[col-id="${id}"]`).textContent);

test('commission groups (ag-Grid): Edit Commission Groups, then each cell is opened, filled and committed', async () => {
  const w = agGridPage();
  const result = await fill(w);
  assert.equal(result.status, 'filled', result.message);
  assert.deepEqual(agValues(w), ['Sale', 'Percentage', '7.50%']);
  assert.match(result.message, /Transaction Type set to "Sale", Commission Type set to "Percentage", Publisher commission set to "7\.5"/);
  assert.deepEqual([...w.document.querySelectorAll('.ag-cell')].slice(0, 3).map(c => c.textContent), ['Default', '', ''], 'the first three cells are left alone');
});

test('commission groups (ag-Grid): on a new programme, Add Default Commission Group adds the row that is filled', async () => {
  const w = agGridPage({add: true});
  const result = await fill(w);
  assert.equal(result.status, 'filled', result.message);
  assert.deepEqual(agValues(w), ['Sale', 'Percentage', '7.50%']);
});

test('commission groups (ag-Grid): if the cells already show these values, there is nothing to save, and that is not a failure', async () => {
  const w = agGridPage();
  for (const [id, v] of [['txn', 'Sale'], ['type', 'Percentage'], ['rate', '7.50%']]) w.document.querySelector(`.ag-cell[col-id="${id}"]`).textContent = v;
  const result = await fill(w, VALUES, true);
  assert.deepEqual([result.status, result.message], ['skipped', 'Already set to these values: nothing to save.']);
});

test('tracking tag settings: no confirmation after Save, but no error either, counts as saved', async () => {
  const w = awin('/advertiser-mastertag/us/awin/123456/trackingtagsettings', '<p>Saved settings page</p>');
  assert.equal((await w.TCASetupFill.verifyPage(VALUES)).status, 'saved');
});

test('commission groups (ag-Grid): a till-style number box (5 → 0.05%) is given 5.00 so it holds 5%', async () => {
  const w = agGridPage({till: true});
  const result = await fill(w, {...VALUES, publisherCommission: '5'});
  assert.equal(result.status, 'filled', result.message);
  assert.equal(agValues(w)[2], '5.00%');
  assert.match(result.message, /Publisher commission set to "5" \(Enter\)/);
});

test('commission groups (ag-Grid): if Enter doesn\'t finish the edit, Tab is tried', async () => {
  const w = agGridPage({commitKey: 'Tab'});
  const result = await fill(w);
  assert.equal(result.status, 'filled', result.message);
  assert.equal(agValues(w)[2], '7.50%');
  assert.match(result.message, /Publisher commission set to "7\.5" \(Tab\)/);
});

test('commission groups (ag-Grid): if no way of finishing the edit works, the report says what each try left', async () => {
  const w = agGridPage({commitKey: 'none'});
  Object.assign(w.TCASetupFill.T, {quietMax: 200});
  const result = await fill(w);
  assert.equal(result.status, 'failed');
  assert.match(result.message, /"Publisher commission" doesn't show "7\.5"/);
  assert.match(result.diagnostics, /Publisher commission: Enter in input\.ag-input-field-input\[type=text\] \(box held "7\.50"\): cell shows ""; Tab in /);
});

test('Awin\'s OIDC sign-in callbacks count as sign-in pages, so the run waits for them', async () => {
  for (const path of ['/tracking-settings/en/awin/oidc', '/advertiser-mastertag/en/awin/oidc', '/backend/idpbackend/authorize']) {
    assert.equal((await fill(awin(path, ''))).status, 'signin', path);
  }
});

// ---------- Background runner ----------

function runner(answers) {
  const sent = [];
  const created = [];
  const context = vm.createContext({console, setTimeout, clearTimeout, setInterval, clearInterval, URL});
  const listeners = [];
  context.chrome = {
    runtime: {onMessage: {addListener: l => listeners.push(l)}},
    tabs: {
      create: async o => { const tab = {id: 100 + created.length, ...o}; created.push(tab); return tab; },
      get: async id => ({id, status: 'complete'}),
      group: async () => 1,
      reload: async id => { context.reloaded.push(id); },
      sendMessage: async (tabId, m) => { sent.push([tabId, m.action, m.symbol || m.status || m.index]); return answers(tabId - 100, m); },
      onUpdated: {addListener: () => {}, removeListener: () => {}}
    },
    tabGroups: {update: async () => {}},
    notifications: {create: (id, o) => { context.notified = o; }}
  };
  context.usage = [];
  context.reloaded = [];
  context.TCAUsageWorker = {add: e => context.usage.push(e)};
  vm.runInContext('const NI_URLS = mid => Array.from({length: 10}, (_, i) => `https://ui.awin.com/page${i}/${mid}`);', context);
  vm.runInContext(read('setup/background.js'), context);
  Object.assign(context.TCASetupRunner.T, {settle: 1, reloadStart: 5, answer: 50, retryWait: 1, reloadDelay: 1, signinWaits: 4});
  const start = message => new Promise(resolve => { for (const l of listeners) l(message, {tab: {id: 7}}, resolve); });
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
  assert.deepEqual(plain(context.reloaded), [104], 'Tracking tag settings (page 5) is reloaded before filling, and only it');
  assert.ok(created.every(t => t.active === false), 'tabs open in the background');
  const order = sent.filter(([, action]) => action === 'tcaSetupFill').map(([tab]) => tab);
  assert.deepEqual(order, [100, 102, 103, 104, 105, 107, 108, 109, 109, 109], 'one page at a time; pre-filled pages not touched; pre-join tried 3 times');
  const progress = sent.filter(([, action]) => action === 'tcaSetupProgress');
  assert.ok(progress.length >= 21 && progress.every(([tab]) => tab === 7), 'progress (working + result per page, then done) goes to the record tab');
  const marks = sent.filter(([, action]) => action === 'tcaSetupMark').map(([tab, , symbol]) => [tab, symbol]);
  assert.deepEqual(marks.map(m => m[1]), ['✓', '⏭', '⚠', '✓', '✓', '✓', '⏭', '✓', '✓', '✓']);
  assert.match(context.notified.title, /Setup for MID 123456: needs a look/);
  assert.match(context.notified.message, /7 saved, 2 skipped, 1 need a look/);
  assert.match(context.notified.message, /Commission groups: "Transaction Type" not found/);
  assert.deepEqual(plain(context.usage), [{tool: 'New Implementation', action: 'setup', outcome: 'failed', reason: 'setup-page-failed', tc: 'Alex Mock-Person'}]);
});

test('runner: tabs open one at a time, and a page still on Awin\'s sign-in redirect is waited for', async () => {
  const signin = {2: 2, 3: 99};   // page 3 comes back after 2 sign-in answers; page 4 never does (needs a login)
  const openedBeforeFill = [];
  let created;
  const r = runner((index, m) => {
    if (m.action === 'tcaSetupFill') {
      openedBeforeFill.push([index, created.length]);
      if (signin[index] > 0) { signin[index]--; return {status: 'signin', message: 'Awin\'s sign-in page is showing.', login: index === 3}; }
      return {status: 'filled', message: 'Filled.'};
    }
    return {ok: true};
  });
  created = r.created;
  await r.start({action: 'tcaSetupRun', mid: '1', values: {...VALUES, platformOffer: 'Advanced'}, save: false});
  for (let i = 0; i < 300 && !r.context.notified; i++) await tick(10);
  assert.ok(openedBeforeFill.every(([index, n]) => n <= index + 2), 'never more than one page opened ahead of the one being filled');
  assert.equal(openedBeforeFill.filter(([index]) => index === 2).length, 3, 'asked again after each sign-in redirect');
  assert.match(r.context.notified.message, /Plugin store: Awin asked to sign in again in this tab/);
  assert.match(r.context.notified.message, /7 filled \(not saved\), 2 skipped, 1 need a look/);
});

test('runner: a page that never answers is given up on after the time limit, and the run carries on', async () => {
  const r = runner((index, m) => {
    if (m.action === 'tcaSetupFill') return index === 8 ? new Promise(() => {}) : {status: 'filled', message: 'Filled.'};
    return {ok: true};
  });
  r.context.TCASetupRunner.T.pageLimit = 50;
  await r.start({action: 'tcaSetupRun', mid: '1', values: VALUES, save: false});
  for (let i = 0; i < 300 && !r.context.notified; i++) await tick(10);
  assert.match(r.context.notified.message, /Advertiser settings: No result after 0 s\. If your Awin session has expired, sign in/);
  assert.equal(r.created.length, 10, 'the last page was still done');
});

test('runner: for Access, the Plugin store page is skipped without being touched', async () => {
  const asked = [];
  const r = runner((index, m) => { if (m.action === 'tcaSetupFill') { asked.push(index); return {status: 'filled', message: 'Filled.'}; } return {ok: true}; });
  await r.start({action: 'tcaSetupRun', mid: '1', values: {...VALUES, platformOffer: 'Access'}, save: false});
  for (let i = 0; i < 300 && !r.context.notified; i++) await tick(10);
  assert.deepEqual(asked, [0, 2, 4, 5, 7, 8, 9]);
  assert.match(r.context.notified.message, /7 filled \(not saved\), 3 skipped/);
});

test('runner: keeps the background script awake during a run, and stops afterwards', async () => {
  const r = runner((index, m) => (m.action === 'tcaSetupFill' ? new Promise(res => setTimeout(() => res({status: 'filled', message: 'Filled.'}), 30)) : {ok: true}));
  let pings = 0;
  r.context.chrome.runtime.getPlatformInfo = async () => { pings++; };
  r.context.TCASetupRunner.T.keepAlive = 20;
  await r.start({action: 'tcaSetupRun', mid: '1', values: VALUES, save: false});
  for (let i = 0; i < 300 && !r.context.notified; i++) await tick(10);
  const during = pings;
  await tick(100);
  assert.ok(during >= 3, `pinged ${during} times`);
  assert.equal(pings, during, 'no more pings after the run');
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

async function record(chrome, scenario = 'success') {
  const path = 'dev/mock/lightning-record.html';
  const dom = await JSDOM.fromFile(fileURLToPath(new URL(path, root)), {url: new URL(`${path}?scenario=${scenario}`, root).href, runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true});
  await new Promise(resolve => dom.window.addEventListener('load', resolve));
  const {window} = dom;
  window.chrome = chrome;
  for (const f of ['fields.js', 'config.js', 'settings.js', 'templates.js', 'engine.js', 'setup/form.js']) window.eval(read(f));
  return window;
}
function fakeChrome(site = () => ({error: 'permission'}), session = () => ({signedIn: true})) {
  const chrome = {
    messages: [], local: {},
    runtime: {sendMessage: async m => { chrome.messages.push(m); return m.action === 'tcaReadSite' ? site(m) : m.action === 'tcaSetupCheckSession' ? session(m) : {ok: true}; }, onMessage: {addListener: l => { chrome.listener = l; }}},
    storage: {local: {get: async k => ({[k]: chrome.local[k]}), set: async o => Object.assign(chrome.local, o)}}
  };
  return chrome;
}
const formRoot = window => window.document.getElementById('tca-setup-form').shadowRoot;

test('form: 🚀 reads everything from the record and only asks about saving (Moonfill\'s own click doesn\'t run)', async () => {
  const chrome = fakeChrome();
  const window = await record(chrome);
  window.document.querySelector('button.mf-impl').click();
  await tick(30);
  assert.equal(window.moonfillNIClicks, undefined, "Moonfill's own click handler didn't run");
  const ui = formRoot(window);
  assert.equal(ui.querySelector('.backdrop').hidden, false);
  assert.equal(ui.querySelector('form.manual').hidden, true, 'no form to fill in');
  assert.equal(ui.querySelector('.warn').hidden, true, 'nothing missing from the record');
  assert.equal(ui.querySelector('.mid').textContent, 'MID 123456 · Access');
  assert.deepEqual([...ui.querySelectorAll('.ask .row button')].map(b => b.textContent), ['Just open the tabs', 'Cancel', 'Fill only', 'Run and save']);
  assert.equal(ui.querySelector('.session-text').textContent, 'Signed in to Awin ✓');
  assert.equal(ui.querySelector('.run').disabled, false);
  assert.deepEqual(plain(window.TCASetupForm.readRecord()), {missing: [], core: false, note: '', values: {
    websiteUrl: 'https://shop.example.com/', landingPage: 'https://shop.example.com/', platformOffer: 'Access',
    transactionType: 'Sale', commissionType: 'Percentage', publisherCommission: '5',
    approval: 'Manual Approval', validationDays: '30', assignedTc: 'Alex Mock-Person'}});
});

test('form: Run and save starts the run with the record\'s values; Fill only starts it without saving', async () => {
  const chrome = fakeChrome();
  const window = await record(chrome, 'advanced');
  await window.TCASetupForm.open();
  const ui = formRoot(window);
  ui.querySelector('.run').click();
  await tick(30);
  const run = chrome.messages.find(m => m.action === 'tcaSetupRun');
  assert.equal(run.save, true);
  assert.equal(run.mid, '123456');
  assert.equal(run.values.platformOffer, 'Advanced');
  assert.equal(ui.querySelector('.progress').hidden, false);
  assert.equal(ui.querySelector('.ask').hidden, true);

  await window.TCASetupForm.open();
  ui.querySelector('.fill-only').click();
  await tick(30);
  assert.equal(chrome.messages.filter(m => m.action === 'tcaSetupRun').at(-1).save, false);
});

async function singleViewNote(ui) {
  for (let i = 0; i < 300; i++) {
    const text = ui.querySelector('.sv').textContent;
    if (/^[✓✎⚠]/.test(text)) return text;
    await tick(20);
  }
  throw new Error(`SingleView note never finished: "${ui.querySelector('.sv').textContent}"`);
}
const sv = (window, label) => window.mockRecord[`SV::${label}`];

test('form: for Advanced, Run and save sets and saves SingleView Setup on the record as the setup starts', async () => {
  const chrome = fakeChrome();
  const window = await record(chrome, 'advanced');
  await window.TCASetupForm.open();
  const ui = formRoot(window);
  const checklist = () => JSON.stringify(Object.entries(window.mockRecord).filter(([k]) => !k.startsWith('SV::')));
  const before = checklist();
  ui.querySelector('.run').click();
  const note = await singleViewNote(ui);
  assert.equal(note, '✓ SingleView Setup saved on the record (MasterTag Enabled, New).');
  assert.equal(sv(window, 'SingleView Setup Type'), 'MasterTag Enabled');
  assert.equal(sv(window, 'SingleView Integration Status'), 'New');
  assert.ok(chrome.messages.some(m => m.action === 'tcaSetupRun'), 'the setup pages still run');
  assert.equal(checklist(), before, 'nothing else on the record is changed');
});

test('form: for Advanced, Fill only fills SingleView Setup without saving it', async () => {
  const window = await record(fakeChrome(), 'advanced');
  await window.TCASetupForm.open();
  const ui = formRoot(window);
  ui.querySelector('.fill-only').click();
  assert.match(await singleViewNote(ui), /^✎ SingleView Setup filled on the record, not saved/);
  assert.ok(!sv(window, 'SingleView Setup Type'), 'nothing saved');
});

test('form: for Access, SingleView Setup is left alone', async () => {
  const window = await record(fakeChrome());
  await window.TCASetupForm.open();
  const ui = formRoot(window);
  ui.querySelector('.run').click();
  await tick(300);
  assert.equal(ui.querySelector('.sv').textContent, '');
  assert.ok(!sv(window, 'SingleView Setup Type'));
});

test('form: a non-Percentage commission is left for the TC; a missing amount is flagged', async () => {
  const fixed = await record(fakeChrome(), 'fixed');
  const v = fixed.TCASetupForm.readRecord().values;
  assert.equal(v.commissionSkip, 'Commission type is "Fixed": set the commission group by hand');
  assert.equal(v.transactionType, undefined);
  const empty = await record(fakeChrome(), 'no-amount');
  assert.match(empty.TCASetupForm.readRecord().values.commissionProblem, /"Commission Amount" is empty on the record/);
});

test('form: the progress bar fills as pages finish; the red ✕ cancels; the end shows the summary', async () => {
  const chrome = fakeChrome();
  const window = await record(chrome);
  await window.TCASetupForm.open();
  const ui = formRoot(window);
  ui.querySelector('.run').click();
  await tick(30);
  chrome.listener({action: 'tcaSetupProgress', index: 0, status: 'working'});
  assert.match(ui.querySelector('.current').textContent, /^Tracking settings…/);
  chrome.listener({action: 'tcaSetupProgress', index: 0, status: 'saved'});
  chrome.listener({action: 'tcaSetupProgress', index: 1, status: 'skipped', message: 'Skipped: comes pre-filled.'});
  assert.equal(ui.querySelector('.count').textContent, '2 / 10');
  assert.equal(ui.querySelector('.fill').style.width, '20%');
  const stop = ui.querySelector('.stop');
  assert.equal(stop.textContent, '✕');
  stop.click();
  await tick();
  assert.equal(chrome.messages.at(-1).action, 'tcaSetupCancel');
  assert.match(ui.querySelector('.current').textContent, /Cancelling/);
  chrome.listener({action: 'tcaSetupProgress', done: true, cancelled: true, summary: '1 saved, 1 skipped, 8 not started'});
  assert.equal(ui.querySelector('.current').textContent, 'Cancelled: 1 saved, 1 skipped, 8 not started.');
  assert.equal(ui.querySelector('.stop').hidden, true);
  assert.equal(ui.querySelector('.close').textContent, 'Close');
});

test('form: Hide leaves a small box above the panel; clicking it brings back the full box as it was', async () => {
  const chrome = fakeChrome();
  const window = await record(chrome);
  await window.TCASetupForm.open();
  const ui = formRoot(window);
  ui.querySelector('.run').click();
  await tick(30);
  chrome.listener({action: 'tcaSetupProgress', index: 0, status: 'saved'});
  chrome.listener({action: 'tcaSetupProgress', index: 1, status: 'skipped', message: 'Skipped: comes pre-filled.'});
  chrome.listener({action: 'tcaSetupProgress', index: 2, status: 'working'});
  const mini = ui.querySelector('.mini');
  assert.equal(mini.hidden, true, 'not shown while the full box is open');

  ui.querySelector('.close').click();                       // Hide
  assert.equal(ui.querySelector('.backdrop').hidden, true);
  assert.equal(mini.hidden, false, 'the small box stays on screen');
  assert.match(mini.querySelector('.label').textContent, /Setup: Commission groups…/);
  assert.equal(mini.querySelector('.mini-count').textContent, '2 / 10');
  chrome.listener({action: 'tcaSetupProgress', index: 2, status: 'saved'});
  assert.equal(mini.querySelector('.mini-count').textContent, '3 / 10', 'it keeps updating');

  mini.click();                                             // back to the full box, as it was
  assert.equal(mini.hidden, true);
  assert.equal(ui.querySelector('.backdrop').hidden, false);
  assert.equal(ui.querySelector('.progress').hidden, false);
  assert.equal(ui.querySelector('.ask').hidden, true);
  assert.equal(ui.querySelector('.count').textContent, '3 / 10');
  assert.deepEqual([...ui.querySelectorAll('li')].slice(0, 3).map(li => li.dataset.status), ['saved', 'skipped', 'saved']);

  ui.querySelector('.close').click();
  chrome.listener({action: 'tcaSetupProgress', done: true, summary: '8 saved, 2 skipped', needsLook: 0});
  assert.equal(mini.hidden, false, 'the result stays until dismissed');
  assert.match(mini.querySelector('.label').textContent, /Setup finished: 8 saved, 2 skipped/);
  assert.equal(mini.querySelector('.mini-stop').hidden, true);
  mini.querySelector('.dismiss').click();
  assert.equal(mini.hidden, true);
  assert.equal(ui.querySelector('.backdrop').hidden, true, 'dismissing doesn\'t reopen the box');
  window.close();
});

test('form: the pixel runner runs along the bar, then cheers (8+ worked), gives a thumbs up (3-7) or is sad (under 3)', async () => {
  const ending = async done => {
    const chrome = fakeChrome();
    chrome.runtime.getURL = path => `chrome-extension://test/${path}`;
    const window = await record(chrome);
    await window.TCASetupForm.open();
    const ui = formRoot(window);
    ui.querySelector('.run').click();
    await tick(30);
    const img = ui.querySelector('.progress .runner');
    const mini = ui.querySelector('.mini .runner');
    assert.equal(img.hidden, false);
    assert.equal(img.getAttribute('src'), 'chrome-extension://test/assets/runner.gif', 'running while it works');
    assert.equal(mini.getAttribute('src'), 'chrome-extension://test/assets/runner.gif', 'on the small box too');
    chrome.listener({action: 'tcaSetupProgress', index: 4, status: 'saved'});
    assert.match(img.style.left, /50%/, 'at the front of the bar (5 of 10)');
    chrome.listener({action: 'tcaSetupProgress', done: true, summary: 'x', ...done});
    const src = img.getAttribute('src');
    window.close();
    return src.replace('chrome-extension://test/assets/', '');
  };
  assert.equal(await ending({needsLook: 0}), 'runner-cheer.gif', '10 worked');
  assert.equal(await ending({needsLook: 2}), 'runner-cheer.gif', '8 worked');
  assert.equal(await ending({needsLook: 3}), 'runner-thumbs.gif', '7 worked');
  assert.equal(await ending({needsLook: 7}), 'runner-thumbs.gif', '3 worked');
  assert.equal(await ending({needsLook: 8}), 'runner-sad.gif', '2 worked');
  assert.equal(await ending({cancelled: true}), 'runner-stand.gif');
});

test('form: the small box\'s ✕ cancels the run', async () => {
  const chrome = fakeChrome();
  const window = await record(chrome);
  await window.TCASetupForm.open();
  const ui = formRoot(window);
  ui.querySelector('.run').click();
  await tick(30);
  ui.querySelector('.close').click();
  ui.querySelector('.mini-stop').click();
  await tick();
  assert.equal(chrome.messages.at(-1).action, 'tcaSetupCancel');
  assert.match(ui.querySelector('.mini .label').textContent, /Cancelling after this page/);
  assert.equal(ui.querySelector('.backdrop').hidden, true, 'cancelling from the small box doesn\'t reopen the full one');
  window.close();
});

test('form: signed out of Awin, the run can\'t start; Check again unlocks it once signed in', async () => {
  let signedIn = false;
  const chrome = fakeChrome(undefined, () => ({signedIn}));
  const window = await record(chrome);
  await window.TCASetupForm.open();
  const ui = formRoot(window);
  assert.match(ui.querySelector('.session-text').textContent, /not signed in to Awin/);
  assert.equal(ui.querySelector('.session-actions').hidden, false);
  assert.equal(ui.querySelector('.run').disabled, true);
  assert.equal(ui.querySelector('.fill-only').disabled, true);
  signedIn = true;
  ui.querySelector('.recheck').click();
  await tick(30);
  assert.equal(ui.querySelector('.session-text').textContent, 'Signed in to Awin ✓');
  assert.equal(ui.querySelector('.run').disabled, false);
  assert.equal(chrome.messages.filter(m => m.action === 'tcaSetupCheckSession').length, 2);
});

test('form: if the sign-in can\'t be checked, the run is still allowed and says so', async () => {
  const window = await record(fakeChrome(undefined, () => ({signedIn: null, detail: 'Failed to fetch'})));
  await window.TCASetupForm.open();
  const ui = formRoot(window);
  assert.match(ui.querySelector('.session-text').textContent, /Couldn't check the Awin sign-in \(Failed to fetch\)/);
  assert.equal(ui.querySelector('.run').disabled, false);
});

test('form: a missing marketing checklist value is warned about, with the details-by-hand form as a way round', async () => {
  const chrome = fakeChrome();
  const window = await record(chrome, 'no-amount');
  await window.TCASetupForm.open();
  const ui = formRoot(window);
  assert.equal(ui.querySelector('.warn').hidden, false);
  assert.match(ui.querySelector('.warn-text').textContent, /missing details the setup needs:\n• Commission Amount\nThe pages that need them will be flagged, or enter them by hand\./);
  assert.equal(ui.querySelector('.run').disabled, false, 'other pages can still run');

  ui.querySelector('.manual-open').click();
  const f = ui.querySelector('form.manual').elements;
  assert.equal(ui.querySelector('form.manual').hidden, false);
  assert.deepEqual([f.websiteUrl.value, f.landingPage.value, f.platformOffer.value, f.approval.value, f.validationDays.value], ['https://shop.example.com/', 'https://shop.example.com/', 'Access', 'Manual Approval', '30'], 'what the record had is filled in');
  ui.querySelector('.manual-run').click();
  await tick();
  assert.match(ui.querySelector('.manual-error').textContent, /Please fill in: Transaction Type, Commission Type, Publisher commission/);
  f.transactionType.value = 'Lead'; f.commissionType.value = 'Fixed'; f.publisherCommission.value = '£2.50';
  ui.querySelector('.manual-run').click();
  await tick(30);
  const run = chrome.messages.find(m => m.action === 'tcaSetupRun');
  assert.equal(run.save, true);
  assert.deepEqual([run.values.transactionType, run.values.commissionType, run.values.publisherCommission, run.values.commissionProblem], ['Lead', 'Fixed', '2.50', undefined]);
  assert.equal(ui.querySelector('.progress').hidden, false);
});

test('form: without a Landing Page URL or Platform Offer, only the details-by-hand form can run it', async () => {
  const window = await record(fakeChrome(), 'no-landing');
  await window.TCASetupForm.open();
  const ui = formRoot(window);
  assert.match(ui.querySelector('.warn-text').textContent, /• Landing Page URL\n• Platform Offer[\s\S]*can run with them entered by hand/);
  assert.equal(ui.querySelector('.run').disabled, true);
  assert.equal(ui.querySelector('.manual-open').disabled, false);
  ui.querySelector('.manual-open').click();
  assert.equal(ui.querySelector('.manual-run').disabled, false);
  ui.querySelector('.back').click();
  assert.equal(ui.querySelector('.ask').hidden, false);
});

test('form: a non-Percentage commission type is mentioned, with the by-hand form offered', async () => {
  const window = await record(fakeChrome(), 'fixed');
  await window.TCASetupForm.open();
  const ui = formRoot(window);
  assert.equal(ui.querySelector('.warn').hidden, false);
  assert.match(ui.querySelector('.warn-text').textContent, /Commission type is "Fixed", so the commission group will be left for you \(or enter it by hand\)\./);
  assert.equal(ui.querySelector('.run').disabled, false);
});

test('background: the Awin sign-in check reads where a classic page ends up', async () => {
  const run = async answer => {
    const ctx = vm.createContext({console, setTimeout, clearTimeout, setInterval, clearInterval, URL});
    ctx.chrome = {runtime: {onMessage: {addListener: () => {}}}};
    ctx.fetch = async (url, o) => { ctx.asked = [url, o.credentials]; if (answer instanceof Error) throw answer; return answer; };
    vm.runInContext(read('setup/background.js'), ctx);
    return {result: plain(await ctx.TCASetupRunner.checkSession('123456')), asked: plain(ctx.asked)};
  };
  const ok = await run({ok: true, status: 200, url: 'https://ui.awin.com/provider/migrated-advertiser-settings/123456'});
  assert.deepEqual(ok.result, {signedIn: true});
  assert.deepEqual(ok.asked, ['https://ui.awin.com/provider/migrated-advertiser-settings/123456', 'include']);
  assert.equal((await run({ok: true, status: 200, url: 'https://ui.awin.com/idp/en/awin/login/prelogin'})).result.signedIn, false);
  assert.equal((await run({ok: true, status: 200, url: 'https://id.awin.com/authorize?x'})).result.signedIn, false);
  assert.deepEqual((await run(new Error('Failed to fetch'))).result, {signedIn: null, detail: 'Failed to fetch'});
});

test('form: a MID of 0, or a record without a Landing Page URL, can\'t be run', async () => {
  const chrome = fakeChrome();
  const window = await record(chrome);
  window.document.querySelector('a[href*="ui.awin.com/dashboard/awin/advertiser/"]').setAttribute('href', 'https://ui.awin.com/dashboard/awin/advertiser/0');
  await window.TCASetupForm.open();
  const ui = formRoot(window);
  assert.match(ui.querySelector('.error').textContent, /hasn't been created in Awin yet \(the MID is 0\)/);
  assert.equal(ui.querySelector('.run').disabled, true);
  assert.equal(ui.querySelector('.fill-only').disabled, true);
  assert.equal(ui.querySelector('.tabs-only').disabled, true);
  ui.querySelector('.run').click();
  await tick();
  assert.equal(chrome.messages.filter(m => m.action === 'tcaSetupRun').length, 0);

  const noLanding = await record(fakeChrome(), 'no-landing');
  await noLanding.TCASetupForm.open();
  assert.match(formRoot(noLanding).querySelector('.warn-text').textContent, /Landing Page URL[\s\S]*Platform Offer/);
  assert.equal(formRoot(noLanding).querySelector('.run').disabled, true);

  const {start, created} = runner(() => ({ok: true}));
  assert.deepEqual(plain(await start({action: 'tcaSetupRun', mid: '0', values: VALUES})), {ok: false, error: "the MID is 0: the advertiser hasn't been created in Awin yet."});
  assert.equal(created.length, 0, 'no tabs opened');
});

test('form: Shopify stores get their myshopify address as the Website URL', async () => {
  const chrome = fakeChrome(() => ({ok: true, status: 200, text: '<script>Shopify.shop = "fictional-shop.myshopify.com";</script> cdn.shopify.com'}));
  const window = await record(chrome);
  await window.TCASetupForm.open();
  formRoot(window).querySelector('.run').click();
  await tick(50);
  const run = chrome.messages.find(m => m.action === 'tcaSetupRun');
  assert.equal(run.values.websiteUrl, 'https://fictional-shop.myshopify.com');
  assert.equal(run.values.landingPage, 'https://shop.example.com/');
});

test('form: Just open the tabs is Moonfill\'s old behaviour', async () => {
  const chrome = fakeChrome();
  const window = await record(chrome);
  await window.TCASetupForm.open();
  formRoot(window).querySelector('.tabs-only').click();
  await tick();
  assert.deepEqual(plain(chrome.messages.at(-1)), {action: 'createNITabs', mid: '123456'});
});

// ---------- Advertiser settings (page 9) and commission rules ----------

const advertiserPage = days => awin('/provider/migrated-advertiser-settings/123456', `
  <label for="a1">Approval of Publishers Joining</label><select id="a1"><option value="0">Manual Approval</option><option value="1" selected>Auto Approval</option></select>
  <label for="d1">Validation Period Days</label><input type="number" id="d1" value="${days}"><button id="migrated_advertiser_settings_save">Save</button>`);

test('advertiser settings: Manual Approval always; Validation Period Days from the record\'s Auto validation period', async () => {
  const w = advertiserPage('45');
  const result = await fill(w, {...VALUES, platformOffer: 'Advanced', approval: 'Manual Approval', validationDays: '30'});
  assert.equal(result.status, 'filled', result.message);
  assert.deepEqual([w.document.getElementById('a1').value, w.document.getElementById('d1').value], ['0', '30']);
});

test('advertiser settings, Access: a set Validation Period Days is left; empty or -1 becomes the period + 7', async () => {
  const access = {...VALUES, platformOffer: 'Access', approval: 'Manual Approval', validationDays: '30'};
  let w = advertiserPage('60');
  let result = await fill(w, access);
  assert.equal(w.document.getElementById('d1').value, '60');
  assert.match(result.message, /already set \(60\): left as it is/);
  assert.equal(w.document.getElementById('a1').value, '0', 'approval still set to Manual');
  for (const unset of ['', '-1']) {
    w = advertiserPage(unset);
    result = await fill(w, access);
    assert.equal(w.document.getElementById('d1').value, '37', `"${unset}" → 30 + 7`);
    assert.match(result.message, /was empty: set to 30 \+ 7 = 37/);
    assert.equal((await w.TCASetupFill.verifyPage(access)).status, 'saved');
  }
});

test('runner: a non-Percentage commission skips page 3 without touching it; a missing amount flags it', async () => {
  const asked = [];
  const r = runner((index, m) => { if (m.action === 'tcaSetupFill') { asked.push(index); return {status: 'filled', message: 'Filled.'}; } return {ok: true}; });
  const values = {...VALUES, platformOffer: 'Advanced', transactionType: undefined, commissionSkip: 'Commission type is "Fixed": set the commission group by hand'};
  await r.start({action: 'tcaSetupRun', mid: '1', values, save: false});
  for (let i = 0; i < 300 && !r.context.notified; i++) await tick(10);
  assert.ok(!asked.includes(2));
  assert.match(r.context.notified.message, /3 skipped/);

  const r2 = runner((index, m) => (m.action === 'tcaSetupFill' ? {status: 'filled', message: 'Filled.'} : {ok: true}));
  await r2.start({action: 'tcaSetupRun', mid: '1', values: {...VALUES, commissionProblem: '"Commission Amount" is empty on the record, so the commission group wasn\'t set.'}, save: false});
  for (let i = 0; i < 300 && !r2.context.notified; i++) await tick(10);
  assert.match(r2.context.notified.message, /Commission groups: "Commission Amount" is empty on the record/);
});

test('runner: cancelling finishes the page being filled, then stops; the rest aren\'t started', async () => {
  let listenersRef;
  const r = runner((index, m) => {
    if (m.action === 'tcaSetupFill' && index === 2) { listenersRef(); return new Promise(res => setTimeout(() => res({status: 'filled', message: 'Filled.'}), 30)); }
    return m.action === 'tcaSetupFill' ? {status: 'filled', message: 'Filled.'} : {ok: true};
  });
  listenersRef = () => r.start({action: 'tcaSetupCancel'});
  await r.start({action: 'tcaSetupRun', mid: '1', values: {...VALUES, platformOffer: 'Advanced'}, save: false});
  for (let i = 0; i < 300 && !r.context.notified; i++) await tick(10);
  assert.equal(r.created.length, 4, 'page 3 finished; only the next page had been opened ahead');
  assert.match(r.context.notified.title, /cancelled/);
  assert.match(r.context.notified.message, /2 filled \(not saved\), 1 skipped, 7 not started/);
  assert.equal(r.context.usage.at(-1).reason, 'setup-cancelled');
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

