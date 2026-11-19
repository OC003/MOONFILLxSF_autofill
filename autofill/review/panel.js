// The Internal Review panel (Optimus IR's popup, folded into the AutoSetup prototype). Moonfill's 🔎 IR
// button on an Implementation record opens it in a small window of its own, tied to that record's tab
// (?tab=<id>&mid=<MID from the record>). Start a review (MID + "signed in" are required), and follow
// every run step by step, like Moonfill's scan cards.
// What the prototype adds: the MID comes from the record, the Awin sign-in is checked by itself (as the
// setup does), and "Just open the IR tabs" does what the 🔎 IR button always did.
const C = window.OIRChecks;
const OIR_VERSION = "0.2.23";
const PREFIX = "oirRun_";
const DONE_VISIBLE_MS = 10 * 60 * 1000;
const ACTIVE = ["running", "applying", "salesforce"];
const STATE = {
  running: "Reading the Awin UI…", applying: "Fixing…", salesforce: "Updating Salesforce…",
  waiting_sf: "Salesforce step pending", done: "Done", blocked: "Stopped", failed: "Failed"
};
const ICON = { running: null, ok: "✅", fail: "❌", skip: "➖" };
const RES = { pass: "✅", fail: "❌", review: "⚠️", skipped: "➖" };

let view = "scans";
let activeTab = null;
let copied = "";

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid.nodeType ? kid : String(kid));
  return el;
}

// ---------- start ----------
// The MID and "signed in" are on screen at once. Meanwhile the record tab is asked, in this
// order, for (1) the "Implementation Checklist" Chatter post and (2) the record's fields.
// The contract-input form appears only if the post is missing (or misses items).
const L = window.OIRLog;
const CONTENT_FILES = ["lib/log.js", "lib/fields.js", "lib/checks.js", "content/salesforce.js"].map((f) => "autofill/review/" + f);
const PARAMS = new URLSearchParams(location.search);
const RECORD_URL = /\/lightning\/r\/TSE__c\/([a-zA-Z0-9]{15,18})\/view/;
// The record tab this panel belongs to: the one in ?tab=, else an Implementation record in front
async function recordTab() {
  const id = Number(PARAMS.get("tab"));
  if (id) { const t = await chrome.tabs.get(id).catch(() => null); if (t) return t; }
  const tabs = await chrome.tabs.query({ active: true }).catch(() => []);
  return tabs.find((t) => RECORD_URL.test(t.url || "")) || tabs[0] || null;
}
// Signed in to Awin? The setup's own check (a classic Awin page, fetched with the browser's cookies)
const sessionCheck = (mid) => chrome.runtime.sendMessage({ action: "tcaSetupCheckSession", mid }).catch((e) => ({ signedIn: null, detail: e.message }));
async function askTab(tabId, action, extra) {
  const send = () => chrome.tabs.sendMessage(tabId, { action, ...(extra || {}) });
  try { return await send(); }
  catch (e) {
    // tab opened before the extension was (re)loaded: inject the content script once
    L.warn("popup", `${action}: no answer from the page (${e.message}); injecting the script`);
    await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_FILES });
    return send();
  }
}

// After Run, or when a review of this record is running / just finished: no automatic Chatter
// search, only a button to start a new review (the form starts empty)
function startAgainBox(text) {
  const box = document.getElementById("start");
  box.textContent = "";
  box.append(h("div", { class: "box" }, h("div", {}, text),
    h("button", { class: "primary", onclick: () => renderStart({ force: true }) }, "Start a new review")));
}
const RECENT_MS = 10 * 60 * 1000;

