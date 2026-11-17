// Programme setup, stage 3 (background): runs the setup started from the 🚀 New Implementation form.
//   { action: 'tcaSetupRun', mid, values, save }  →  { ok } at once; progress goes back to the record tab
// Opens Moonfill's New Implementation pages (its NI_URLS) as a tab group, then works through them one
// at a time: fill, save, wait for the page to settle, check. A page that fails is marked ⚠ and left
// open, unsaved, and the run carries on. Pre-join publishers is retried, as it often errors once.
(function () {
  const PAGES = ['Tracking settings', 'Invite user', 'Commission groups', 'Plugin store', 'Tracking tag settings',
    'Account details', 'Fee manager', 'Mobile tracking', 'Advertiser settings', 'Pre-join publishers'];
  const T = { load: 30000, settle: 4000, reloadStart: 4000, answer: 15000, retries: 5, retryWait: 3000, reloadDelay: 5000, signinWaits: 4, pageLimit: 120000 };
  // Pages reloaded before filling (by position): Tracking tag settings often doesn't load fully first time.
  const RELOAD_FIRST = new Set([4]);
  // Pages that come pre-filled (Invite user, Fee manager): opened for reference, never filled.
  const ALWAYS_SKIPPED = new Set([1, 6]);
  // The Plugin store page isn't needed for Access programmes: skipped without touching it.
  const PLUGIN_PAGE = 3;
  const SYMBOL = { saved: '✓', filled: '✎', skipped: '⏭', unconfirmed: '⚠', failed: '⚠' };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  // Resolves once the tab has finished loading (at once if it already has).
  function waitForLoad(tabId, timeout = T.load) {
    return new Promise(resolve => {
      let timer;
      const done = () => { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(onUpdated); resolve(); };
      const onUpdated = (id, info) => { if (id === tabId && info.status === 'complete') done(); };
      chrome.tabs.onUpdated.addListener(onUpdated);
      timer = setTimeout(done, timeout);
      chrome.tabs.get(tabId).then(tab => { if (tab.status === 'complete') done(); }, done);
    });
  }

  // After Save: a classic form reloads the page; a newer page doesn't. Wait for whichever happens.
  function waitAfterSave(tabId) {
    return new Promise(resolve => {
      let timer;
      const finish = () => { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(onUpdated); resolve(); };
      const onUpdated = (id, info) => {
        if (id !== tabId || info.status !== 'loading') return;
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        waitForLoad(tabId).then(resolve);
      };
      chrome.tabs.onUpdated.addListener(onUpdated);
      timer = setTimeout(finish, T.reloadStart);
    });
  }

  // Reloads a tab and resolves once it has loaded again.
  function reload(tabId) {
    return new Promise(resolve => {
      let timer;
      const onUpdated = (id, info) => {
        if (id !== tabId || info.status !== 'loading') return;
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        waitForLoad(tabId).then(resolve);
      };
      chrome.tabs.onUpdated.addListener(onUpdated);
      timer = setTimeout(() => { chrome.tabs.onUpdated.removeListener(onUpdated); waitForLoad(tabId).then(resolve); }, T.reloadStart);
      chrome.tabs.reload(tabId).catch(() => {});
    });
  }

  // Message the page, retrying while its script is still starting up.
  async function ask(tabId, message) {
    const end = Date.now() + T.answer;
    for (;;) {
      try {
        const answer = await chrome.tabs.sendMessage(tabId, message);
        if (answer) return answer;
      } catch (error) {
        if (Date.now() > end) return { status: 'failed', message: `The page didn't respond (${error.message}). Is it signed in?` };
      }
      if (Date.now() > end) return { status: 'failed', message: 'The page didn\'t respond.' };
      await sleep(500);
    }
  }

  // Asks the page to fill itself; if it's on Awin's sign-in pages (a redirect still going on), waits
  // for it to come back to the setup page first.
  async function fillWhenReady(tabId, values, save) {
    for (let wait = 0; ; wait++) {
      const filled = await ask(tabId, { action: 'tcaSetupFill', values, save });
      if (filled.status !== 'signin') return filled;
      if (wait >= T.signinWaits) {
        return { status: 'failed', message: filled.login ? 'Awin asked to sign in again in this tab. Sign in to Awin, then run the setup again.' : `${filled.message} It didn't return to the setup page.` };
      }
      await waitAfterSave(tabId);   // a redirect: wait for the next page load
      await sleep(T.settle);
    }
  }

  async function runPage(tabId, values, save) {
    let result;
    for (let attempt = 1; attempt <= T.retries; attempt++) {
      const filled = await fillWhenReady(tabId, values, save);
      if (filled.status !== 'saving') return filled;
      await waitAfterSave(tabId);
      await sleep(T.settle);
      result = { ...(await ask(tabId, { action: 'tcaSetupVerify', values })), attempts: attempt };
      if (filled.note) Object.assign(result, { message: `${result.message} ${filled.note}`, note: filled.note });
      // Only Pre-join publishers is retried: it often shows an error on the first try.
      if (result.status !== 'failed' || filled.page !== 'prejoin') return result;
      if (attempt < T.retries) await sleep(T.retryWait);
    }
    return { ...result, message: `${result.message} (tried ${T.retries} times)` };
  }

  async function run({ mid, values, save }, recordTabId) {
    const progress = update => chrome.tabs.sendMessage(recordTabId, { action: 'tcaSetupProgress', ...update }).catch(() => {});
    const urls = typeof NI_URLS === 'function' ? NI_URLS(mid) : null;   // Moonfill's page list (background.js)
    if (!urls || urls.length !== PAGES.length) {
      progress({ done: true, error: 'Moonfill\'s list of New Implementation pages has changed, so the setup can\'t run. Use "Just open the tabs".' });
      return;
    }
    // Tabs open one at a time, as each page's turn comes: opening all ten at once sends some of them
    // to Awin's sign-in pages.
    const tabs = [];
    let group = null;
    const open = async i => {
      const tab = await chrome.tabs.create({ url: urls[i], active: false });
      tabs[i] = tab;
      try {
        if (group === null) { group = await chrome.tabs.group({ tabIds: [tab.id] }); await chrome.tabGroups.update(group, { title: `${mid} setup`, color: 'cyan' }); }
        else await chrome.tabs.group({ groupId: group, tabIds: [tab.id] });
      } catch { /* grouping is a nicety */ }
      return tab;
    };

    const results = [];
    for (let i = 0; i < urls.length; i++) {
      progress({ index: i, name: PAGES[i], status: 'working' });
      await open(i);
      let result;
      const skip = ALWAYS_SKIPPED.has(i) ? 'comes pre-filled' : i === PLUGIN_PAGE && values.platformOffer === 'Access' ? 'not needed for Access' : null;
      if (skip) {
        result = { status: 'skipped', message: `Skipped: ${skip}.` };
        results.push({ name: PAGES[i], ...result });
        chrome.tabs.sendMessage(tabs[i].id, { action: 'tcaSetupMark', symbol: SYMBOL.skipped }).catch(() => {});
        progress({ index: i, name: PAGES[i], status: result.status, message: result.message });
        continue;
      }
      try {
        await waitForLoad(tabs[i].id);
        if (RELOAD_FIRST.has(i)) {
          progress({ index: i, name: PAGES[i], status: 'working', message: 'reloading the page first' });
          await sleep(T.reloadDelay);
          await reload(tabs[i].id);
        }
        await sleep(T.settle);
        // A page that never answers (for example after the Awin session expired) can't hold up the run.
        let timer;
        const limit = new Promise(resolve => { timer = setTimeout(() => resolve({ status: 'failed', message: `No result after ${Math.round(T.pageLimit / 1000)} s. If your Awin session has expired, sign in and run the setup again.` }), T.pageLimit); });
        result = await Promise.race([runPage(tabs[i].id, values, save), limit]);
        clearTimeout(timer);
      } catch (error) {
        result = { status: 'failed', message: `Unexpected error: ${error.message}` };
      }
      results.push({ name: PAGES[i], ...result });
      chrome.tabs.sendMessage(tabs[i].id, { action: 'tcaSetupMark', symbol: SYMBOL[result.status] || '⚠' }).catch(() => {});
      progress({ index: i, name: PAGES[i], status: result.status, message: result.message, note: result.note, diagnostics: result.diagnostics });
    }

    const needsLook = results.filter(r => r.status === 'failed' || r.status === 'unconfirmed');
    const count = s => results.filter(r => r.status === s).length;
    const summary = [count('saved') && `${count('saved')} saved`, count('filled') && `${count('filled')} filled (not saved)`,
      count('skipped') && `${count('skipped')} skipped`, needsLook.length && `${needsLook.length} need a look`].filter(Boolean).join(', ');
    progress({ done: true, summary });
    try {
      chrome.notifications.create(`tcaSetup-${mid}-${Date.now()}`, {
        type: 'basic', iconUrl: 'assets/icon128.png', title: `Setup for MID ${mid}: ${needsLook.length ? 'needs a look' : 'done'}`,
        message: `${summary}.${needsLook.length ? ' ' + needsLook.map(r => `${r.name}: ${r.message}`).join(' ') : ''}`.slice(0, 400)
      });
    } catch { /* notifications are a nicety */ }
    if (globalThis.TCAUsageWorker) {
      globalThis.TCAUsageWorker.add({ tool: 'New Implementation', action: 'setup', outcome: needsLook.length ? 'failed' : 'success', reason: 'setup-page-failed', tc: values.assignedTc });
    }
    return results;
  }

  // Runs in the page's own world (not the extension's), where code editors keep their controls:
  // sets the text of the editor marked data-tca-code-target. CodeMirror 5 and 6, Ace and Monaco.
  function setEditorInPage(code) {
    const el = document.querySelector('[data-tca-code-target]');
    if (!el) return { error: 'editor not found' };
    try {
      if (el.CodeMirror && el.CodeMirror.setValue) { el.CodeMirror.setValue(code); if (el.CodeMirror.save) el.CodeMirror.save(); return { editor: 'CodeMirror' }; }
      const cm6 = el.cmView && el.cmView.view || (el.querySelector('.cm-content') || {}).cmView && el.querySelector('.cm-content').cmView.view;
      if (cm6 && cm6.dispatch) { cm6.dispatch({ changes: { from: 0, to: cm6.state.doc.length, insert: code } }); return { editor: 'CodeMirror 6' }; }
      if (el.env && el.env.editor && el.env.editor.setValue) { el.env.editor.setValue(code, 1); return { editor: 'Ace' }; }
      if (window.ace && window.ace.edit && el.classList.contains('ace_editor')) { window.ace.edit(el).setValue(code, 1); return { editor: 'Ace' }; }
      if (window.monaco && window.monaco.editor) {
        const editor = window.monaco.editor.getEditors().find(e => el.contains(e.getDomNode()) || e.getDomNode().contains(el));
        if (editor) { editor.setValue(code); return { editor: 'Monaco' }; }
      }
      return { error: 'no editor controls found' };
    } catch (error) {
      return { error: String(error.message || error) };
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.action !== 'tcaSetupSetEditor') return undefined;
    const tab = sender && sender.tab;
    if (!tab || !/^https:\/\/ui\.awin\.com\//.test(sender.url || tab.url || '')) { sendResponse({ error: 'not an Awin page' }); return undefined; }
    chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [sender.frameId || 0] }, world: 'MAIN', func: setEditorInPage, args: [String(message.code)] })
      .then(([frame]) => sendResponse((frame && frame.result) || { error: 'no result' }), error => sendResponse({ error: error.message }));
    return true;
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.action !== 'tcaSetupRun') return undefined;
    const mid = String(message.mid || '').replace(/\D/g, '');
    if (!mid || !message.values) { sendResponse({ ok: false, error: 'No MID or values.' }); return undefined; }
    if (/^0+$/.test(mid)) { sendResponse({ ok: false, error: 'the MID is 0: the advertiser hasn\'t been created in Awin yet.' }); return undefined; }
    sendResponse({ ok: true });
    run({ mid, values: message.values, save: !!message.save }, sender && sender.tab ? sender.tab.id : null)
      .catch(error => console.error('Moonfill setup failed', error));
    return undefined;
  });

  globalThis.TCASetupRunner = { run, PAGES, T, RELOAD_FIRST, setEditorInPage };   // for tests
})();
