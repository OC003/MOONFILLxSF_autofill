// Programme setup, stage 1 (discovery): a small panel on Awin UI pages with a read-only "Check page"
// button. Its report lists the page's form controls (label, type, options), buttons and structure so
// the setup fill can be designed for each page. It never includes typed or selected values, and
// long numbers (MIDs, IDs) and email addresses are masked. Nothing on the page is changed.
(function () {
  const { all, cleanText, visible, closest, describe } = globalThis.TCAEngine.dom;
  const isMock = location.protocol === 'file:' && /\/mock\/awin-[^/]+\.html$/.test(location.pathname);
  const isAwin = location.protocol === 'https:' && location.hostname === 'ui.awin.com';
  if ((!isMock && !isAwin) || window.top !== window || document.getElementById('tca-setup-root')) return;

  const MAX_OPTIONS = 40;
  const mask = text => String(text ?? '')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]')
    .replace(/\d{4,}/g, '#');
  const short = (text, n = 80) => { const t = String(text ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
  const NOISE = '.sr-only, .visually-hidden, script, style, svg';

  const CONTROLS = [
    'input:not([type="hidden"])', 'select', 'textarea', '[contenteditable="true"]',
    '[role="combobox"]', '[role="listbox"]', '[role="checkbox"]', '[role="switch"]', '[role="radio"]', '[role="slider"]', '[role="spinbutton"]'
  ].join(', ');
  const BUTTONS = 'button, input[type="submit"], input[type="button"], [role="button"], a.btn, a.button';

  // Text just before a node, looking up to four levels up: how many forms label their controls.
  function textBefore(node) {
    for (let n = node, depth = 0; n && depth < 4; n = n.parentElement, depth++) {
      for (let p = n.previousElementSibling; p; p = p.previousElementSibling) {
        const t = cleanText(p, NOISE);
        if (t) return [t, `text before (${depth ? `${depth} level(s) up` : 'sibling'})`];
      }
    }
    return null;
  }

  // A radio group's name: its fieldset legend or radiogroup label, else the text before the first option.
  function groupLabelOf(radio) {
    const group = closest(radio, '[role="radiogroup"], fieldset');
    if (group && group.getAttribute('aria-label')) return [group.getAttribute('aria-label'), 'radiogroup aria-label'];
    const legend = group && group.tagName === 'FIELDSET' && group.querySelector(':scope > legend');
    if (legend) return [cleanText(legend, NOISE), 'fieldset legend'];
    return textBefore(closest(radio, 'label') || radio) || ['(no group label found)', 'none'];
  }

  // The words a person would use to name a control, and where they came from.
  function labelOf(el) {
    const byIds = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean)
      .map(id => el.ownerDocument.getElementById(id)).filter(Boolean).map(n => cleanText(n, NOISE)).join(' ');
    if (byIds) return [byIds, 'aria-labelledby'];
    if (el.getAttribute('aria-label')) return [el.getAttribute('aria-label'), 'aria-label'];
    const labels = el.labels ? [...el.labels].map(l => cleanText(l, NOISE)).filter(Boolean) : [];
    if (labels.length) return [labels.join(' / '), 'label'];
    const wrap = closest(el, 'label');
    if (wrap && cleanText(wrap, NOISE)) return [cleanText(wrap, NOISE), 'wrapping label'];
    const before = textBefore(el);
    if (before) return before;
    if (el.getAttribute('placeholder')) return [el.getAttribute('placeholder'), 'placeholder'];
    if (el.title) return [el.title, 'title'];
    return ['(no label found)', 'none'];
  }

  function kindOf(el) {
    const role = el.getAttribute('role');
    const tag = el.tagName.toLowerCase();
    if (tag === 'input') return `input[type=${(el.getAttribute('type') || 'text').toLowerCase()}]`;
    if (tag === 'select') return el.multiple ? 'select (multiple)' : 'select';
    return role ? `${tag}[role=${role}]` : tag;
  }

  // Options of a dropdown or radio group: what can be chosen, never what is chosen.
  function optionsOf(el) {
    if (el.tagName === 'SELECT') return [...el.options].map(o => o.text);
    const list = el.getAttribute('aria-controls') && el.ownerDocument.getElementById(el.getAttribute('aria-controls'));
    if (list) return all(list, '[role="option"]').map(o => cleanText(o, NOISE));
    return null;
  }

  function hasValue(el) {
    if (el.tagName === 'SELECT' || el.type === 'checkbox' || el.type === 'radio' || /checkbox|switch|radio/.test(el.getAttribute('role') || '')) return null;
    if ('value' in el && el.tagName !== 'BUTTON') return el.value !== '' ? 'filled' : 'empty';
    if (el.isContentEditable) return el.textContent.trim() ? 'filled' : 'empty';
    return null;
  }

  function attrs(el) {
    const out = [];
    for (const a of ['id', 'name', 'formcontrolname', 'data-testid', 'data-test', 'data-qa']) if (el.getAttribute(a)) out.push(`${a}="${short(el.getAttribute(a), 50)}"`);
    if (el.required || el.getAttribute('aria-required') === 'true') out.push('required');
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') out.push('disabled');
    if (el.readOnly) out.push('read-only');
    return out.join(' ');
  }

  function frameworks(doc) {
    const found = [];
    if (doc.querySelector('[ng-version]')) found.push(`Angular ${doc.querySelector('[ng-version]').getAttribute('ng-version')}`);
    if (doc.querySelector('[ng-app], [ng-controller], .ng-scope')) found.push('AngularJS');
    if (doc.querySelector('[data-reactroot], #root, #__next')) found.push('React (likely)');
    if (doc.querySelector('[data-v-app], [data-server-rendered]')) found.push('Vue (likely)');
    if (globalThis.jQuery || doc.querySelector('script[src*="jquery"]')) found.push('jQuery');
    return found.join(', ') || 'none recognised';
  }

  function check(doc) {
    const lines = [];
    lines.push(`Moonfill programme setup — page check (v${(globalThis.TCA_CONFIG || {}).version || '?'})`);
    lines.push(`Page: ${isMock ? location.pathname.split('/').pop() : location.pathname}${location.search ? ' ' + location.search.replace(/=[^&]*/g, '=…') : ''}`);
    lines.push(`Title: ${short(doc.title, 120)}`);
    lines.push(`Frameworks: ${frameworks(doc)} · forms: ${doc.forms.length} · frames: ${doc.querySelectorAll('iframe').length}`);
    for (const f of [...doc.querySelectorAll('iframe')].slice(0, 5)) {
      let src = f.getAttribute('src') || '(no src)';
      try { const u = new URL(src, location.href); src = u.origin === location.origin ? u.pathname : `${u.host}${u.pathname}`; } catch { /* keep as is */ }
      lines.push(`  frame: ${src}`);
    }

    const headings = all(doc.body, 'h1, h2, h3, h4, legend, [role="heading"], [role="tab"]').filter(visible)
      .filter(h => !closest(h, '#tca-setup-root')).map(h => `${h.getAttribute('role') === 'tab' ? 'tab' : h.tagName.toLowerCase()}: ${short(cleanText(h, NOISE))}`).filter(t => !/: $/.test(t));
    lines.push('', `Headings and tabs (${headings.length}):`, ...headings.slice(0, 40).map(h => `  ${h}`));

    // A combobox's popup list is reported with the combobox, not as a control of its own.
    const popups = new Set(all(doc.body, '[aria-controls]').map(el => el.getAttribute('aria-controls')));
    const controls = all(doc.body, CONTROLS).filter(el => !closest(el, '#tca-setup-root') && !(el.getAttribute('role') === 'listbox' && popups.has(el.id)));
    const shown = controls.filter(visible);
    lines.push('', `Form controls: ${shown.length} visible (${controls.length - shown.length} hidden, not listed)`);
    const radios = new Set();
    let n = 0;
    for (const el of shown) {
      if (el.type === 'radio' && el.name) { if (radios.has(el.name)) continue; radios.add(el.name); }
      const [label, source] = el.type === 'radio' ? groupLabelOf(el) : labelOf(el);
      const section = closest(el, 'fieldset, section, form, [role="tabpanel"], .card, .panel');
      const sectionTitle = section && all(section, 'legend, h2, h3, h4').map(h => cleanText(h, NOISE)).find(Boolean);
      const state = hasValue(el);
      lines.push(`${++n}. "${short(label)}" — ${kindOf(el)}${el.type === 'radio' ? ' group' : ''}${state ? `, ${state}` : ''}`);
      lines.push(`   label from: ${source} · element: ${describe(el)}${attrs(el) ? ' ' + attrs(el) : ''}${sectionTitle ? ` · in: "${short(sectionTitle, 50)}"` : ''}`);
      let options = optionsOf(el);
      if (el.type === 'radio' && el.name) options = [...doc.querySelectorAll(`input[type="radio"][name="${CSS.escape(el.name)}"]`)].map(r => labelOf(r)[0]);
      if (!options && el.getAttribute('role') === 'listbox') options = all(el, '[role="option"]').map(o => cleanText(o, NOISE));
      if (options) {
        lines.push(options.length > MAX_OPTIONS ? `   options: ${options.length} (too many to list)` : `   options (${options.length}): ${options.map(o => short(o, 40)).join(' | ')}`);
      } else if (/combobox|listbox/.test(el.getAttribute('role') || '')) {
        lines.push('   options: shown only when opened. Open it, then run Check page again.');
      }
    }

    const buttons = all(doc.body, BUTTONS).filter(visible).filter(b => !closest(b, '#tca-setup-root'));
    lines.push('', `Buttons (${buttons.length}):`);
    for (const b of buttons.slice(0, 40)) {
      const text = short(cleanText(b, NOISE) || b.value || b.getAttribute('aria-label') || b.title || '(no text)', 60);
      lines.push(`  "${text}" — ${describe(b)}${b.type === 'submit' ? ' type=submit' : ''}${attrs(b) ? ' ' + attrs(b) : ''}`);
    }

    const alerts = all(doc.body, '[role="alert"], [role="status"], .alert, .toast, .notification').filter(visible).filter(a => !closest(a, '#tca-setup-root'));
    if (alerts.length) lines.push('', `Messages shown (${alerts.length}): ${alerts.slice(0, 5).map(a => describe(a)).join(', ')}`);
    lines.push('', 'No typed or selected values are included; long numbers and email addresses are masked.');
    return mask(lines.join('\n'));
  }

  // ---------- panel (own shadow root, like the checklist panel) ----------
  const host = document.createElement('div');
  host.id = 'tca-setup-root';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
<style>
  :host { all: initial; }
  .panel { position: fixed; right: 16px; bottom: 16px; z-index: 2147483000; width: 340px; max-width: calc(100vw - 32px);
    background: #fff; color: #181818; border: 1px solid #c9c9c9; border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,.18);
    font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  .head { display: flex; align-items: center; gap: 8px; width: 100%; padding: 8px 12px; border: 0; background: none; font: inherit; font-weight: 600; cursor: pointer; text-align: left; color: inherit; }
  .body { padding: 0 12px 12px; display: grid; gap: 8px; }
  .collapsed .body { display: none; }
  .row { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
  button.act { padding: 5px 10px; border: 1px solid #0176d3; border-radius: 4px; background: #fff; color: #0176d3; font: inherit; font-weight: 600; cursor: pointer; }
  textarea { width: 100%; box-sizing: border-box; height: 200px; font: 11px/1.35 ui-monospace, Menlo, Consolas, monospace; }
  [hidden] { display: none !important; }
  .note { color: #5c5c5c; font-size: 12px; }
</style>
<div class="panel collapsed">
  <button class="head" type="button" aria-expanded="false">🚀 Moonfill setup</button>
  <div class="body">
    <div class="note">Reads this page's layout (labels, controls, buttons) so the setup can be built for it. Changes nothing.</div>
    <div class="row"><button class="act check" type="button">Check page</button><button class="act copy" type="button" hidden>Copy report</button></div>
    <textarea readonly hidden aria-label="Page check report"></textarea>
    <div class="note status" role="status" aria-live="polite"></div>
  </div>
</div>`;
  const $ = sel => shadow.querySelector(sel);
  $('.head').addEventListener('click', () => {
    const open = $('.panel').classList.toggle('collapsed') === false;
    $('.head').setAttribute('aria-expanded', String(open));
  });
  $('.check').addEventListener('click', () => {
    let report;
    try { report = check(document); } catch (error) { report = `Page check failed: ${error.message}`; }
    $('textarea').value = report;
    $('textarea').hidden = false;
    $('.copy').hidden = false;
    $('.status').textContent = 'Check complete. Nothing was changed. Look over the report before pasting it.';
  });
  $('.copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('textarea').value); $('.status').textContent = 'Report copied.'; }
    catch { $('textarea').select(); $('.status').textContent = 'Report selected: press Ctrl+C (⌘C on Mac) to copy.'; }
  });
  (document.body || document.documentElement).appendChild(host);
  globalThis.TCASetupCheck = check;   // for tests
})();
