import test, {afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';

// Layout in the merged Moonfill repo: autofill/ holds the extension code, autofill/dev/ the
// specification, mock pages and these tests. Paths below are relative to autofill/dev/.
const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const spec = JSON.parse(read('field-specification.json')).fields;
const fixed = spec.filter(f => !f.excluded && !f.rule);
const [fieldsJs, configJs, settingsJs, engineJs, contentJs] = ['fields.js', 'config.js', 'settings.js', 'engine.js', 'content.js'].map(f => read('../' + f));

// A stand-in for the extension's chrome.storage.sync and runtime messaging.
function withChrome(saved) {
  const store = saved ? {tcaSettings: saved} : {};
  const listeners = [];
  const chrome = {
    store, messages: [],
    storage: {
      sync: {
        get: async k => (k in store ? {[k]: store[k]} : {}),
        set: async o => { Object.assign(store, o); for (const l of listeners) l(Object.fromEntries(Object.keys(o).map(k => [k, {newValue: o[k]}])), 'sync'); }
      },
      onChanged: {addListener: l => listeners.push(l)}
    },
    runtime: {getURL: path => 'chrome-extension://test/' + path}
  };
  return chrome;
}

const MOCKS = {native: 'mock/technical-checklist.html', lightning: 'mock/lightning-record.html'};

async function open(mock, scenario = 'success', configure, chrome) {
  const path = MOCKS[mock];
  const dom = await JSDOM.fromFile(fileURLToPath(new URL(path, root)), {
    url: new URL(`${path}?scenario=${scenario}`, root).href,
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true
  });
  await new Promise(resolve => dom.window.addEventListener('load', resolve));
  const {window} = dom;
  if (chrome) window.chrome = chrome;
  window.eval(fieldsJs);
  window.eval(configJs);
  Object.assign(window.TCA_CONFIG, {timeouts: {editMode: 1000, dropdown: 600, save: 1500, readBack: 1000}, pollMs: 20});
  configure?.(window.TCA_CONFIG);
  window.eval(settingsJs);
  window.eval(engineJs);
  window.eval(contentJs);
  await new Promise(r => setTimeout(r, 20)); // saved settings load
  opened.push(window);
  return window;
}

const opened = [];
afterEach(() => { for (const w of opened.splice(0)) w.close(); });

const panel = window => window.document.getElementById('tca-root').shadowRoot;

async function press(window, cls) {
  const ui = panel(window);
  ui.querySelector('.' + cls).click();
  for (let i = 0; i < 200; i++) {
    await new Promise(r => setTimeout(r, 20));
    const status = ui.querySelector('.status');
    if (['saved', 'filled', 'failed', 'unconfirmed'].includes(status.dataset.state)) return status;
  }
  throw new Error('timed out');
}

// How each mock stores a date: the native page keeps the typed text, the Lightning one YYYY-MM-DD.
const stored = (mock, iso) => (mock === 'lightning' ? iso : iso.split('-').reverse().join('/'));

const key = (window, label, where = 'Technical Checklist') => {
  const rec = window.mockRecord;
  return rec[`${where}::${label}`] ?? rec[`${where === 'Technical Checklist' ? 'TC' : 'CC'}::${label}`];
};

test('extension field list is generated from the captured specification', async () => {
  const window = await open('native');
  assert.deepEqual(JSON.parse(JSON.stringify(window.TCA_FIELDS)), spec);
  window.close();
});

test('targets are the 28 fixed values plus the 2 date fields; 15 fields stay untouched', async () => {
  const window = await open('native');
  const {targets, excluded} = window.TCAEngine.planTargets(window.TCA_FIELDS);
  assert.equal(targets.length, 30);
  assert.deepEqual(JSON.parse(JSON.stringify(targets.filter(t => t.rule).map(t => [t.label, t.rule]))), [['Pixel Sent', 'record-created-date'], ['Successful Tracking Test', 'today']]);
  assert.equal(excluded.length, 15);
  window.close();
});

test('dates are read in the formats Salesforce shows, day/month order from dateFormat', async () => {
  const window = await open('native');
  const {parseDate, formatDate} = window.TCAEngine;
  const uk = {dateFormat: 'DD/MM/YYYY'}, us = {dateFormat: 'MM/DD/YYYY'};
  for (const text of ['03/11/2026, 09:41', '3/11/2026', '03.11.2026', '03/11/26', '2026-11-03', '3 Nov 2026', '3 November 2026, 09:41', 'Nov 3, 2026']) {
    assert.equal(parseDate(text, uk), '2026-11-03', text);
  }
  assert.equal(parseDate('11/03/2026', us), '2026-11-03');
  assert.equal(parseDate('31/02/2026', uk), null, 'impossible date');
  assert.equal(parseDate('Created.', uk), null);
  assert.equal(formatDate('2026-11-03', 'DD/MM/YYYY'), '03/11/2026');
  window.close();
});

test('manifest: Moonfill entries unchanged; autofill added as its own content script and settings page', () => {
  const manifest = JSON.parse(read('../../manifest.json'));
  assert.equal(manifest.name, 'Moonfill');
  assert.deepEqual(manifest.content_scripts.slice(0, 2), [
    {matches: ['https://forms.office.com/*', 'https://forms.cloud.microsoft/*'], js: ['content.js']},
    {matches: ['https://awin.lightning.force.com/*'], js: ['salesforce.js']}
  ]);
  assert.deepEqual(manifest.content_scripts[2].js, ['fields.js', 'config.js', 'settings.js', 'engine.js', 'content.js'].map(f => 'autofill/' + f));
  assert.deepEqual(manifest.content_scripts[2].matches, ['https://awin.lightning.force.com/*', 'file:///*/autofill/dev/mock/*.html*']);
  assert.ok(manifest.permissions.includes('storage'));
  assert.equal(manifest.options_ui.page, 'autofill/options.html');
  assert.deepEqual(manifest.web_accessible_resources, [{resources: ['autofill/options.html'], matches: ['https://awin.lightning.force.com/*']}]);
});

test('settings: choices are applied over the team defaults; malformed or unknown ones are ignored', async () => {
  const window = await open('native');
  const {apply, clean} = window.TCASettings;
  const cfg = window.TCA_CONFIG;
  const saved = {
    dateFormat: 'MM/DD/YYYY',
    fields: {
      'Server to server': {mode: 'skip'},
      'Tech notes': {mode: 'value', value: '  Checked by me  '},
      'Successful Tracking Test': {mode: 'created'},
      'Img tag implemented': {mode: 'value', value: '   '},
      'Batch validation': {mode: 'nonsense'},
      'No such field': {mode: 'skip'}
    }
  };
  const {fields, cfg: out, changed} = apply(window.TCA_FIELDS, cfg, saved);
  const get = label => JSON.parse(JSON.stringify(fields.find(f => f.label === label)));
  assert.deepEqual(get('Server to server'), {label: 'Server to server', excluded: true, value: null});
  assert.deepEqual(get('Tech notes'), {label: 'Tech notes', excluded: false, value: 'Checked by me'});
  assert.equal(get('Successful Tracking Test').rule, 'record-created-date');
  assert.equal(get('Img tag implemented').value, 'Yes', 'blank custom value falls back to the team default');
  assert.equal(get('Batch validation').value, 'Yes');
  assert.equal(fields.length, 45);
  assert.equal(out.dateFormat, 'MM/DD/YYYY');
  assert.equal(cfg.dateFormat, 'DD/MM/YYYY', 'team config untouched');
  assert.equal(changed, 4);
  assert.deepEqual(JSON.parse(JSON.stringify(clean({dateFormat: 'YYYY/DD', fields: 'x'}))), {});
});

test('settings: the panel fills with personal settings and says so', async () => {
  const chrome = withChrome({fields: {'Server to server': {mode: 'skip'}, 'Tech notes': {mode: 'value', value: 'Checked by me'}, 'Pixel Sent': {mode: 'today'}}});
  const window = await open('lightning', 'success', null, chrome);
  assert.match(panel(window).querySelector('.summary').textContent, /Fills 30 fields: 28 values and 2 dates\./);
  assert.match(panel(window).querySelector('.summary').textContent, /Your settings: 3 change\(s\)/);
  const status = await press(window, 'save');
  assert.equal(status.dataset.state, 'saved', status.textContent);
  assert.equal(key(window, 'Server to server'), 'No', 'left untouched');
  assert.equal(key(window, 'Tech notes'), 'Checked by me', 'excluded field filled with a personal value');
  assert.equal(key(window, 'Pixel Sent'), window.TCAEngine.todayIso());
  assert.equal(key(window, 'Batch validation'), 'Yes', 'other fields keep the team default');
  const tabs = [];
  window.open = (url, target) => { tabs.push([url, target]); return null; };
  panel(window).querySelector('.settings').click();
  assert.deepEqual(tabs, [['chrome-extension://test/autofill/options.html', '_blank']]);
});

test('settings: changes saved while the page is open are used on the next run', async () => {
  const chrome = withChrome();
  const window = await open('native', 'success', null, chrome);
  assert.match(panel(window).querySelector('.summary').textContent, /Team defaults/);
  await chrome.storage.sync.set({tcaSettings: {fields: {'Server to server': {mode: 'skip'}}}});
  await new Promise(r => setTimeout(r, 20));
  assert.match(panel(window).querySelector('.summary').textContent, /Your settings: 1 change/);
  const status = await press(window, 'save');
  assert.equal(status.dataset.state, 'saved', status.textContent);
  assert.equal(key(window, 'Server to server'), 'No');
});

async function openOptions(chrome) {
  const dom = await JSDOM.fromFile(fileURLToPath(new URL('../options.html', root)), {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    beforeParse(window) { window.chrome = chrome; }
  });
  await new Promise(resolve => dom.window.addEventListener('load', resolve));
  await new Promise(r => setTimeout(r, 20));
  opened.push(dom.window);
  return dom.window;
}

test('settings page: lists all 45 fields, shows saved choices, saves only changes, resets', async () => {
  const chrome = withChrome({fields: {'Server to server': {mode: 'skip'}}});
  const window = await openOptions(chrome);
  const doc = window.document;
  const rows = [...doc.querySelectorAll('#fields tr')];
  assert.equal(rows.length, 45);
  const rowFor = label => rows.find(r => r.dataset.label === label);
  const modes = label => [...rowFor(label).querySelectorAll('option')].map(o => o.value);
  assert.equal(rowFor('Server to server').querySelector('.mode').value, 'skip');
  assert.ok(rowFor('Server to server').classList.contains('changed'));
  assert.equal(rowFor('Pixel Sent').querySelector('.default').textContent, 'Record creation date (only if empty)');
  assert.deepEqual(modes('Pixel Sent'), ['', 'skip', 'created', 'today'], 'date fields: date choices, no free text');
  assert.ok(!modes('Batch validation').includes('today'), 'no date choices on other fields');
  assert.ok(!modes('Tech notes').includes('skip'), 'no "leave untouched" where that is already the default');

  const choose = (label, mode, value) => {
    const r = rowFor(label), select = r.querySelector('.mode');
    select.value = mode;
    select.dispatchEvent(new window.Event('change'));
    if (value !== undefined) r.querySelector('.value').value = value;
  };
  choose('Tech notes', 'value');
  assert.equal(rowFor('Tech notes').querySelector('.value').hidden, false);
  doc.getElementById('save').click();
  await new Promise(r => setTimeout(r, 20));
  assert.match(doc.getElementById('status').textContent, /Enter a value for "Tech notes"/);

  choose('Tech notes', 'value', 'Checked by me');
  doc.getElementById('date-format').value = 'MM/DD/YYYY';
  doc.getElementById('save').click();
  await new Promise(r => setTimeout(r, 20));
  assert.match(doc.getElementById('status').textContent, /Saved\. 3 change/);
  assert.deepEqual(JSON.parse(JSON.stringify(chrome.store.tcaSettings)), {dateFormat: 'MM/DD/YYYY', fields: {'Server to server': {mode: 'skip'}, 'Tech notes': {mode: 'value', value: 'Checked by me'}}});

  doc.getElementById('reset').click();
  await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(JSON.parse(JSON.stringify(chrome.store.tcaSettings)), {});
  assert.equal(rowFor('Server to server').querySelector('.mode').value, '');
  assert.equal(doc.getElementById('date-format').value, 'DD/MM/YYYY');
});

for (const mock of Object.keys(MOCKS)) {
  test(`${mock}: panel appears once and finds exactly the visible checklist`, async () => {
    const window = await open(mock);
    assert.equal(window.document.querySelectorAll('#tca-root').length, 1);
    assert.match(panel(window).querySelector('.found').textContent, /Technical Checklist found/);
    assert.equal(panel(window).querySelector('.save').disabled, false);
    window.close();
  });

  test(`${mock}: fill & save — all 28 fixed values and both dates; preserves excluded fields and other checklists`, async () => {
    const window = await open(mock);
    const status = await press(window, 'save');
    assert.equal(status.dataset.state, 'saved', status.textContent);
    assert.equal(window.mockSaveCount, 1);
    for (const f of fixed) assert.equal(key(window, f.label), f.value, f.label);
    assert.equal(key(window, 'Server to server'), 'Yes', 'differing value replaced');
    assert.equal(key(window, 'Pixel Sent'), stored(mock, '2026-11-03'), 'creation date from Implementation History');
    assert.equal(key(window, 'Successful Tracking Test'), stored(mock, window.TCAEngine.todayIso()), "today's date");
    assert.equal(key(window, 'Tech notes'), 'Existing note from the implementer');
    assert.equal(key(window, 'Img tag implemented', 'Commercial Checklist'), 'No');
    window.close();
  });

  test(`${mock}: date fields that already have a value are kept`, async () => {
    const window = await open(mock, 'dates-filled');
    const status = await press(window, 'save');
    assert.equal(status.dataset.state, 'saved', status.textContent);
    assert.equal(key(window, 'Pixel Sent'), stored(mock, '2026-10-01'));
    assert.equal(key(window, 'Successful Tracking Test'), stored(mock, '2026-10-20'));
    assert.match(status.textContent, /Pixel Sent already had a value, so it was kept\. Successful Tracking Test already had a value/);
    window.close();
  });

  test(`${mock}: no "Created." line — Pixel Sent is left blank, the rest is saved and the panel says why`, async () => {
    const window = await open(mock, 'no-history');
    const status = await press(window, 'save');
    assert.equal(status.dataset.state, 'saved', status.textContent);
    assert.ok(!key(window, 'Pixel Sent'));
    assert.equal(key(window, 'Successful Tracking Test'), stored(mock, window.TCAEngine.todayIso()));
    assert.equal(key(window, 'Server to server'), 'Yes');
    assert.match(status.textContent, /Pixel Sent left as it is: no "Created\." line/);
    window.close();
  });

  test(`${mock}: Fill only changes the form but does not save`, async () => {
    const window = await open(mock);
    const status = await press(window, 'fill');
    assert.equal(status.dataset.state, 'filled', status.textContent);
    assert.ok(!window.mockSaveCount, 'not saved');
    assert.equal(key(window, 'Server to server'), 'No', 'record unchanged until the user saves');
    assert.ok(window.TCAEngine.isEditing(window.document, window.TCA_CONFIG), 'left in edit mode for review');
    window.close();
  });

  test(`${mock}: save validation error is reported as failure, not success`, async () => {
    const window = await open(mock, 'error');
    const status = await press(window, 'save');
    assert.equal(status.dataset.state, 'failed');
    assert.match(status.textContent, /did not save/);
    assert.equal(key(window, 'Server to server'), 'No');
    window.close();
  });

  test(`${mock}: missing dropdown option stops without saving and lists the options`, async () => {
    const window = await open(mock, 'missing-option');
    const status = await press(window, 'save');
    assert.equal(status.dataset.state, 'failed');
    assert.match(status.textContent, /Server to server.*not available.*Options shown: --None--, No, Exempt/);
    assert.ok(!window.mockSaveCount);
    window.close();
  });

  test(`${mock}: refuses to start when the record is already in edit mode`, async () => {
    const window = await open(mock);
    (window.document.getElementById('app') || window.document).querySelector('button[title^="Edit "]').click();
    const result = await window.TCAEngine.run(window.document, window.TCA_CONFIG, window.TCA_FIELDS);
    assert.equal(result.status, 'failed');
    assert.match(result.message, /already in edit mode/);
    window.close();
  });

  test(`${mock}: Check page reports labels and structure, changes nothing, contains no values`, async () => {
    const window = await open(mock);
    panel(window).querySelector('.check').click();
    await new Promise(r => setTimeout(r, 20));
    const report = panel(window).querySelector('textarea').value;
    assert.match(report, /Specification labels found: 45 of 45/);
    assert.match(report, /✓ Server to server · pencil: yes → will set "Yes"/);
    assert.match(report, /Implementation History: creation date found/);
    assert.match(report, /✓ Pixel Sent · pencil: yes → will set the record's creation date \(only if empty\)/);
    assert.doesNotMatch(report, /03\/11\/2026|2026-11-03/, 'no dates in the report');
    assert.doesNotMatch(report, /Existing note from the implementer|IMP-0001|Fictional Retailer/);
    assert.ok(!window.mockSaveCount);
    assert.ok(!window.TCAEngine.isEditing(window.document, window.TCA_CONFIG));
    window.close();
  });
}

test('native: duplicate Technical Checklist sections — fill disabled, engine refuses', async () => {
  const window = await open('native', 'duplicate');
  assert.equal(panel(window).querySelector('.save').disabled, true);
  const result = await window.TCAEngine.run(window.document, window.TCA_CONFIG, window.TCA_FIELDS);
  assert.equal(result.status, 'failed');
  assert.match(result.message, /expected exactly one/);
  window.close();
});

test('lightning: hidden cached record is ignored; shadow-DOM picklists are filled', async () => {
  const window = await open('lightning');
  const titles = [...window.document.querySelectorAll('.test-id__section-header-title')].filter(t => t.textContent === 'Technical Checklist');
  assert.equal(titles.length, 2, 'mock has a hidden cached copy');
  assert.equal(window.TCAEngine.createdDate(window.document, window.TCA_CONFIG).date, '2026-11-03', "the cached record's history (2025) is ignored");
  const status = await press(window, 'save');
  assert.equal(status.dataset.state, 'saved', status.textContent);
  window.close();
});

test('lightning: a dependent field changing stops before Save', async () => {
  const window = await open('lightning', 'dependent');
  const status = await press(window, 'save');
  assert.equal(status.dataset.state, 'failed', status.textContent);
  assert.match(status.textContent, /Deduplication Solution.*changed unexpectedly.*NOT saved/);
  assert.ok(!window.mockSaveCount);
  window.close();
});

test('lightning: Check page in edit mode reports control types', async () => {
  const window = await open('lightning');
  (window.document.getElementById('app') || window.document).querySelector('button[title^="Edit "]').click();
  panel(window).querySelector('.check').click();
  await new Promise(r => setTimeout(r, 20));
  const report = panel(window).querySelector('textarea').value;
  assert.match(report, /Server to server · pencil: no · control: picklist/);
  assert.match(report, /Deduplication Parameter · pencil: no · control: text/);
  assert.match(report, /Pixel Sent · pencil: no · control: text/);
  window.close();
});

test('lightning: a collapsed checklist is expanded, then filled and saved', async () => {
  const window = await open('lightning', 'collapsed');
  assert.match(panel(window).querySelector('.found').textContent, /Technical Checklist found/);
  const status = await press(window, 'save');
  assert.equal(status.dataset.state, 'saved', status.textContent);
  assert.equal(key(window, 'Server to server'), 'Yes');
  window.close();
});
