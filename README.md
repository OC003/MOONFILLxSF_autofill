# 🌙 Moonfill x SF_autofill

**Two one-click jobs on Salesforce: run a Moonpull integration scan with the result posted in the record's Chatter, and fill in and save the record's Technical Checklist.**

Moonfill is a browser extension for Awin agents. Before, you had to fill in the Moonpull form, wait for the result in Teams, copy it and paste it into Salesforce, then work through the Technical Checklist field by field. Now one button runs the scan and posts the result, and another fills in the checklist and saves it.

| | What it does | Where to find it |
|---|---|---|
| **Moonpull scan** | Submits the Moonpull form for the record, waits for the result, posts it to Chatter and fills the scan fields | **🌙 Submit Moonpull form** button on the record |
| **Technical Checklist** | Fills the agreed values into the Technical Checklist and saves the record | **Checklist Autofill** panel, bottom right of the record |

---

## Why use it

- **One click each.** No typing the MID or region, no form to fill in, no copy and paste, no going through the checklist field by field.
- **Nothing to remember.** Moonfill reads the program, MID and country from the Salesforce record. The checklist values are the team's agreed answers, and the record's creation date is taken from its history.
- **Work on something else.** While a scan runs (usually up to 10 minutes) you can use other tabs and other apps.
- **Several scans at once.** Start as many as you like, for the same client or different ones. Each result goes to its own record.
- **Always visible.** One click on the Moonfill icon shows what is running, what is done and what needs attention. The checklist panel says exactly what it filled and saved.
- **Safe by design.** Before posting, Moonfill checks that the result belongs to the MID you scanned. Before saving the checklist, it checks that nothing else on the record has changed. If either check fails, nothing is posted or saved.
- **A safety net.** If a post goes wrong, a **Force paste** button and a **Copy result** button are one click away, and the Teams message still arrives as usual. For the checklist, **Fill only** fills the fields without saving, so you can check them first.
- **Your way.** In **Settings**, you can change what any checklist field is filled with.

---

## How it works

### Moonpull scan