async function renderStart(opts = {}) {
  const box = document.getElementById("start");
  box.textContent = "";
  activeTab = await recordTab();
  const recId = ((activeTab && activeTab.url) || "").match(RECORD_URL);
  if (!opts.force && recId) {
    const all = await chrome.storage.local.get(null);
    const recent = Object.keys(all).filter((k) => k.startsWith(PREFIX)).map((k) => all[k])
      .filter((r) => r.recordId === recId[1] && (ACTIVE.includes(r.state) || Date.now() - (r.finishedAt || 0) < RECENT_MS))
      .sort((a, b) => b.startedAt - a.startedAt)[0];
    if (recent) {
      startAgainBox(ACTIVE.includes(recent.state)
        ? `A review of MID ${recent.awinId} is running for this record: follow it below.`
        : `A review of MID ${recent.awinId} finished ${Math.round((Date.now() - recent.finishedAt) / 60000)} min ago for this record: see it below.`);
      return;
    }
  }
  const draft = (await chrome.storage.session.get("oirDraft")).oirDraft || {};

  const pick = (name, opts, cur) => h("select", { name }, ...opts.map((o) => h("option", { value: o, selected: o === cur }, o)));
  const yn = (name, cur) => h("div", { class: "yn" }, ...["Yes", "No"].map((v) => h("label", {}, h("input", { type: "radio", name, value: v, checked: cur === (v === "Yes") }), " " + v)));
  const title = h("h2", {}, "Internal Review");
  const midInput = h("input", { type: "text", name: "mid", class: "mid", inputmode: "numeric", autocomplete: "off", placeholder: "MID, e.g. 131913", value: PARAMS.get("mid") || draft.mid || "" });
  const signed = h("input", { type: "checkbox", name: "signedIn", checked: !!draft.signedIn });
  const session = h("div", { class: "muted" });
  const midFrom = h("div", { class: "muted" }, PARAMS.get("mid") ? "From the record." : "");
  const clStatus = h("div", { class: "muted" });
  const clFields = h("div", {});
  const recStatus = h("div", { class: "muted" });
  const err = h("div", { class: "err" });
  const run = h("button", { type: "submit", class: "primary", disabled: true }, "Run Internal Review");
  const form = h("form", {}, title,
    h("label", { class: "row" }, h("span", {}, "MID of the programme to review"), midInput, midFrom),
    h("label", { class: "check" }, signed, h("span", {}, "I'm signed in to ui.awin.com in this browser")),
    session, clStatus, clFields, recStatus, err, run,
    h("button", { type: "button", class: "tabs-only", title: "What the 🔎 IR button used to do: the 11 Internal Review pages as a tab group, nothing filled or checked",
      onclick: () => { const mid = midInput.value.trim(); if (/^\d{3,}$/.test(mid)) chrome.runtime.sendMessage({ action: "createIRTabs", mid }); else err.textContent = "enter the MID"; } }, "Just open the IR tabs"),
    h("div", { class: "muted" }, "Runs in background tabs: you can keep working. Fixes are applied automatically, test transactions are deleted, Salesforce is updated and a short report is posted to Chatter."));
  box.append(h("div", { class: "box" }, form));
  midInput.focus();

  // The Awin sign-in, checked by itself: ticks the box when signed in, offers a sign-in when not.
  // (Can't tell: the box stays for the TC to tick.) Checked again when the MID changes.
  let checkedFor = "";
  async function checkSession() {
    const mid = midInput.value.trim();
    if (!/^\d{3,}$/.test(mid) || mid === checkedFor) return;
    checkedFor = mid;
    spin(session, "Checking you're signed in to Awin…");
    const a = await sessionCheck(mid);
    if (midInput.value.trim() !== mid) return;
    session.textContent = "";
    if (a && a.signedIn === true) {
      signed.checked = true;
      session.append(h("div", { class: "ok-line" }, "✅ Signed in to Awin"));
    } else if (a && a.signedIn === false) {
      signed.checked = false;
      session.append(h("div", { class: "warn-line" }, `Not signed in to Awin (${a.detail || "sign-in asked"}). `,
        h("button", { type: "button", onclick: () => chrome.tabs.create({ url: "https://ui.awin.com/", windowId: activeTab ? activeTab.windowId : undefined, active: true }) }, "Sign in to Awin"),
        h("button", { type: "button", onclick: () => { checkedFor = ""; checkSession(); } }, "Check again")));
    } else session.append(h("div", { class: "muted" }, `Couldn't check the Awin sign-in${a && a.detail ? ` (${a.detail})` : ""}: tick the box if you are signed in.`));
    validate();
  }
  midInput.addEventListener("change", checkSession);
  midInput.addEventListener("input", () => { midFrom.textContent = ""; });
  // The MID, when the 🔎 click couldn't read it: from the setup note, then the record's Awin Program ID
  // (MID 0 = the advertiser isn't created in Awin yet: never used)
  function fillMid(mid, from) {
    mid = String(mid || "").trim();
    if (midInput.value.trim() || !/^\d{3,}$/.test(mid)) return;
    midInput.value = mid;
    midFrom.textContent = `From ${from}.`;
    checkSession();
    validate();
  }

  const state = { checklist: null, record: null, missing: [], pre: {}, tabError: "" };
  const spin = (el, text) => { el.textContent = ""; el.append(h("span", { class: "spin" }), " " + text); };

  const values = () => {
    const fd = new FormData(form);
    const v = (k) => (fd.get(k) === null ? undefined : String(fd.get(k)).trim());
    const inputs = Object.assign({}, state.pre);
    if (v("commissionType") !== undefined) { inputs.commissionType = v("commissionType"); inputs.commissionValue = v("commissionValue"); }
    if (fd.get("autoApprove") !== null) inputs.autoApprove = fd.get("autoApprove") === "Yes";
    if (v("validationDays") !== undefined) inputs.validationDays = /^\d+$/.test(v("validationDays")) ? Number(v("validationDays")) : null;
    if (v("trackingFeeType") !== undefined) { inputs.trackingFeeType = v("trackingFeeType"); inputs.trackingFeeValue = v("trackingFeeValue"); }
    if (v("offerOverride") !== undefined) inputs.offerOverride = v("offerOverride");
    return { mid: v("mid") || "", signedIn: fd.get("signedIn") !== null, inputs };
  };
  const validate = () => {
    const { mid, signedIn, inputs } = values();
    chrome.storage.session.set({ oirDraft: { mid, signedIn } });
    const problems = [];
    if (!/^\d{3,}$/.test(mid)) problems.push("enter the MID");
    else if (state.record && /^\d+$/.test(String(state.record.sf.awinId || "")) && state.record.sf.awinId !== mid) problems.push(`this record's Awin Program ID is ${state.record.sf.awinId}`);
    if (!signedIn) problems.push("tick “signed in”");
    if (state.tabError) problems.push(state.tabError);
    else if (!state.checklist || !state.record) problems.push("still reading the record…");
    else { const miss = C.missingInputs(inputs); if (miss.length) problems.push("missing: " + miss.join(", ")); }
    run.disabled = problems.length > 0;
    err.textContent = mid || signedIn ? problems.join(" · ") : "";
    return !problems.length;
  };
  form.addEventListener("input", validate);
  form.addEventListener("change", validate);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!validate()) return;
    const { mid, signedIn, inputs } = values();
    run.disabled = true;
    const cl = state.checklist;
    const collected = { recordId: state.record.recordId, recordUrl: state.record.recordUrl, sf: state.record.sf, checklist: cl };
    const res = await chrome.runtime.sendMessage({
      action: "oirStart", mid, signedIn, inputs, tabId: activeTab.id, collected,
      inputsSource: [cl.setupNote && "setup note", cl.checklistPost && "checklist", (!cl.found || state.missing.length) && "form"].filter(Boolean).join(" + ") || "form"
    });
    if (!res || !res.ok) { L.error("popup", "could not start:", res && res.error); err.textContent = (res && res.error) || "Could not start."; run.disabled = false; return; }
    L.info("popup", `review started for MID ${mid}`, res.runId);
    // clear the form and its saved draft, so reopening the popup does not start over
    await chrome.storage.session.remove("oirDraft");
    form.reset();
    startAgainBox(`Review of MID ${mid} started: follow it below.`);
  });
  validate();
  checkSession();

  const isRecord = activeTab && RECORD_URL.test(activeTab.url || "");
  if (!isRecord) {
    state.tabError = "open an Implementation record in Salesforce";
    clStatus.textContent = "Open an Implementation record (TSE) in Salesforce, then click the icon again.";
    validate();
    return;
  }

  // 1. Chatter first
  // the record tab stays on Chatter (loading older posts if needed) until the post is read
  const t0 = Date.now();
  spin(clStatus, "Looking for the setup note and “Implementation Checklist” in Chatter…");
  const tick = setInterval(() => spin(clStatus, `Looking for the setup note and “Implementation Checklist” in Chatter… ${Math.round((Date.now() - t0) / 1000)} s (staying on Chatter, loading older posts if needed)`), 1000);
  let cl;
  const midNow = midInput.value.trim();
  try { cl = await askTab(activeTab.id, "oirChecklist", /^\d{3,}$/.test(midNow) ? { mid: midNow } : {}); } catch (e) { cl = { ok: false, error: e.message }; }
  clearInterval(tick);
  if (!cl || !cl.ok) {
    L.error("popup", "reading the Chatter failed:", cl && cl.error);
    state.tabError = "could not read the record: reload the Salesforce page";
    clStatus.textContent = ""; clStatus.append(h("div", { class: "err" }, (cl && cl.error) || "Could not read the record. Reload the page and try again."));
    validate();
    return;
  }
  state.checklist = cl.checklist;
  if (cl.checklist.setupNote) fillMid(cl.checklist.setupNote.mid, "the setup note");
  state.pre = cl.checklist.inputs || {};
  state.missing = cl.checklist.found ? cl.checklist.missing : C.missingInputs({});
  clStatus.textContent = "";
  const k = cl.checklist;
  // where the inputs come from: the setup note (the source of truth), the checklist post, the form
  const from = k.setupNote ? (k.checklistPost ? "the setup note (approval from “Implementation Checklist”)" : "the setup note") : "“Implementation Checklist”";
  if (!k.found) clStatus.append(h("div", { class: "warn-line" }, `No setup note and no “Implementation Checklist” in the ${k.posts || 0} post(s) of this record's Chatter. Fill in the inputs:`));
  else if (state.missing.length) clStatus.append(h("div", { class: "warn-line" }, `Read from ${from}, but some inputs are missing. Fill them in:`));
  else clStatus.append(h("div", { class: "ok-line" }, `✅ From ${from}: `, C.inputsLine(state.pre)));
  if (k.setupNote && k.setupNote.mid && midInput.value.trim() && k.setupNote.mid !== midInput.value.trim()) clStatus.append(h("div", { class: "warn-line" }, `The setup note is for MID ${k.setupNote.mid}.`));
  for (const d of k.differences || []) clStatus.append(h("div", { class: "muted" }, `Setup note used: ${d}.`));
  const pre = state.pre, m = state.missing;
  if (m.includes("Base commission")) clFields.append(h("label", { class: "row" }, h("span", {}, "Base commission"),
    h("div", { class: "pair" }, pick("commissionType", ["Percentage", "Fixed"], pre.commissionType || "Percentage"), h("input", { type: "text", name: "commissionValue", value: pre.commissionValue || "", placeholder: "8" }))));
  // (auto-approve and the tracking fee are optional now: manual approval as the setup; the fee comes by default)
  if (m.includes("Auto-approve publishers")) clFields.append(h("div", { class: "row" }, h("span", {}, "Auto-approve publishers"), yn("autoApprove", pre.autoApprove)));
  if (m.includes("Validation period in contract")) clFields.append(h("label", { class: "row" }, h("span", {}, "Validation period (days)"), h("input", { type: "text", name: "validationDays", value: pre.validationDays ?? "", placeholder: "30" })));
  if (m.includes("Tracking fee")) clFields.append(h("label", { class: "row" }, h("span", {}, "Tracking fee"),
    h("div", { class: "pair" }, pick("trackingFeeType", ["Percentage", "Fixed"], pre.trackingFeeType || "Percentage"), h("input", { type: "text", name: "trackingFeeValue", value: pre.trackingFeeValue || "", placeholder: "30" }))));
  if (m.includes("Platform Offer")) clFields.append(h("label", { class: "row" }, h("span", {}, "Platform Offer"),
    h("select", { name: "offerOverride" }, h("option", { value: "" }, "Choose…"), ...["Access", "Accelerate", "Advanced"].map((o) => h("option", { value: o, selected: pre.offerOverride === o }, o)))));
  validate();

  // 2. Record fields
  spin(recStatus, "Reading the record's fields…");
  let rec;
  try { rec = await askTab(activeTab.id, "oirRecord"); } catch (e) { rec = { ok: false, error: e.message }; }
  if (!rec || !rec.ok) {
    L.error("popup", "reading the record failed:", rec && rec.error);
    state.tabError = "could not read the record's fields";
    recStatus.textContent = ""; recStatus.append(h("div", { class: "err" }, (rec && rec.error) || "Could not read the record's fields."));
    validate();
    return;
  }
  state.record = rec;
  fillMid(rec.sf.awinId, "the record's Awin Program ID");
  title.textContent = rec.sf.name || "Implementation record";
  recStatus.textContent = rec.sf.awinId ? `Record: Awin Program ID ${rec.sf.awinId}` : "Record read (no Awin Program ID on it)";
  validate();
}

