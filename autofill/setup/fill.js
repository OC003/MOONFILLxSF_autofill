// Programme setup, stage 3 (page side): fills one Awin UI setup page from the values entered in the
// setup form, then saves it. Driven by the background script, one page at a time:
//   { action: 'tcaSetupFill', values, save }  →  { status: 'skipped' | 'filled' | 'saving' | 'failed', message }
//   { action: 'tcaSetupVerify', values }       →  { status: 'saved' | 'unconfirmed' | 'failed', message }
// Fields are found by their id where the page check showed a stable one, otherwise by their visible
// text (label or option), so pages whose structure the check couldn't see still work.
(function (root) {
  const { all, cleanText, visible, closest, norm, setNative, clickLikeUser, waitFor, sleep } = root.TCAEngine.dom;
  const NOISE = '.sr-only, .visually-hidden, script, style, svg';
  const CONTROL = 'input:not([type="hidden"]), select, textarea, [contenteditable="true"], [role="combobox"], [role="listbox"], [role="checkbox"], [role="switch"]';
  const TRIGGER = '.ng-select, mat-select, .mat-select, .mat-mdc-select, .select2-container, .chosen-container, .p-dropdown, [role="combobox"], [aria-haspopup="listbox"], select';
  const OPTION = '[role="option"], .ng-option, mat-option, .mat-option, .mat-mdc-option, .select2-results__option, .dropdown-item, .p-dropdown-item, li';
  const ERROR = '.alert-danger, .alert-error, .error-message, .toast-error, .notification-error, [role="alert"].error';
  const SUCCESS = '.alert-success, .toast-success, .notification-success';

  // Timings (ms). quiet: how long the page must stop changing before it counts as loaded.
  const T = { quiet: 2000, quietMax: 25000, recheck: 2500 };

  // Waits until the page has stopped changing (its data has arrived and been drawn), or quietMax.
  function settled() {
    return new Promise(resolve => {
      let timer;
      const observer = new root.MutationObserver(() => { clearTimeout(timer); timer = setTimeout(done, T.quiet); });
      const done = () => { observer.disconnect(); clearTimeout(cap); resolve(); };
      const cap = setTimeout(done, T.quietMax);
      observer.observe(doc().documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
      timer = setTimeout(done, T.quiet);
    });
  }

  class SetupError extends Error {}
  const fail = message => { throw new SetupError(message); };

  const PLATFORM_APPEND = {
    Access: 'source=aw',
    other: 'source=aw&utm_source=awin&sv1=affiliate&sv_campaign_id=!!!id!!!'
  };
  const PLUGIN = { name: 'R.O.EYE - Consent - SingleView', code: 'AWIN.Tracking.RoEye = AWIN.Tracking.RoEye || {};' };
  const PUBLISHERS = ['45628', '111'];

  // ---------- finding things ----------

  const doc = () => root.document;
  const shown = selector => all(doc().body, selector).filter(visible).filter(el => !closest(el, '#tca-setup-root'));
  const same = (a, b) => norm(a).replace(/[:?]$/, '') === norm(b).replace(/[:?]$/, '');
  // Awin's account switcher ("Provider Area", Go To Advertiser Account, Submit) is on every page.
  const inSwitcher = el => !!(closest(el, 'form') && closest(el, 'form').querySelector('[name="switchId"]'));
  const byId = id => { const el = doc().getElementById(id); return el && visible(el) ? el : null; };

  // The smallest visible element whose own text is exactly this label.
  function labelElement(text) {
    const hits = shown('label, span, div, p, td, th, dt, h3, h4, h5, legend, strong, b').filter(el => same(cleanText(el, NOISE), text));
    return hits.find(el => !hits.some(other => other !== el && el.contains(other))) || null;
  }

  // The first control after a label: its "for" target, or the next matching element in page order
  // within the label's surroundings (up to four levels up).
  function controlAfter(label, selector) {
    if (label.tagName === 'LABEL' && label.htmlFor) { const t = doc().getElementById(label.htmlFor); if (t && t.matches(selector)) return t; }
    const inside = all(label, selector).filter(visible)[0];
    if (inside) return inside;
    for (let n = label, depth = 0; n && depth < 4; n = n.parentElement, depth++) {
      const after = all(n.parentElement || n, selector).filter(visible).find(el => label.compareDocumentPosition(el) & 4);
      if (after) return after;
    }
    return null;
  }

  function fieldByLabel(text, selector = CONTROL) {
    const native = shown('input, select, textarea').find(el => el.labels && [...el.labels].some(l => same(cleanText(l, NOISE), text)));
    if (native && native.matches(selector)) return native;
    const label = labelElement(text);
    return label ? controlAfter(label, selector) : null;
  }

  // ---------- changing things (each one checks it worked) ----------

  async function setText(el, value, name) {
    if (!el) fail(`"${name}" not found on the page.`);
    if (el.disabled || el.readOnly) fail(`"${name}" can't be edited.`);
    if (el.isContentEditable) {
      el.focus();
      doc().execCommand('selectAll', false, null);
      doc().execCommand('insertText', false, value);
    } else {
      setNative(el, value);
    }
    const now = el.isContentEditable ? el.textContent : el.value;
    if (now.trim() !== String(value).trim()) fail(`"${name}" didn't keep its new value.`);
  }

  // Where code goes: a code editor (CodeMirror, Ace, Monaco) or a plain text box, inside scope.
  const EDITORS = [
    ['.cm-editor', '.cm-content', 'CodeMirror'],
    ['.CodeMirror', 'textarea', 'CodeMirror'],
    ['.ace_editor', 'textarea', 'Ace'],
    ['.monaco-editor', 'textarea', 'Monaco']
  ];
  function codeBox(scope) {
    for (const [wrap, input, kind] of EDITORS) {
      const editor = all(scope, wrap).filter(visible).pop();
      const el = editor && all(editor, input)[0];
      if (el) return { el, editor, kind };
    }
    const free = el => visible(el) && !inSwitcher(el) && !el.disabled && !el.readOnly;
    const box = all(scope, 'textarea, [contenteditable="true"]').filter(free).pop()
      || (scope !== doc().body && all(scope, 'input[type="text"], input:not([type])').filter(free).filter(el => !/search|filter/i.test(`${el.name} ${el.placeholder} ${el.className}`)).pop());
    return box ? { el: box, editor: null, kind: box.tagName === 'TEXTAREA' ? 'text box' : box.isContentEditable ? 'editable box' : 'single-line text box' } : null;
  }
  // The box titled "Set-up" in the plugin's settings: where the code goes.
  const EDITOR_WRAP = EDITORS.map(([wrap]) => wrap).join(', ');
  function setupBox() {
    for (const title of ['Set-up', 'Setup', 'Set up']) {
      const label = labelElement(title);
      const el = label && controlAfter(label, `${EDITOR_WRAP}, textarea, [contenteditable="true"], input[type="text"], input:not([type])`);
      if (!el) continue;
      const wrap = closest(el, EDITOR_WRAP);
      if (wrap) {
        const [, input, kind] = EDITORS.find(([w]) => wrap.matches(w));
        const inner = all(wrap, input)[0];
        if (inner) return { el: inner, editor: wrap, kind: `"${title}" ${kind} editor` };
      }
      if (el.disabled || el.readOnly) continue;
      return { el, editor: null, kind: `"${title}" ${el.tagName === 'TEXTAREA' ? 'text box' : el.isContentEditable ? 'editable box' : 'single-line text box'}` };
    }
    return null;
  }
  const findCodeBox = () => setupBox() || codeBox(pluginScope || doc().body) || codeBox(doc().body);

  const squash = text => String(text ?? '').replace(/[\s\u00a0\u200b]+/g, '');
  const codeShown = box => squash(box.editor ? cleanText(box.editor, NOISE) || box.el.value : box.el.isContentEditable ? box.el.textContent : box.el.value).includes(squash(PLUGIN.code));

  // Types code the way a person would (so editors and page frameworks register it), falling back to
  // setting the value directly where typing isn't available.
  function typeCode(box, code) {
    const { el } = box;
    el.focus();
    let typed = false;
    try {
      if (typeof doc().execCommand === 'function') {
        if (el.select && !box.editor) el.select(); else doc().execCommand('selectAll', false, null);
        typed = doc().execCommand('insertText', false, code);
      }
    } catch { typed = false; }
    if (!typed || !codeShown(box)) {
      if (el.isContentEditable) el.textContent = code;
      else setNative(el, code);
    }
  }

  // Something clickable by its text: a button or link, or (for prompts drawn as plain text) the
  // smallest visible element showing exactly that text.
  function clickableText(text) {
    const b = button(text);
    if (b) return b;
    const hits = shown('span, a, u, strong, b, div, p, label, small').filter(el => same(cleanText(el, NOISE), text));
    return hits.find(el => !hits.some(other => other !== el && el.contains(other))) || null;
  }

  // A short description of a box, to show in the run's results.
  function describeBox(box) {
    const el = box.editor || box.el;
    const label = (el.labels && el.labels[0] && cleanText(el.labels[0], NOISE)) || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '';
    const name = el.id ? `#${el.id}` : el.getAttribute('name') ? `[name=${el.getAttribute('name')}]` : el.className ? `.${String(el.className).trim().split(/\s+/)[0]}` : '';
    return `${box.kind} ${el.tagName.toLowerCase()}${name}${label ? ` "${label.slice(0, 40)}"` : ''}`;
  }

  function ensureChecked(el, name) {
    if (!el) fail(`"${name}" not found on the page.`);
    if (el.disabled) fail(`"${name}" can't be changed.`);
    if (!el.checked) clickLikeUser(el);
    if (!el.checked) fail(`"${name}" didn't stay ticked.`);
  }

  // A radio button whose label starts with the option's text.
  function chooseRadio(groupName, option) {
    const radios = [...doc().querySelectorAll(`input[type="radio"][name="${groupName}"]`)];
    if (!radios.length) fail(`The "${option}" choice wasn't found on the page.`);
    const radio = radios.find(r => [...(r.labels || [])].some(l => norm(cleanText(l, NOISE)).startsWith(norm(option))));
    if (!radio) fail(`Option "${option}" isn't available.`);
    if (!radio.checked) clickLikeUser(radio);
    if (!radio.checked) fail(`"${option}" didn't stay selected.`);
  }

  function chooseNative(select, option, name) {
    const match = [...select.options].find(o => same(o.text, option));
    if (!match) fail(`"${name}": option "${option}" isn't available. Options shown: ${[...select.options].map(o => o.text.trim()).filter(Boolean).join(', ')}.`);
    setNative(select, match.value);
    if (select.value !== match.value) fail(`"${name}" didn't keep "${option}".`);
  }

  // A dropdown: native, or built from plain elements (click it open, then click the option's text).
  async function choose(trigger, option, name) {
    if (!trigger) fail(`"${name}" not found on the page.`);
    if (trigger.tagName === 'SELECT') return chooseNative(trigger, option, name);
    const opened = async () => waitFor(() => shown(OPTION).find(o => same(cleanText(o, NOISE), option)), 3000);
    let item = null;
    for (let attempt = 0; attempt < 2 && !item; attempt++) {   // the first click is sometimes swallowed
      clickLikeUser(all(trigger, 'input')[0] || trigger);
      item = await opened();
    }
    if (!item) fail(`"${name}": option "${option}" didn't appear when the dropdown was opened.`);
    clickLikeUser(item);
    await sleep(200);
    if (!norm(cleanText(trigger, NOISE)).includes(norm(option)) && !(trigger.value && same(trigger.value, option))) {
      fail(`"${name}" doesn't show "${option}" after choosing it.`);
    }
  }

  // The dropdown, anywhere on the page, that offers this option.
  async function chooseAnywhere(option, name) {
    const select = shown('select').find(s => [...s.options].some(o => same(o.text, option)));
    if (select) { chooseNative(select, option, name); return select; }
    for (const trigger of shown(TRIGGER)) {
      try { await choose(trigger, option, name); return trigger; } catch { doc().body.click(); /* close it and try the next one */ }
    }
    fail(`No dropdown on the page offers "${option}".`);
  }

  // A visible button or link by its text. Leading symbols ("+ Add…") are ignored; an exact match wins,
  // otherwise the shortest one containing the text (for multi-word labels only).
  function button(texts, scope = doc().body) {
    const wanted = [].concat(texts).map(norm);
    const words = b => norm(cleanText(b, NOISE) || b.value || b.getAttribute('aria-label') || b.title).replace(/^[^a-z0-9]+/, '');
    const candidates = all(scope, 'button, input[type="submit"], input[type="button"], a, [role="button"], [role="link"]').filter(visible)
      .filter(b => !closest(b, '#tca-setup-root') && !inSwitcher(b));
    for (const want of wanted) {
      const exact = candidates.find(b => words(b) === want);
      if (exact) return exact;
    }
    const partial = candidates.filter(b => wanted.some(w => w.includes(' ') && words(b).includes(w)));
    return partial.sort((a, b) => words(a).length - words(b).length)[0] || null;
  }

  async function clickSave(el, name) {
    if (!el) fail(`The ${name} button wasn't found.`);
    if (el.disabled || el.classList.contains('btn-disabled')) {
      await waitFor(() => !el.disabled && !el.classList.contains('btn-disabled'), 2000);
      if (el.disabled) fail(`The ${name} button stayed disabled: the page didn't register the changes.`);
    }
    // Answer first: a classic form reloads the page as soon as it's submitted.
    setTimeout(() => clickLikeUser(el), 100);
    return { status: 'saving', message: `${name} clicked.` };
  }

  const errorShown = () => shown(ERROR).map(e => cleanText(e, NOISE)).find(Boolean);
  const successShown = () => shown(SUCCESS).map(e => cleanText(e, NOISE)).find(Boolean);

  // ---------- the pages, in the order New Implementation opens them ----------

  const append = v => (v.platformOffer === 'Access' ? PLATFORM_APPEND.Access : PLATFORM_APPEND.other);

  // ---------- Commission groups: a table of boxes ----------

  const BOX = `${TRIGGER}, input:not([type="hidden"]), textarea, [contenteditable="true"]`;
  const ROW = 'tr, [role="row"], .ag-row, .row, .grid-row';
  const CELL = 'td, th, [role="gridcell"], [role="cell"], .ag-cell';
  // The cells of a row that hold a box, in order, each with its main control (a dropdown first).
  function boxCells(row) {
    const cells = all(row, CELL).filter(c => closest(c.parentElement, ROW) === row || c.parentElement === row);
    const list = (cells.length ? cells : [...row.children]).filter(visible);
    return list.map(cell => ({ cell, el: all(cell, TRIGGER).filter(visible)[0] || all(cell, BOX).filter(visible)[0] })).filter(c => c.el);
  }
  // The row to fill: one with at least six boxes; if several, the one whose sixth box is still empty.
  function commissionRow() {
    const rows = shown(ROW).filter(r => !inSwitcher(r) && boxCells(r).length >= 6 && !shown(ROW).some(inner => inner !== r && r.contains(inner) && boxCells(inner).length >= 6));
    if (rows.length < 2) return rows[0] || null;
    return rows.find(r => { const sixth = boxCells(r)[5].el; return 'value' in sixth && sixth.value === ''; }) || rows[rows.length - 1];
  }
  // Transaction Type, Commission Type, Publisher Commission: by their column headings when the
  // table has them, otherwise boxes 4, 5 and 6 of the row.
  function commissionBoxes(row) {
    const cells = boxCells(row);
    const table = closest(row, 'table, [role="grid"], [role="table"], .ag-root');
    const heads = table ? all(table, 'th, [role="columnheader"], .ag-header-cell').filter(visible) : [];
    const rowCells = all(row, CELL).filter(c => closest(c.parentElement, ROW) === row || c.parentElement === row).filter(visible);
    const byHeading = ['Transaction Type', 'Commission Type', 'Publisher Commission'].map(text => {
      const i = heads.findIndex(h => same(cleanText(h, NOISE), text));
      const cell = i >= 0 && heads.length === rowCells.length ? rowCells[i] : null;
      return cell && cells.find(c => c.cell === cell);
    });
    const picked = byHeading.every(Boolean) ? byHeading : cells.slice(3, 6);
    const [t, c, p] = picked.map(x => x && x.el);
    const rate = p && (p.matches('input, textarea, [contenteditable="true"]') ? p : all(p.parentElement, 'input:not([type="hidden"])')[0]);
    return [t, c, rate];
  }

  // What page 3 looks like, for the run's results when it fails: structure only, no values.
  let commissionLog = [];
  const describeEl = el => {
    const cls = String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(c => '.' + c).join('');
    return `${el.tagName.toLowerCase()}${el.getAttribute('role') ? `[role=${el.getAttribute('role')}]` : ''}${cls}`;
  };
  const chain = el => { const out = []; for (let n = el; n && n !== doc().body && out.length < 6; n = n.parentElement) out.push(describeEl(n)); return out.join(' < '); };
  function describeCommissionPage() {
    const parts = [...commissionLog];
    for (const title of ['Transaction Type', 'Commission Type', 'Publisher Commission']) {
      const el = labelElement(title);
      parts.push(el ? `"${title}" heading: ${chain(el)}` : `no "${title}" heading`);
    }
    const kinds = el => (el.tagName === 'INPUT' ? `input:${el.type || 'text'}` : describeEl(el));
    const rows = shown(ROW).filter(r => !inSwitcher(r)).map(r => ({ r, boxes: all(r, BOX).filter(visible) })).filter(x => x.boxes.length && !inSwitcher(x.r));
    parts.push(`${rows.length} row(s) with boxes`);
    for (const { r, boxes } of rows.slice(0, 6)) parts.push(`row ${describeEl(r)}: ${boxes.length} box(es) [${boxes.slice(0, 8).map(kinds).join(', ')}]`);
    const loose = shown(BOX).filter(el => !inSwitcher(el) && !closest(el, ROW));
    if (loose.length) parts.push(`${loose.length} box(es) outside any row: ${loose.slice(0, 8).map(el => `${kinds(el)} in ${chain(el.parentElement)}`).join(' | ')}`);
    parts.push(diagnostics());
    return parts.join('; ').replace(/\d{4,}/g, '#');
  }

  let pluginScope = null;   // the plugin menu, once open

  // Page 1's fields: by id (from the page check), or by label if the id differs.
  const TRACKING = [
    ['MainWebsiteURL', 'Website URL', 'text'],
    ['GlobalClickThroughPage', 'Landing Page', 'text'],
    ['ClickAppend', 'Default Query String Append', 'text'],
    ['DeeplinkEnabled', 'Enable Link Builder for publishers', 'tick'],
    ['NoDomainDeeplink', 'Use relative URLs for deep links', 'tick']
  ];
  const trackingField = (id, label, kind) => byId(id) || fieldByLabel(label, kind === 'text' ? 'input:not([type="hidden"]):not([type="checkbox"]), textarea' : 'input[type="checkbox"]');
  const trackingValues = v => ({ MainWebsiteURL: v.websiteUrl, GlobalClickThroughPage: v.landingPage, ClickAppend: append(v) });

  const PAGES = [
    {
      key: 'tracking', name: 'Tracking settings', match: /\/tracking-settings\/.*\/main-settings/,
      // The values come from the setup form (Salesforce); here they're typed into the page's boxes.
      // The page draws its form a moment after loading, so wait for the boxes before giving up.
      async fill(v) {
        const missing = () => TRACKING.filter(([id, label, kind]) => !trackingField(id, label, kind)).map(([, label]) => label);
        await waitFor(() => !missing().length, 15000);
        if (missing().length) fail(`${missing().map(l => `"${l}"`).join(', ')} not found on the page (waited 15 s for it to load).`);
        const values = trackingValues(v);
        const write = async () => {
          for (const [id, label, kind] of TRACKING) {
            if (kind === 'text') await setText(trackingField(id, label, kind), values[id], label);
            else ensureChecked(trackingField(id, label, kind), label);
          }
        };
        await write();
        // If the page loads its saved settings over ours, write them again once.
        await sleep(T.recheck);
        if (!this.verify(v).every(Boolean)) { await settled(); await write(); await sleep(T.recheck); }
        const wrong = TRACKING.filter((f, i) => !this.verify(v)[i]).map(([, label]) => label);
        if (wrong.length) fail(`${wrong.join(', ')} kept changing back after being filled.`);
        // A new address shows a warning under its box with "Add to Accepted Domains": click each one.
        const prompt = () => clickableText('Add to Accepted Domains');
        await waitFor(prompt, 3000);
        let added = 0;
        for (let p = prompt(); p && added < 6; p = prompt()) {
          clickLikeUser(p);
          added++;
          await waitFor(() => prompt() !== p || !p.isConnected, 2000);
          await sleep(300);
        }
        if (prompt()) fail('"Add to Accepted Domains" was clicked but is still showing.');
        return added ? { note: `Added to Accepted Domains ${added === 1 ? 'once' : `${added} times`}.` } : null;
      },
      save: () => button('Save'),
      verify: v => {
        const values = trackingValues(v);
        return TRACKING.map(([id, label, kind]) => { const el = trackingField(id, label, kind); return el && (kind === 'text' ? el.value === values[id] : el.checked); });
      }
    },
    { key: 'invite', name: 'Invite user', match: /\/settings\/invite-user/, skip: () => 'comes pre-filled' },
    {
      key: 'commission', name: 'Commission groups', match: /\/commission-manager\/.*\/commission-groups/,
      // A table: column headings on top, a row of boxes underneath. In that row, boxes 1–3 are left
      // alone and boxes 4, 5, 6 are Transaction Type, Commission Type and Publisher Commission.
      // The row appears after clicking "Add Default Commission Group".
      async fill(v) {
        await waitFor(() => commissionRow() || button(['Add Default Commission Group', 'Edit Commission Groups']), 10000);
        commissionLog = [];
        for (const name of ['Add Default Commission Group', 'Edit Commission Groups']) {
          if (commissionRow()) break;
          const open = button(name);
          commissionLog.push(open ? `clicked "${name}" (${describeEl(open)})` : `no "${name}" button`);
          if (open) { clickLikeUser(open); await waitFor(commissionRow, 8000); await sleep(500); }
        }
        const row = commissionRow();
        if (!row) fail('The row of commission boxes didn\'t appear after clicking Add Default Commission Group.');
        const [transaction, commission, rate] = commissionBoxes(row);
        await choose(transaction, v.transactionType, 'Transaction Type');
        await choose(commission, v.commissionType, 'Commission Type');
        await setText(rate, v.publisherCommission, 'Publisher commission');
      },
      save: () => button(['Save', 'Save changes', 'Update', 'Confirm']),
      diagnose: () => describeCommissionPage()
    },
    {
      key: 'plugin', name: 'Plugin store', match: /\/advertiser-mastertag\/.*\/plugins/,
      skip: v => (v.platformOffer === 'Access' ? 'not needed for Access' : null),
      async fill() {
        const stay = button('Stay here for now');
        if (stay) { clickLikeUser(stay); await sleep(500); }
        const add = button('Add Plugin');
        if (!add) fail('The Add Plugin button wasn\'t found.');
        clickLikeUser(add);
        await waitFor(() => shown(TRIGGER).length, 5000);
        const dropdown = await chooseAnywhere(PLUGIN.name, 'Plugin');
        // The plugin's settings (with the code box) are drawn after the plugin is chosen.
        pluginScope = closest(dropdown, '[role="dialog"], .modal-content, .modal, form, .panel, .card, section') || doc().body;
        await sleep(1000);
        const box = await waitFor(findCodeBox, 8000);
        if (!box) fail('The plugin\'s code box wasn\'t found after choosing the plugin.');
        typeCode(box, PLUGIN.code);
        // The page sometimes redraws the form just after: check the code is still there, and retype once.
        await sleep(1000);
        const again = findCodeBox();
        if (!again || !codeShown(again)) { if (again) typeCode(again, PLUGIN.code); await sleep(500); }
        const now = findCodeBox();
        if (!now || !codeShown(now)) fail(`The plugin code didn't stay in the ${box.kind} (${describeBox(now || box)}).`);
        return { note: `Code typed into: ${describeBox(now)}.` };
      },
      save: () => button(['Save', 'Add', 'Add Plugin', 'Confirm', 'Submit', 'Install'], pluginScope || doc().body)
    },
    {
      key: 'tag', name: 'Tracking tag settings', match: /\/advertiser-mastertag\/.*\/trackingtagsettings/,
      async fill() {
        await waitFor(() => shown(TRIGGER).length, 8000);
        await chooseAnywhere('Conversion Tag and Image Pixel integrated', 'Tracking tag');
      },
      save: () => button(['Save', 'Save changes', 'Update'])
    },
    {
      key: 'account', name: 'Account details', match: /\/merchant-settings\/.*\/account-details/,
      async fill() {
        for (const id of ['ipTrackingEnabled', 'referer_truncation_isDomainIncludeInvalid']) if (!byId(id)) fail(`"${id}" tick box not found on the page.`);
        ensureChecked(byId('ipTrackingEnabled'), 'Enable IP tracking');
        ensureChecked(byId('referer_truncation_isDomainIncludeInvalid'), 'Strip path information if referrer has no valid domain');
      },
      save: () => byId('tracking-masterdata-submit'),
      verify: () => [byId('ipTrackingEnabled')?.checked, byId('referer_truncation_isDomainIncludeInvalid')?.checked]
    },
    { key: 'fee', name: 'Fee manager', match: /\/finance\/fee-manager\//, skip: () => 'comes pre-filled' },
    {
      key: 'mobile', name: 'Mobile tracking', match: /\/merchant-settings\/.*\/mobile-tracking/,
      async fill() { chooseRadio('strategy', 'Tracking is implemented on mobile site'); },
      save: () => byId('updateChanges'),
      verify: () => [[...doc().querySelectorAll('input[name="strategy"]')].some(r => r.checked && [...(r.labels || [])].some(l => norm(cleanText(l, NOISE)).startsWith(norm('Tracking is implemented on mobile site'))))]
    },
    {
      key: 'advertiser', name: 'Advertiser settings', match: /\/provider\/migrated-advertiser-settings\//,
      async fill(v) {
        const approval = fieldByLabel('Approval of Publishers Joining', 'select');
        const days = fieldByLabel('Validation Period Days', 'input');
        if (!approval) fail('"Approval of Publishers Joining" not found on the page.');
        if (!days) fail('"Validation Period Days" not found on the page.');
        chooseNative(approval, v.approval, 'Approval of Publishers Joining');
        await setText(days, v.validationDays, 'Validation Period Days');
      },
      save: () => byId('migrated_advertiser_settings_save') || button('Save'),
      verify: v => {
        const approval = fieldByLabel('Approval of Publishers Joining', 'select');
        return [approval && same(approval.selectedOptions[0]?.text, v.approval), fieldByLabel('Validation Period Days', 'input')?.value === String(v.validationDays)];
      }
    },
    {
      key: 'prejoin', name: 'Pre-join publishers', match: /\/provider\/pre-join-publishers/,
      async fill() {
        const boxes = PUBLISHERS.map(id => [id, publisherBox(id)]);
        const missing = boxes.filter(([, box]) => !box).map(([id]) => id);
        if (missing.length === PUBLISHERS.length) return { status: 'unconfirmed', message: `Publishers ${PUBLISHERS.join(' and ')} have no tick box: they may already be pre-joined.` };
        if (missing.length) fail(`Publisher ${missing.join(', ')} not found with a tick box.`);
        for (const [id, box] of boxes) ensureChecked(box, `Publisher ${id}`);
        return null;
      },
      save: () => {
        const box = publisherBox(PUBLISHERS[0]) || publisherBox(PUBLISHERS[1]);
        const form = box && closest(box, 'form');
        return (form && [...form.querySelectorAll('button, input[type="submit"]')].find(b => visible(b) && norm(cleanText(b, NOISE) || b.value) === 'submit')) || null;
      },
      verify: () => [!PUBLISHERS.some(id => { const box = publisherBox(id); return box && !box.checked; })]
    }
  ];

  // The tick box in the row (table row, list item…) whose cell shows exactly this publisher ID.
  function publisherBox(id) {
    for (const box of shown('input[type="checkbox"]')) {
      if (box.value === id) return box;
      const row = closest(box, 'tr, li, [role="row"], .row');
      if (row && all(row, 'td, th, span, a, div, label').some(c => cleanText(c, NOISE) === id)) return box;
    }
    return null;
  }

  const pageFor = () => PAGES.find(p => p.match.test(root.location.pathname));

  async function fillPage(values, save) {
    const page = pageFor();
    if (!page) return { status: 'failed', message: `This page isn't one of the setup pages (${root.location.pathname.replace(/\d{4,}/g, '#')}).` };
    const why = page.skip && page.skip(values);
    if (why) return { status: 'skipped', message: `Skipped: ${why}.`, page: page.key };
    try {
      await settled();
      const early = await page.fill(values);
      const note = early && early.note;
      if (early && early.status) return { ...early, page: page.key };
      if (!save) return { status: 'filled', message: `Filled, not saved: check it, then save it yourself.${note ? ' ' + note : ''}`, page: page.key, note };
      return { ...(await clickSave(page.save(), 'Save')), page: page.key, note };
    } catch (error) {
      return { status: 'failed', message: error instanceof SetupError ? error.message : `Unexpected error: ${error.message}`, page: page.key, diagnostics: page.diagnose ? page.diagnose() : diagnostics() };
    }
  }

  async function verifyPage(values) {
    const page = pageFor();
    if (!page) return { status: 'failed', message: 'The page changed to something unexpected after saving.' };
    await sleep(500);
    const error = errorShown();
    if (error) return { status: 'failed', message: `The page shows an error: ${error.slice(0, 200)}`, page: page.key };
    const checks = page.verify ? page.verify(values) : [];
    if (checks.length && checks.every(Boolean)) return { status: 'saved', message: 'Saved and checked.', page: page.key };
    if (!checks.length && successShown()) return { status: 'saved', message: 'Saved.', page: page.key };
    return { status: 'unconfirmed', message: checks.length ? 'Saved, but the page doesn\'t show every value afterwards: check it.' : 'Save was clicked; the page showed no confirmation: check it.', page: page.key };
  }

  // What the page looked like when a field couldn't be found: frames are the usual reason.
  function diagnostics() {
    const frames = [...doc().querySelectorAll('iframe')].map(f => {
      let readable = false;
      try { readable = !!(f.contentDocument && f.contentDocument.body); } catch { /* another site */ }
      const r = f.getBoundingClientRect();
      return `${readable ? 'readable' : 'not readable'} frame ${Math.round(r.width)}×${Math.round(r.height)}`;
    });
    return `${shown(CONTROL).length} visible controls, ${shown(TRIGGER).length} dropdowns; ${frames.length ? frames.join(', ') : 'no frames'}`;
  }

  // Marks the tab so the result is visible in the tab strip.
  function mark(symbol) {
    doc().title = `${symbol} ${doc().title.replace(/^[✓⚠⏭✎] /, '')}`;
  }

  root.TCASetupFill = { T, PAGES, PLATFORM_APPEND, PLUGIN, PUBLISHERS, fillPage, verifyPage, pageFor, mark };

  if (root.top !== root || !root.chrome || !root.chrome.runtime || !root.chrome.runtime.onMessage) return;
  root.chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message) return undefined;
    if (message.action === 'tcaSetupFill') { fillPage(message.values, message.save).then(sendResponse); return true; }
    if (message.action === 'tcaSetupVerify') { verifyPage(message.values).then(sendResponse); return true; }
    if (message.action === 'tcaSetupMark') { mark(message.symbol); sendResponse({ ok: true }); return undefined; }
    return undefined;
  });
})(globalThis);
