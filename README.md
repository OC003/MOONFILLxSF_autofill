# 🌙 Moonfill

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

Open an Implementation record on its **Details** tab. The **Checklist Autofill** panel at the bottom right shows a green dot when it can see the Technical Checklist.

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

**Settings.** For every checklist field you can choose:
- **Team default** (the agreed answer)
- **Leave untouched**
- **Fill with…**, a value of your own
- **Record creation date** or **Today's date**, for the two date fields only

You can also choose the date format (DD/MM/YYYY or MM/DD/YYYY) and reset everything to the team defaults. Settings are yours alone. They follow your Edge or Chrome profile and take effect on your next click. You can also open them from the extensions page: Moonfill → **Details** → **Extension options**.

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
| Pixel Sent left as it is: no "Implementation History" box… | If the history box is on the **Related** tab, open that tab once, go back to Details and click again. |
| Saved, but … don't show the expected value | Check those fields on the record. Salesforce may have changed them on save. |

When you report a problem, please send a screenshot of the Moonfill card or the checklist panel, the program name and the time. For the checklist, the **Check page** report helps too.

---

## Good to know

- The result posted in Chatter is the same text as the Teams message, without your name and job title.
- The Teams message is still sent, so you always have a copy.
- Moonfill only talks to Microsoft Forms, the Moonpull results folder and Salesforce, using your own logins. It stores the scan list on your computer only. Your checklist settings are kept in your browser profile, and follow it to your other devices if browser sync is on. The checklist itself makes no network requests at all: it works on the page in front of you.
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

**v2.1**
- **Fills Salesforce fields from the result**, silently, right after the result is pasted: Moonpull Status, Consent Signals, Transparency & Consent Framework Plugin, AASAF and Consent Management Platform are set (existing values replaced) and saved. No setting; the notification only mentions fields that need a look.
- **Record page buttons:** Submit Moonpull form (left), IR (middle), New Implementation (right). One **IR button** on the Case page.
- **Temporary window** is tried after any retryable failure.
