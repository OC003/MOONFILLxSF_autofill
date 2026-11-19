// The Internal Review with the setup (AutoSetup prototype, the user's rules of 2026-11-19):
// - the setup's Chatter note is the source of truth; the "Implementation Checklist" post fills the gaps
// - the tracking fee is optional; approval is manual (as the setup) unless the contract says otherwise
// - 0 days in the contract -> -1 (not Access); Shopify stores: the website isn't compared with the record
// - the setup's query string stands: the record follows it, not the other way round
// - the review reads pages with the details the setup found on the live pages
const test = require("node:test");
const assert = require("node:assert");
const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");
const review = path.join(__dirname, "..", "..", "review");
require(path.join(review, "lib/fields.js"));
const C = require(path.join(review, "lib/checks.js"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const NOTE = (mid, offer, commission, validation, extra = "") => `New Implementation setup for MID ${mid} (${offer})\n\nDefault commission group: ${commission}\nValidation period: ${validation}\n\nPages: 8 saved, 2 skipped.${extra}\n\nPosted by UI_AutoSetup_Prototype v3.0.3 AutoSetup prototype.`;
const page = (fields) => ({ ok: true, idConfirmed: true, fields });
const ui = (over = {}) => Object.assign({
  main: page({ website: "https://shop.example", landingPage: "https://shop.example/", append: "source=aw&utm_source=awin&sv1=affiliate&sv_campaign_id=!!!id!!!", awc: true, linkBuilder: true, acceptedDomains: ["shop.example"] }),
  commission: page({ groups: [{ name: "DEFAULT", type: "Percentage", value: 8 }] }),
  plugins: page({ plugins: [{ name: "R.O.EYE - Consent - SingleView", enabled: true }] }),
  fees: page({ feeValue: "30", fees: [] }),
  validate: page({ transactions: [{ ref: "T1", voucher: false, params: [] }] }),
  wizard: page({ transactionDetails: 1 }),
  mobile: page({ strategy: true }),
  prejoin: page({ publishers: [{ id: "111", status: "Active" }, { id: "45628", status: "Active" }] }),
  migrated: page({ validationDays: "30", manualApproval: true }),
  testtx: page({ rows: [] })
}, over);
const sf = { name: "Shop", awinId: "131530", website: "https://shop.example", landingPage: "https://shop.example/", dedup: "Yes", dedupParam: "source", channelParams: "aw", linkBuilder: "Yes", ecomPlatform: "" };
const noSite = { checked: false, error: "not checked" };
const row = (r, name) => r.checks.find((c) => c.check === name);

test("setup note: the source of truth; the checklist post only fills the gaps, differences are listed", () => {
  const note = C.parseSetupNote(NOTE("131530", "Accelerate", "Sale, Percentage, 8%", "30 days"));
  const checklist = C.parseChecklist("Base commission: Percentage 9\nAuto-approve publishers: Yes\nValidation period in contract: 30\nPlatform Offer: Advanced").inputs;
  const m = C.mergeInputs(checklist, note);
  assert.equal(m.inputs.offerOverride, "Accelerate");
  assert.equal(m.inputs.commissionValue, "8");
  assert.equal(m.inputs.autoApprove, true, "the contract's approval, which the note doesn't say");
  assert.deepEqual(m.missing, []);
  assert.deepEqual(m.differences, ["Platform Offer: Accelerate in the setup note, Advanced in the checklist post", "Commission: Percentage 8 in the setup note, Percentage 9 in the checklist post"]);
  // a kept validation value: expected as kept; the checklist's days don't come back in
  const kept = C.mergeInputs({ validationDays: 30 }, C.parseSetupNote(NOTE("1", "Access", "Sale, Percentage, 5%", "45 days (already set, kept)")));
  assert.equal(kept.inputs.validationTarget, 45);
  assert.equal(kept.inputs.validationDays, undefined);
  // no note: the checklist post alone, as before
  assert.deepEqual(C.mergeInputs(checklist, null).inputs, checklist);
  // only commission, validation and offer are needed now
  assert.deepEqual(C.missingInputs({}), ["Base commission", "Validation period in contract", "Platform Offer"]);
});

test("review: validation as the setup set it, 0 days -> -1, manual approval as the setup, tracking fee optional", () => {
  const inputs = C.parseSetupNote(NOTE("131530", "Access", "Sale, Percentage, 8%", "45 days (already set, kept)")).inputs;
  let r = C.runChecks({ inputs, sf, ui: ui(), site: noSite, today: "2026-11-19" });
  assert.equal(row(r, "Validation Period Days").expected, "45");
  assert.equal(r.changes.find((c) => c.target === "validationDays").to, "45");
  assert.equal(row(r, "Manual approval").result, "pass", "manual approval, as the setup sets it");
  assert.equal(row(r, "Tracking fee").result, "skipped");
  const text = C.chatterText({ awinId: "131530", version: "x", plan: { changes: [] }, applied: [], result: r });
  assert.ok(!/Not checked:.*Tracking fee/.test(text), "a fee filled by default isn't reported as not checked");
  // 0 days in the contract, not Access: -1, from the note or from the checklist post alike
  const zero = C.parseSetupNote(NOTE("131530", "Advanced", "Sale, Percentage, 8%", "-1 (0 days in the contract)")).inputs;
  r = C.runChecks({ inputs: zero, sf, ui: ui(), site: noSite });
  assert.equal(r.changes.find((c) => c.target === "validationDays").to, "-1");
  r = C.runChecks({ inputs: { commissionType: "Percentage", commissionValue: "8", validationDays: 0, offerOverride: "Advanced" }, sf, ui: ui(), site: noSite });
  assert.equal(r.changes.find((c) => c.target === "validationDays").to, "-1");
  // the contract says auto-approve: manual approval off
  r = C.runChecks({ inputs: { ...zero, autoApprove: true }, sf, ui: ui(), site: noSite });
  assert.equal(r.changes.find((c) => c.target === "manualApproval").to, "Off");
});

test("review: Shopify stores keep the myshopify website the setup set; no To check for it", () => {
  const inputs = C.parseSetupNote(NOTE("131530", "Accelerate", "Sale, Percentage, 8%", "30 days")).inputs;
  const shop = ui({ main: page({ website: "https://brand-x.myshopify.com", landingPage: "https://www.brand.example/", append: "source=aw&utm_source=awin", awc: true, linkBuilder: true, acceptedDomains: ["brand-x.myshopify.com", "www.brand.example"] }) });
  const r = C.runChecks({ inputs, sf: { ...sf, website: "https://www.brand.example", landingPage: "https://www.brand.example/", ecomPlatform: "Shopify" }, ui: shop, site: noSite });
  assert.equal(row(r, "Website").result, "pass");
  assert.equal(row(r, "Landing page").result, "pass");
  assert.ok(!r.changes.some((c) => c.target === "website"));
  const text = C.chatterText({ awinId: "131530", version: "x", plan: { changes: r.changes }, applied: [], result: r });
  assert.ok(!/To check: Website/.test(text), text);
  // without Shopify, a myshopify website is still flagged as before
  const r2 = C.runChecks({ inputs, sf: { ...sf, website: "https://www.brand.example" }, ui: ui({ main: page({ website: "https://x.example/admin", landingPage: "https://www.brand.example/", append: "source=aw", awc: true, linkBuilder: true, acceptedDomains: [] }) }), site: noSite });
  assert.equal(row(r2, "Website").result, "review");
});

test("review: the setup's query string stands; the record (checklist default source / aw) follows it", () => {
  // Access without an e-commerce platform: the setup wrote utm_source=awin
  const inputs = C.parseSetupNote(NOTE("131530", "Access", "Sale, Percentage, 8%", "37 days (30 + 7 for Access)")).inputs;
  const access = ui({ main: page({ website: "https://shop.example", landingPage: "https://shop.example/", append: "utm_source=awin", awc: true, linkBuilder: true, acceptedDomains: ["shop.example"] }) });
  let r = C.runChecks({ inputs, sf, ui: access, site: noSite });
  assert.ok(!r.changes.some((c) => c.target === "append"), "the append is not changed");
  const up = Object.fromEntries(r.sfUpdates.map((u) => [u.key, u.value]));
  assert.equal(up.dedupParam, "utm_source");
  assert.equal(up.channelParams, "awin");
  assert.equal(row(r, "Deduplication append").result, "pass");
  // without a setup note, the record still wins (Optimus IR's own rule): the pair is added
  r = C.runChecks({ inputs: { commissionType: "Percentage", commissionValue: "8", validationDays: 30, offerOverride: "Access" }, sf, ui: access, site: noSite });
  assert.equal(r.changes.find((c) => c.target === "append").to, "utm_source=awin&source=aw");
  // the record already matches the setup's query string: nothing to change
  r = C.runChecks({ inputs, sf: { ...sf, dedupParam: "utm_source", channelParams: "awin" }, ui: access, site: noSite });
  assert.ok(!r.sfUpdates.some((u) => u.key === "dedupParam" || u.key === "channelParams"));
});

test("review: setup pages it doesn't check itself are listed when the setup note says they need a look", () => {
  const note = C.parseSetupNote(NOTE("131530", "Accelerate", "Sale, Percentage, 8%", "30 days",
    "\nNeeds a look: Account details (\"ipTrackingEnabled\" tick box not found); Plugin store (x).\nNot started: Invite user."));
  const r = C.runChecks({ inputs: note.inputs, sf, ui: ui(), site: noSite });
  const text = C.chatterText({ awinId: "131530", version: "x", plan: { changes: [] }, applied: [], result: r });
  assert.match(text, /To check: Setup: Account details — · needed a look in the setup/);
  assert.match(text, /To check: Setup: Invite user — · not started by the setup/);
  assert.ok(!/Setup: Plugin store/.test(text), "the review checks the plugins itself");
});

// ---------- the record side: finding the setup note ----------
const post = (text) => `<article class="cuf-feedElement"><div class="cuf-feedBodyText">${text.replace(/\n/g, "<br>")}</div></article>`;
function recordPage(posts) {
  const dom = new JSDOM(`<html><body><div class="oneContent active">
    <a data-tab-value="detailTab" aria-selected="false">Details</a><a data-tab-value="collaborateTab" aria-selected="true">Chatter</a>
    <div class="cuf-feed"><div class="feed">${posts.map(post).join("")}</div></div></div></body></html>`,
    { runScripts: "outside-only", url: "https://awin.lightning.force.com/lightning/r/TSE__c/a0CTr0000E880fGMQQ/view" });
  const w = dom.window;
  w.eval("window.scrollTo = function(){}; HTMLElement.prototype.getClientRects = function(){return [1]}; HTMLElement.prototype.scrollIntoView = function(){};");
  const listeners = [];
  w.chrome = { runtime: { onMessage: { addListener: (f) => listeners.push(f) } }, storage: { local: { get: async () => ({}) } } };
  for (const f of ["lib/log.js", "lib/fields.js", "lib/checks.js", "content/salesforce.js"]) w.eval(fs.readFileSync(path.join(review, f), "utf8"));
  w.console.info = () => {}; w.console.warn = () => {};
  return (msg) => new Promise((res) => listeners.forEach((f) => f(msg, {}, res)));
}

test("record: the setup note for this MID is found and used; the contract's approval is taken from the checklist post", async () => {
  const ask = recordPage([
    NOTE("999999", "Advanced", "Sale, Percentage, 3%", "60 days"),       // another MID's setup
    NOTE("131530", "Access", "Sale, Percentage, 8%", "37 days (30 + 7 for Access)"),
    "Implementation Checklist\nBase commission: Percentage 9\nAuto-approve publishers: Yes\nValidation period in contract: 30\nTracking fee: Percentage 30\nPlatform Offer: Access"
  ]);
  const r = (await ask({ action: "oirChecklist", mid: "131530" })).checklist;
  assert.equal(r.found, true);
  assert.equal(r.setupNote.mid, "131530");
  assert.equal(r.checklistPost, true);
  assert.equal(r.inputs.commissionValue, "8", "the setup note wins");
  assert.equal(r.inputs.validationTarget, 37);
  assert.equal(r.inputs.autoApprove, true);
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.differences, ["Commission: Percentage 8 in the setup note, Percentage 9 in the checklist post"]);
});

test("record: a setup note alone is enough, and the search doesn't wait for the whole feed", async () => {
  const ask = recordPage(["Kick-off call done", NOTE("131530", "Accelerate", "Sale, Percentage, 8%", "30 days")]);
  const t0 = Date.now();
  const r = (await ask({ action: "oirChecklist", mid: "131530" })).checklist;
  assert.equal(r.found, true);
  assert.equal(r.checklistPost, false);
  assert.deepEqual(r.missing, []);
  assert.ok(Date.now() - t0 < 20000, `stopped after one round with nothing new (${Date.now() - t0} ms)`);
});

// ---------- the Awin pages, with the details the setup found on the live pages ----------
function awinPage(html, url) {
  const dom = new JSDOM(`<html><body>${html}<p>${"x".repeat(200)}</p></body></html>`, { runScripts: "outside-only", url });
  const w = dom.window;
  w.eval("HTMLElement.prototype.getClientRects = function(){return [1]}; window.CSS = {escape: s => s};");
  w.eval(fs.readFileSync(path.join(review, "lib/fields.js"), "utf8"));
  w.eval(fs.readFileSync(path.join(review, "content/awin-page.js"), "utf8"));
  w.console.info = () => {};
  return w;
}

test("pages: Link Builder by #DeeplinkEnabled, the append by #ClickAppend", async () => {
  const w = awinPage(`<h1>131530</h1><form><label>Website URL</label><input id="MainWebsiteURL" value="https://shop.example">
    <label>Landing Page</label><input id="GlobalClickThroughPage" value="https://shop.example/">
    <label>Default Query String Append</label><input id="ClickAppend" value="utm_source=awin">
    <label for="DeeplinkEnabled">Enable Link Builder for publishers</label><input type="checkbox" id="DeeplinkEnabled" checked></form>`,
    "https://ui.awin.com/tracking-settings/us/awin/advertiser/131530/main-settings");
  const r = await w.OIRPage.scrape("main", "131530");
  assert.equal(r.fields.linkBuilder, true);
  assert.equal(r.fields.append, "utm_source=awin");
  assert.equal(r.fields.landingPage, "https://shop.example/");
});

test("pages: pre-join publishers as tick boxes (value = id); none means already pre-joined", async () => {
  const url = "https://ui.awin.com/provider/pre-join-publishers?advertiserId=131530";
  let w = awinPage(`<form name="pre_join_publishers" method="post"><label><input type="checkbox" value="45628"> 45628 Example</label>
    <label><input type="checkbox" value="111"> 111 Test</label><button type="submit">Submit</button></form>`, url);
  w.document.forms[0].addEventListener("submit", (e) => e.preventDefault());
  let r = await w.OIRPage.scrape("prejoin", "131530");
  assert.deepEqual(r.fields.publishers, [{ id: "111", status: "Not pre-joined" }, { id: "45628", status: "Not pre-joined" }]);
  const a = await w.OIRPage.apply({ pageKey: "prejoin", target: "publisher", to: "111" }, "131530");
  assert.equal(a.ok, true, JSON.stringify(a));
  assert.ok(Array.from(w.document.querySelectorAll("input[type=checkbox]")).every((b) => b.checked), "both ticked before Submit");
  w = awinPage(`<form name="pre_join_publishers" method="post"><p>Publishers already pre-joined: 111, 45628</p><button type="submit">Submit</button></form>`, url);
  r = await w.OIRPage.scrape("prejoin", "131530");
  assert.deepEqual(r.fields.publishers.map((p) => p.status), ["Active", "Active"]);
});

test("pages: mobile tracking by the strategy radio; approval by its label", async () => {
  let w = awinPage(`<h1>131530</h1><form><label><input type="radio" name="strategy" value="0" checked> Tracking is not implemented</label>
    <label><input type="radio" name="strategy" value="1"> Tracking is implemented on mobile site</label><button id="updateChanges">Update</button></form>`,
    "https://ui.awin.com/provider/merchant-settings/131530/mobile-tracking/network/awin");
  let r = await w.OIRPage.scrape("mobile", "131530");
  assert.equal(r.fields.strategy, false);
  const a = await w.OIRPage.apply({ pageKey: "mobile", target: "strategy", to: "On" }, "131530");
  assert.equal(a.ok, true, JSON.stringify(a));
  assert.equal(w.document.querySelectorAll("input[name=strategy]")[1].checked, true);
  w = awinPage(`<h1>131530</h1><form method="post"><label for="a1">Approval of Publishers Joining</label><select id="a1"><option value="0">Manual Approval</option><option value="1" selected>Auto Approval</option></select>
    <label for="d1">Validation Period Days</label><input type="number" id="d1" value="30"><button type="submit">Save</button></form>`,
    "https://ui.awin.com/provider/migrated-advertiser-settings/131530");
  r = await w.OIRPage.scrape("migrated", "131530");
  assert.equal(r.fields.manualApproval, false);
  assert.equal(r.fields.validationDays, "30");
});

test("pages: manual approval is set by the option's text, whatever its value", async () => {
  const w = awinPage(`<h1>131530</h1><form><label for="a1">Approval of Publishers Joining</label><select id="a1"><option value="0">Manual Approval</option><option value="1" selected>Auto Approval</option></select>
    <label for="d1">Validation Period Days</label><input type="number" id="d1" value="30"><button type="button">Save</button></form>`,
    "https://ui.awin.com/provider/migrated-advertiser-settings/131530");
  await w.OIRPage.apply({ pageKey: "migrated", target: "manualApproval", to: "On" }, "131530");
  assert.equal(w.document.getElementById("a1").value, "0");
});