// ---------- runs ----------
function stepList(run) {
  return h("ul", { class: "steps" }, ...(run.steps || []).map((s) =>
    h("li", { class: s.status }, h("span", { class: "ic" }, s.status === "running" ? h("span", { class: "spin" }) : ICON[s.status] || ""),
      h("span", {}, s.label, s.detail ? h("span", { class: "d" }, s.detail) : null))));
}

function card(run) {
  const el = h("div", { class: `box run ${run.state}` });
  el.append(h("div", {}, h("b", {}, run.name || "Programme"), ` · MID ${run.awinId}`));
  el.append(h("div", { class: "status" }, STATE[run.state] || run.state, run.error ? `: ${run.error}` : ""));
  el.append(h("div", { class: "muted" }, `Inputs (${run.inputsSource || "form"}): ${C.inputsLine(run.inputs)}`));
  if (view === "history") el.append(h("div", { class: "muted" }, new Date(run.startedAt).toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })));

  if (run.result && !ACTIVE.includes(run.state)) {
    const n = (k) => run.result.checks.filter((c) => c.result === k).length;
    el.append(h("div", { class: "counts" }, ...["pass", "fail", "review", "skipped"].map((k) => h("span", { class: k }, `${n(k)} ${k}`))));
  }
  const showSteps = ACTIVE.includes(run.state) || view === "history" || run.state !== "done";
  if (showSteps) el.append(stepList(run));
  else el.append(h("details", {}, h("summary", {}, "Steps"), stepList(run)));

  if (run.result) {
    const list = h("ul", { class: "checks" });
    let area = null;
    for (const c of run.result.checks) {
      if (c.area !== area) { area = c.area; list.append(h("li", { class: "area" }, area)); }
      list.append(h("li", {}, `${RES[c.result] || ""} ${c.check}: ${c.ui}${c.expected ? ` (expected ${c.expected})` : ""}${c.note ? ` · ${c.note}` : ""}`));
    }
    el.append(h("details", {}, h("summary", {}, "All checks"), list));
  }
  if (run.chatterText) el.append(h("details", {}, h("summary", {}, "Chatter comment"), h("pre", {}, run.chatterText)));

  const btns = h("div", {});
  if (["waiting_sf", "done"].includes(run.state) && (!(run.sfUpdate && run.sfUpdate.ok) || !(run.chatter && run.chatter.ok))) {
    btns.append(h("button", { class: "primary", onclick: () => chrome.runtime.sendMessage({ action: "oirRetrySf", runId: run.id }) }, "Retry Salesforce + Chatter"));
  }
  if (run.result) btns.append(h("button", { onclick: async () => {
    const r = await chrome.runtime.sendMessage({ action: "oirChatterText", runId: run.id });
    if (r && r.ok) { await navigator.clipboard.writeText(r.text); copied = run.id + "c"; renderRuns(); setTimeout(() => { copied = ""; renderRuns(); }, 2500); }
  } }, copied === run.id + "c" ? "Copied ✓" : "Copy Chatter text"));
  btns.append(h("button", { title: "Steps, warnings and errors of this run (also in the console, filter “[Optimus IR]”)", onclick: async () => {
    const log = [`Optimus IR v${run.version} · MID ${run.awinId} · ${run.state}${run.error ? " · " + run.error : ""}`,
      ...(run.steps || []).map((x) => `${x.status.toUpperCase()} ${x.label}${x.detail ? " · " + x.detail : ""}`), "", ...(run.log || [])].join("\n");
    await navigator.clipboard.writeText(log); copied = run.id + "l"; renderRuns(); setTimeout(() => { copied = ""; renderRuns(); }, 2500);
  } }, copied === run.id + "l" ? "Copied ✓" : "Copy debug log"));
  if (!ACTIVE.includes(run.state)) {
    btns.append(h("button", { title: "Opens the Awin pages again and records their structure (labels, ids, columns; no values)",
      onclick: () => chrome.runtime.sendMessage({ action: "oirDescribe", runId: run.id }) }, "Describe pages"));
  }
  if (run.diagnostics) btns.append(h("button", { onclick: async () => {
    await navigator.clipboard.writeText(JSON.stringify(run.diagnostics, null, 2)); copied = run.id + "d"; renderRuns(); setTimeout(() => { copied = ""; renderRuns(); }, 2500);
  } }, copied === run.id + "d" ? "Copied ✓" : "Copy page structure"));
  el.append(btns);
  if (!ACTIVE.includes(run.state)) el.append(h("button", { class: "x", title: "Remove", onclick: () => chrome.storage.local.remove(PREFIX + run.id) }, "×"));
  return el;
}

