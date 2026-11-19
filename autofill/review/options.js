const SITES = { origins: ["https://*/*", "http://*/*"] };

async function showPerm() {
  const ok = await chrome.permissions.contains(SITES);
  const el = document.getElementById("permState");
  el.textContent = ok ? "Allowed." : "Not allowed yet: the platform check is skipped.";
  el.className = ok ? "ok" : "muted";
}

async function showLocs() {
  const { oirRegionLoc = {} } = await chrome.storage.local.get("oirRegionLoc");
  const body = document.getElementById("locs");
  body.textContent = "";
  for (const [region, loc] of Object.entries(oirRegionLoc)) {
    const tr = document.createElement("tr");
    const del = document.createElement("button");
    del.className = "secondary"; del.textContent = "Remove";
    del.addEventListener("click", async () => { delete oirRegionLoc[region]; await chrome.storage.local.set({ oirRegionLoc }); showLocs(); });
    [region, loc].forEach((t) => { const td = document.createElement("td"); td.textContent = t; tr.appendChild(td); });
    const td = document.createElement("td"); td.appendChild(del); tr.appendChild(td);
    body.appendChild(tr);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("v").textContent = "v0.2.23 · " + (chrome.runtime.getManifest().version_name || chrome.runtime.getManifest().version);
  document.getElementById("allow").addEventListener("click", async () => { await chrome.permissions.request(SITES); showPerm(); });
  document.getElementById("revoke").addEventListener("click", async () => { await chrome.permissions.remove(SITES); showPerm(); });
  document.getElementById("addLoc").addEventListener("click", async () => {
    const region = document.getElementById("newRegion").value.trim();
    const loc = document.getElementById("newLoc").value.trim().toLowerCase();
    if (!region || !/^[a-z]{2,5}$/.test(loc)) return;
    const { oirRegionLoc = {} } = await chrome.storage.local.get("oirRegionLoc");
    oirRegionLoc[region] = loc;
    await chrome.storage.local.set({ oirRegionLoc });
    showLocs();
  });
  document.getElementById("clear").addEventListener("click", async () => {
    const all = await chrome.storage.local.get(null);
    const keys = Object.keys(all).filter((k) => k.startsWith("oirRun_") && !["running", "applying"].includes(all[k].state));
    await chrome.storage.local.remove(keys);
    document.getElementById("cleared").textContent = `${keys.length} review(s) removed.`;
  });
  const df = document.getElementById("dateFmt");
  chrome.storage.local.get("oirDateFormat").then(({ oirDateFormat }) => { df.value = oirDateFormat || "DD/MM/YYYY"; });
  df.addEventListener("change", async () => { await chrome.storage.local.set({ oirDateFormat: df.value }); document.getElementById("dateSaved").textContent = "Saved."; });
  showPerm();
  showLocs();
});
