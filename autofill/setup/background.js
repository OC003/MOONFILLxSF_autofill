// Programme setup, stage 3 (background): runs the setup started from the 🚀 New Implementation form.
//   { action: 'tcaSetupRun', mid, values, save }  →  { ok } at once; progress goes back to the record tab
// Opens Moonfill's New Implementation pages (its NI_URLS) as a tab group, then works through them one
// at a time: fill, save, wait for the page to settle, check. A page that fails is marked ⚠ and left
// open, unsaved, and the run carries on. Pre-join publishers is retried, as it often errors once.
(function () {
  const PAGES = ['Tracking settings', 'Invite user', 'Commission groups', 'Plugin store', 'Tracking tag settings',
    'Account details', 'Fee manager', 'Mobile tracking', 'Advertiser settings', 'Pre-join publishers'];
  const T = { load: 30000, settle: 1500, reloadStart: 4000, answer: 15000, retries: 5, retryWait: 3000 };
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

  async function runPage(tabId, values, save) {
    let result;
    for (let attempt = 1; attempt <= T.retries; attempt++) {
      const filled = await ask(tabId, { action: 'tcaSetupFill', values, save });
      if (filled.status !== 'saving') return filled;
      await waitAfterSave(tabId);
      await sleep(T.settle);
      result = { ...(await ask(tabId, { action: 'tcaSetupVerify', values })), attempts: attempt };
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
    const tabs = [];
    for (const url of urls) tabs.push(await chrome.tabs.create({ url, active: false }));
    try {
      const group = await chrome.tabs.group({ tabIds: tabs.map(t => t.id) });
      await chrome.tabGroups.update(group, { title: `${mid} setup`, color: 'cyan' });
    } catch { /* grouping is a nicety */ }

    const results = [];
    for (let i = 0; i < tabs.length; i++) {
      progress({ index: i, name: PAGES[i], status: 'working' });
      let result;
      try {
        await waitForLoad(tabs[i].id);
        await sleep(T.settle);
        result = await runPage(tabs[i].id, values, save);
      } catch (error) {
        result = { status: 'failed', message: `Unexpected error: ${error.message}` };
      }
      results.push({ name: PAGES[i], ...result });
      chrome.tabs.sendMessage(tabs[i].id, { action: 'tcaSetupMark', symbol: SYMBOL[result.status] || '⚠' }).catch(() => {});
      progress({ index: i, name: PAGES[i], status: result.status, message: result.message, diagnostics: result.diagnostics });
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

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.action !== 'tcaSetupRun') return undefined;
    const mid = String(message.mid || '').replace(/\D/g, '');
    if (!mid || !message.values) { sendResponse({ ok: false, error: 'No MID or values.' }); return undefined; }
    sendResponse({ ok: true });
    run({ mid, values: message.values, save: !!message.save }, sender && sender.tab ? sender.tab.id : null)
      .catch(error => console.error('Moonfill setup failed', error));
    return undefined;
  });

  globalThis.TCASetupRunner = { run, PAGES, T };   // for tests
})();