async function renderRuns() {
  const all = await chrome.storage.local.get(null);
  const now = Date.now();
  let runs = Object.keys(all).filter((k) => k.startsWith(PREFIX)).map((k) => all[k]).sort((a, b) => b.startedAt - a.startedAt);
  if (view === "scans") runs = runs.filter((r) => ACTIVE.includes(r.state) || r.state === "waiting_sf" || now - (r.finishedAt || now) < DONE_VISIBLE_MS);
  const box = document.getElementById("runs");
  // keep open <details> open across re-renders
  const openKeys = new Set(Array.from(box.querySelectorAll("details[open]")).map((d) => d.dataset.k));
  box.textContent = "";
  runs.forEach((r) => {
    const c = card(r);
    c.querySelectorAll("details").forEach((d, i) => { d.dataset.k = r.id + i; if (openKeys.has(d.dataset.k)) d.open = true; });
    box.append(c);
  });
  document.getElementById("historyBtn").textContent = view === "history" ? "← Back" : "History";
  const empty = document.getElementById("empty");
  empty.textContent = runs.length ? "" : view === "history" ? "No reviews yet." : "";
}

document.addEventListener("DOMContentLoaded", () => {
  const m = chrome.runtime.getManifest();
  document.getElementById("v").textContent = `v${OIR_VERSION} · ${m.version_name || m.version}`;
  document.getElementById("opts").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("autofill/options.html#review") }));
  document.getElementById("historyBtn").addEventListener("click", () => { view = view === "history" ? "scans" : "history"; renderRuns(); });
  renderStart();
  renderRuns();
  chrome.storage.onChanged.addListener((c, area) => { if (area === "local" && Object.keys(c).some((k) => k.startsWith(PREFIX))) renderRuns(); });
});