1. Open the program's record in Salesforce and click **🌙 Submit Moonpull form**.
2. A form tab opens, fills itself in, submits and closes. This takes about 25 seconds, then you are back on the record.
3. Moonfill waits for the scan to finish. You don't need to do anything.
4. When the result is ready, Moonfill opens the record in the background, posts the result to its **Chatter** feed, fills the scan fields (see [Fields filled by both](#fields-filled-by-both)) and shows a notification.

**To follow your scans:** click the Moonfill icon in the toolbar.

| What you see | What it means |
|---|---|
| Submitting form… | The form is being filled in and sent |
| In progress (3m 20s) | The scan is running |
| Posting to Salesforce… | The result is ready and is being posted |
| Result ready · waiting for the browser to be in front | The browser window was hidden. The result will be posted as soon as you bring the browser to the front |
| Complete · pasted in Salesforce | Done. The card disappears after one minute and stays in **History** |
| Failed: … | Something went wrong. See "If something goes wrong" below |

The **History** button lists your latest scans with program, MID and status.

### Technical Checklist

Open an Implementation record. The **Checklist Autofill** panel at the bottom right shows a green dot when it can see the Technical Checklist. You don't have to scroll down to the checklist first: Salesforce only draws a section once it has been on screen, so **Fill** opens the **Details** tab, brings the checklist up itself (switching the form to edit mode if that's what it takes) and then fills it. If Moonfill is filling the scan fields on the same record at that moment, the fill waits for it to finish.

**Menu style.** In **Settings → Menu style** you can swap the panel for a **floating button**: a round blue button you can drag anywhere on the page (it stays where you put it, in every Salesforce tab). Hover it for its menu, or click it to keep the menu open. The menu has the same controls as the panel, plus **🌙 Scan**, **🔎 IR** and **🚀 Setup**, which start those processes just like Moonfill's buttons on the record.

| Button | What it does |
|---|---|
| **Check page** | Read-only. Lists which checklist fields it found and whether it found the record's creation date. **Copy report** copies field labels and page structure only, never field values. |
| **Fill only** | Fills the checklist but **doesn't save**. Check the values, then click Salesforce's **Save**, or **Cancel** to discard them. |
| **Fill & save** | Fills the checklist, checks that nothing else changed, clicks Save once and confirms the saved values. |
| **Settings** | Opens the settings page (see below). |

Each run fills **30 of the checklist's 45 fields**:

- **28 fixed answers**, for example Img tag implemented → Yes, Deduplication Parameter → `source`.
- **Pixel Sent**: the date on the **Created.** line of the record's **Implementation History** box. Filled only if empty.
- **Successful Tracking Test**: today's date. Filled only if empty.

The other 15 fields, such as Tech notes, are left untouched. If the Implementation History box or its Created. line can't be found, Pixel Sent is left as it is and the panel says why. Everything else is still filled and saved.

**Platform templates.** Thirteen eCommerce platforms have their own answers for six fields: Deduplication Solution, Other Deduplication Solution, Tag Management Solution, eCommerce platform, Voucher Tracking implemented and Product Level Tracking implemented. The panel's **Template** menu offers:

- **Auto-detect platform** (the default). When you click Fill, Moonfill reads the client's site from the record's **Landing Page URL**, works out the platform from signs in the page, and applies that platform's template. It first downloads the page invisibly. If that's blocked or inconclusive, it opens the site briefly in a background tab, then closes it.
- **A platform by name**, to skip detection: BigCommerce, Lightspeed, Magento, OpenCart, PrestaShop, Salesforce Commerce Cloud, Shopify, Shoplazza, Shopware 5, Shopware 6, Squarespace, Wix, WooCommerce.
- **Default (no template).**
- **Clear checklist.** Empties every field Fill fills, the dates included; dropdowns go back to --None--. Fields Fill leaves alone, such as notes and the scan's fields, stay as they are. **Fill only** clears without saving; **Fill & save** asks before it clears and saves.

Template values only fill **empty** fields, so an answer that's already there is kept. If there's no Landing Page URL, no platform is recognised, or the signs point to two platforms, the default fill is used and the panel says why. Detection needs permission to read websites, which you grant once in Settings (**Allow platform detection**). Until then, the default fill is used.

**SingleView Setup.** For **Accelerate** and **Advanced** programmes (the record's Platform Offer), the 🚀 setup sets the record's **SingleView Setup** checklist as it starts: SingleView Setup Type → **MasterTag Enabled**, SingleView Integration Status → **New**. **Run and save** saves it; **Fill only** leaves it unsaved. The result shows under the progress bar. For Access, and in the Technical Checklist fill, it's left alone. It doesn't matter whether that section has been scrolled to, or what the record's layout calls it: the fields are found by their names.

**Settings.** For every checklist field you can choose:
- **Team default** (the agreed answer)
- **Leave untouched**
- **Fill with…**, a value of your own
- **Record creation date** or **Today's date**, for the two date fields only

You can also allow or turn off platform detection, choose the date format (DD/MM/YYYY or MM/DD/YYYY) and reset everything to the team defaults. Your own choices win over templates. Settings are yours alone. They follow your Edge or Chrome profile and take effect on your next click. You can also open them from the extensions page: Moonfill → **Details** → **Extension options**.

### New Implementation setup

Clicking **🚀 New Implementation** on a record sets up the programme in Awin. Everything comes from the record:

| Setup value | Taken from |
|---|---|
| Website URL, Landing Page | **Landing Page URL** (Shopify stores: their `https://…myshopify.com` address, with platform detection allowed) |
| Platform Offer | **Platform Offer** (Access, Accelerate or Advanced) |
| Transaction Type, Commission Type | **Commission type** = Percentage → Sale + Percentage. Anything else: the commission group is left for you |
| Publisher Commission | **Commission Amount** |
| Approval of Publishers Joining | always **Manual Approval** |
| Validation Period Days | **Auto validation period**. For Access, a value already on the page is kept; if it's empty or -1, it becomes the period + 7 |

Before anything starts, the box checks you're signed in to Awin (looking at the page Awin sends back, not just its address), and checks again when you click **Run and save** if the box has been open for more than a minute. If you're not signed in, it says so, with **Open Awin** and **Check again**. It also checks the record has everything listed above. If something is missing, it lists it, with **Enter the details by hand**, which opens a form filled in with whatever the record has. Without a Landing Page URL or Platform Offer, that form is the only way to run it.

You're asked only whether to save: **Run and save**, **Fill only** or **Cancel**. A progress bar then shows the pages being done one at a time. The red **✕** cancels: the page being filled is finished, and the rest aren't started.

| Page | What the setup does |
|---|---|
| Tracking settings | Website URL, Landing Page, query string append, Link Builder and relative URLs ticked, Add to Accepted Domains. Query string: Accelerate/Advanced `source=aw&utm_source=awin&sv1=affiliate&sv_campaign_id=!!!id!!!`. Access: `source=aw` if the client's site runs on one of the 13 supported e-commerce platforms, `utm_source=awin` if none is found, `source=aw` if the site can't be checked (detection not allowed in Settings, or the site doesn't load) |
| Invite user, Fee manager | skipped (they come pre-filled) |
| Commission groups | Add Default Commission Group, then Transaction Type, Commission Type, Publisher Commission |
| Plugin store | Not for Access. Otherwise adds **R.O.EYE - Consent - SingleView** with its code line. The page shows no confirmation after saving, so no error counts as saved |
| Tracking tag settings | **Conversion Tag and Image Pixel integrated** (the page is reloaded first) |
| Account details | IP tracking, and stripping the referrer path when it has no valid domain |
| Mobile tracking | **Tracking is implemented on mobile site** |
| Advertiser settings | Manual Approval, Validation Period Days |
| Pre-join publishers | Publishers 45628 and 111, retried up to 5 times if the page shows an error |

**Signed out during a run.** If a page lands on Awin's sign-in instead, it's marked ⚠ and the box offers **Sign in to Awin**, which brings that tab to the front so you can sign in there. If Awin has signed you out altogether, the setup stops rather than failing every page after it. Either way, **Retry failed pages** then redoes only the pages that didn't work (and those not started), in their own tabs, after checking you're signed in again.

Each tab is marked ✓ saved, ✎ filled, ⏭ skipped or ⚠ needs a look. **Details** under the progress bar lists each page's result, and **Copy results** copies it. A MID of 0 (advertiser not created in Awin yet) can't be run. **Just open the tabs** opens the pages without filling anything, as before.

**Summary in Chatter.** After **Run and save**, if at least one page was saved, a short plain summary is posted to the record's **Chatter**. At the top: the **default commission group** and the **validation period** as they were set (or why not). Then one line of page counts, and only what needs attention: the pages that need a look (and why) and any not started, plus the SingleView Setup result. After **Retry failed pages**, an updated summary is posted. If the record tab isn't in front when the run ends, it's posted as soon as you come back to it. **Fill only** posts nothing. Posting opens the record's Chatter tab.

```
New Implementation setup for MID 123456 (Accelerate)

Default commission group: Sale, Percentage, 5%
Validation period: 30 days

Pages: 8 saved, 2 skipped.
SingleView Setup: MasterTag Enabled, New.

Posted by UI_AutoSetup_Prototype v3.0.2 AutoSetup prototype.
```

While the setup runs, the **Awin logo** at the front of the progress bar is a little pixel fire, flickering in the logo's own shape and colours. It stands still when the run ends.

### Fields filled by both

After a scan, Moonfill fills five Technical Checklist fields from the result. The checklist's team defaults also set three of them:

| Field | Set by the scan | Checklist team default |
|---|---|---|
| Moonpull Status | from the scan | left untouched |
| Consent Signals | from the scan | left untouched |
| Transparency & Consent Framework Plugin | from the scan (Yes/No) | always **No** |
| AASAF | from the scan (Yes/No) | always **No** |
| Consent Management Platform | detected CMP, or Other | always **Other** |

So **Fill & save after a scan replaces the scan's values for the last three.** To keep the scan's values, set those three to **Leave untouched** in Settings.

---

## What you need

- **Microsoft Edge or Google Chrome** installed on your computer.
- To be **signed in to both Salesforce and Microsoft 365** in the same browser.
- **For scans: access to the shared Moonpull results folder.** Please contact Rodier or Thomas on Teams to request access to the Moonpull batch results folder. This is where the scan results are saved. The Technical Checklist needs no extra access.

---

## Install (developer mode)

Moonfill is not in the browser store yet, so it is installed from the folder you received.

**Microsoft Edge**
1. Unzip the Moonfill folder somewhere permanent, for example in Documents. Don't delete it afterwards.
2. Open `edge://extensions`.
3. Turn on **Developer mode** (bottom left).
4. Click **Load unpacked** and select the Moonfill folder (the one containing `manifest.json`).
5. Click the puzzle icon in the toolbar and pin 🌙 Moonfill.

**Google Chrome**
1. Unzip the folder somewhere permanent.
2. Open `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the Moonfill folder.
5. Pin 🌙 Moonfill from the puzzle icon.

**Already using an earlier Moonfill, or the separate SalesforceAutofill extension?** Let any running scans finish, then remove the old extensions before loading this one, so two copies don't run on the same page. Scan history from the old Moonfill doesn't carry over.

**To update:** replace the files in the folder with the new ones, open the extensions page again and click the **reload** icon on the Moonfill card.

---

## Golden rules to avoid problems

**Scans**
1. **Start from the record.** Always click **🌙 Submit Moonpull form** on the Salesforce record of the program you want to scan.
2. **Let the form finish.** Don't switch to another app during the first 25 seconds. The form needs to be on screen to fill itself in. When the tab closes, you are free.
3. **Keep the browser open.** You can minimize it, but don't close it until the card says Complete. If you close it by mistake, reopen it within 6 minutes of submitting and Moonfill carries on.
4. **Keep the browser visible when the result arrives, if you can.** If Edge or Chrome is hidden behind other windows, Salesforce can't draw its page, so the result waits. Leaving the browser visible on one of your screens avoids this. Otherwise it is posted as soon as you bring the browser to the front.
5. **Stay signed in.** If your Salesforce or Microsoft 365 session expires, Moonfill can't read the result or open the record. Sign in again and use Force paste if needed.
6. **Don't type in the Chatter box of that record** while its result is being posted.
7. **Don't scan the same MID twice by accident.** Each click is a new scan and gets its own post.
8. **Check the notification.** If you see "scan failed" or "result ready", open the Moonfill icon.

**Technical Checklist**
1. **Save or cancel your own edits first.** The checklist won't start while the record is in edit mode, because Salesforce's Save would also save your unrelated changes.
2. **Don't fill the checklist while a scan result is being posted to the same record.** Wait until the card says Complete.
3. **New to it, or changed your settings?** Use **Check page** and **Fill only** first, on a record that's easy to put right.

---

## If something goes wrong

**Scans**

| Message | What to do |
|---|---|
| Result ready · waiting for the browser | Bring Edge or Chrome to the front. It posts by itself within a few seconds. Or click **Force paste**. |
| Failed: Chatter tab not found / "Share an update..." box did not appear | Open the Moonfill icon and click **Force paste**. If it fails again, click **Copy result** and paste it into Chatter yourself. |
| Failed: no result after 6.5 minutes | The scan may have taken longer or failed. Check the Teams message. |
| Failed: result is for another MID | Nothing was posted. Check the Teams message and tell the project owner. |
| Can't read the result folder | Sign in to Microsoft 365 in this browser and check that you have access to the results folder. |
| The form opens but doesn't fill in | Don't click again. Tell the project owner. The form may have changed. |
| Nothing happens after clicking 🌙 | Reload the page and check that the extension is on in the extensions page. |

**Technical Checklist**

| Message | What to do |
|---|---|
| Checklist not found (grey dot) | Open the record's **Details** tab. If the checklist is collapsed, that's fine: it is expanded automatically. |
| The record is already in edit mode | Save or cancel your own edits, then click again. |
| "…" changed unexpectedly, so nothing was saved | Something else changed while filling, such as a dependent field, or a scan filling the record at the same time. Click **Cancel**, wait a moment and try again. |
| Option "…" is not available | That dropdown doesn't have the value. If you set it in Settings, correct it there. Otherwise tell the project owner. Nothing was saved; click **Cancel**. |
| No template: platform detection isn't allowed yet | Open **Settings** and click **Allow platform detection**, or pick the platform in the **Template** menu. |
| No template: no platform signs found / signs of both… | The site's platform couldn't be told for sure. Pick it in the **Template** menu and click again, or keep the default fill. |
| Pixel Sent left as it is: no "Implementation History" box… | If the history box is on the **Related** tab, open that tab once, go back to Details and click again. |
| Saved, but … don't show the expected value | Check those fields on the record. Salesforce may have changed them on save. |

When you report a problem, please send a screenshot of the Moonfill card or the checklist panel, the program name and the time. For the checklist, the **Check page** report helps too.

---

## Good to know

- The result posted in Chatter is the same text as the Teams message, without your name and job title.
- The Teams message is still sent, so you always have a copy.
- Moonfill only talks to Microsoft Forms, SharePoint (the Moonpull results folder and, once set up, the usage list) and Salesforce, using your own logins. It stores the scan list on your computer only. Your checklist settings are kept in your browser profile, and follow it to your other devices if browser sync is on. The checklist works on the page in front of you. Apart from the usage count, its only network request is platform detection: when you click Fill with Auto-detect on, it reads the client's public site (the record's Landing Page URL) without your cookies, and only once you've allowed it in Settings.
- Moonfill counts each use (checklist fills, Moonpull scans, New Implementation and IR) by the record's Assigned TC, to measure adoption. No client information is recorded.
- Moonfill is for scans started from a Salesforce record. There is no manual MID box anymore.
- The checklist only changes the **Technical Checklist**. Other checklists and fields on the record are compared before and after, and never saved by it.

---

## For developers

| Path | What it is |
|---|---|
| `manifest.json`, `background.js`, `content.js`, `salesforce.js`, `popup.*`, `css/`, `assets/` | Moonpull scans, the toolbar popup and the record buttons |
| `autofill/` | The Technical Checklist: panel, fill/save engine, settings page. See [`autofill/README.md`](autofill/README.md) |
| `autofill/dev/` | Checklist field specification, mock record pages and tests (`cd autofill/dev && npm ci && npm test`) |

Record page buttons: colours and spacing are in the `injectStyles` block of `salesforce.js`. The steps of each post attempt are logged in the service worker console ("Moonfill post steps").

---

## Support

Scans built by Rodier for Awin agents. The Technical Checklist comes from SalesforceAutofill. Questions, bugs and ideas: [GitHub Issues](https://github.com/OptimusRodier/moonfill) or contact the project owner.

## What's new

**Technical Checklist (added November 2026)**
- One-click fill and save of the Technical Checklist (30 fields), with **Check page** and **Fill only**.
- Pixel Sent from the record's creation date, and Successful Tracking Test from today's date.
- Personal **Settings** for every checklist field.
- **Platform templates** for 13 eCommerce platforms, picked by hand or detected from the client's site.
- Usage counting by Assigned TC, to measure adoption. No client information is recorded.
- **New Implementation setup:** a form on 🚀, then the setup pages are filled and saved one by one.
- **Clear checklist** preset in the Template menu.
- **The checklist needn't have been seen first:** Fill opens the Details tab and brings up the checklist (or SingleView Setup) itself, even if it was never scrolled to (as in Moonfill's own Techfill).
- **Floating button** menu style (Settings), draggable, with 🌙 Scan, 🔎 IR and 🚀 Setup in its menu.
- **Setup sign-in:** a sign-in page shown in a setup tab gets **Sign in to Awin**; a sign-out stops the run; **Retry failed pages** redoes only what didn't work.
- **Simpler Chatter summary**, with the commission group and validation period first.
- Moonfill's scan-field fill and the checklist fill never write to the record at the same time (a shared lock, from Moonfill upstream).

**v2.1**
- **Fills Salesforce fields from the result**, silently, right after the result is pasted: Moonpull Status, Consent Signals, Transparency & Consent Framework Plugin, AASAF and Consent Management Platform are set (existing values replaced) and saved. No setting; the notification only mentions fields that need a look.
- **Record page buttons:** Submit Moonpull form (left), IR (middle), New Implementation (right). One **IR button** on the Case page.
- **Temporary window** is tried after any retryable failure.
