// Moonfill's 🔎 IR button on an Implementation record (TSE__c) opens the Internal Review panel instead of
// only opening the IR tabs. The click is caught first, in the capture phase, as the setup form does for 🚀,
// so Moonfill's own code stays unchanged. Shift-click (or "Just open the IR tabs" in the panel) still opens
// the tabs as before. Elsewhere (the Case page's IR button) nothing changes.
(function () {
  if (globalThis.__oirHook) return;
  globalThis.__oirHook = true;
  const RECORD = /\/lightning\/r\/TSE__c\/[a-zA-Z0-9]{15,18}\/view/;
  const visible = (el) => !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));

  // The MID from the record's Awin dashboard link, as the setup reads it (the panel checks it again)
  function readMid() {
    const scope = document.querySelector('.oneContent.active') || document;
    const link = Array.from(scope.querySelectorAll('a[href*="ui.awin.com/dashboard/awin/advertiser/"]')).find(visible);
    return link ? ((link.getAttribute('href').match(/advertiser\/(\d+)/) || [])[1] || '') : '';
  }

  window.addEventListener('click', (event) => {
    const button = event.target && event.target.closest && event.target.closest('button.mf-ir');
    if (!button || button.disabled || event.shiftKey || !RECORD.test(location.pathname)) return;
    event.stopImmediatePropagation();
    event.preventDefault();
    try {
      chrome.runtime.sendMessage({ action: 'oirOpenPanel', mid: readMid() }).catch(() => {});
    } catch (e) { /* extension reloaded: the page needs a refresh */ }
  }, true);

  globalThis.OIRHook = { readMid };
})();
