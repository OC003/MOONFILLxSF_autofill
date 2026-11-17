import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';

const root = new URL('../../', import.meta.url);      // autofill/
const read = path => readFileSync(new URL(path, root), 'utf8');

async function openSetup() {
  const path = 'dev/mock/awin-setup.html';
  const dom = await JSDOM.fromFile(fileURLToPath(new URL(path, root)), {url: new URL(path, root).href, runScripts: 'dangerously', pretendToBeVisual: true});
  const {window} = dom;
  window.CSS = window.CSS || {escape: s => s};
  for (const f of ['config.js', 'engine.js', 'setup/page.js']) window.eval(read(f));
  return window;
}

test('setup Check page: lists controls with labels, types and options, buttons and structure', async () => {
  const window = await openSetup();
  const before = window.document.querySelector('main').outerHTML;
  const ui = window.document.getElementById('tca-setup-root').shadowRoot;
  ui.querySelector('.check').click();
  const report = ui.querySelector('textarea').value;
  assert.match(report, /Frameworks: Angular 16\.2\.0/);
  assert.match(report, /"Cookie period \(days\)" — input\[type=number\], filled\n   label from: label .*id="cookie" name="cookiePeriod" required · in: "Cookie settings"/);
  assert.match(report, /"Tracking domain" — input\[type=text\], filled\n   label from: label/);
  assert.match(report, /"Contact email" — input\[type=email\], filled\n   label from: text before \(1 level\(s\) up\)/);
  assert.match(report, /"Commission" — select\n.*\n   options \(3\): CPA \| CPS \| Hybrid/);
  assert.doesNotMatch(report, /ul\[role=listbox\]/, "the combobox's popup isn't listed separately");
  assert.match(report, /"Deduplication" — div\[role=combobox\]\n   label from: aria-labelledby.*\n   options \(2\): Last click \| First click/);
  assert.match(report, /"Product level tracking" — input\[type=checkbox\]\n/);
  assert.match(report, /"Voucher tracking" — input\[type=radio\] group\n.*\n   options \(2\): Yes \| No/);
  assert.equal((report.match(/input\[type=radio\]/g) || []).length, 1, 'a radio group is listed once');
  assert.match(report, /"Notes" — textarea, filled/);
  assert.match(report, /"Save changes" — button\.btn\.btn-primary type=submit/);
  assert.match(report, /tab: General/);
  assert.match(report, /Messages shown \(1\)/);
  assert.equal(window.document.querySelector('main').outerHTML, before, 'nothing on the page changed');
});

test('setup Check page: no typed or selected values, hidden fields, MIDs or email addresses', async () => {
  const window = await openSetup();
  const report = window.TCASetupCheck(window.document);
  for (const secret of ['secret-shop', 'person@client', 'Private note', 'hidden-token', '123456', '987654', '"30"', 'value=']) {
    assert.ok(!report.includes(secret), `report contains ${secret}`);
  }
  assert.match(report, /Page: awin-setup\.html\n/, 'no local folder names');
  assert.match(report, /Title: Tracking settings · Advertiser # \(mock\)/);
});

test('setup Check page: only on ui.awin.com and the Awin mocks, top frame only, in the manifest', async () => {
  const manifest = JSON.parse(read('../manifest.json'));
  const entry = manifest.content_scripts.find(c => c.js.includes('autofill/setup/page.js'));
  assert.deepEqual(entry.matches, ['https://ui.awin.com/*', 'file:///*/autofill/dev/mock/awin-*.html*']);
  assert.deepEqual(entry.js, ['autofill/config.js', 'autofill/engine.js', 'autofill/setup/page.js']);
  assert.equal(entry.all_frames, undefined, 'top frame only');
  const dom = new JSDOM('<body></body>', {url: 'https://example.com/', runScripts: 'outside-only'});
  for (const f of ['config.js', 'engine.js', 'setup/page.js']) dom.window.eval(read(f));
  assert.equal(dom.window.document.getElementById('tca-setup-root'), null, 'no panel on other sites');
});
