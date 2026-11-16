# Checklist Autofill, inside Moonfill

This folder adds **Checklist Autofill** to [Moonfill](https://github.com/OptimusRodier/moonfill), a teammate's extension. Checklist Autofill fills and saves the **Technical Checklist** on Salesforce Implementation records in one click. It was developed separately as SalesforceAutofill.

**Moonfill itself is unchanged.** Every Moonfill file is exactly as in its repository (`dev` branch, v2.1), except that `manifest.json` gains three additions:

- a content script entry that loads `autofill/` on Salesforce
- `options_ui`, the Checklist Autofill settings page (Moonfill had none)
- `web_accessible_resources`, so the panel's **Settings** link can open that page on Salesforce

Moonfill's popup, buttons, background script, scans and Chatter posting all work as before.

## Install

Same as Moonfill: download this repository, open `edge://extensions`, turn on **Developer mode**, click **Load unpacked** and select the **repository folder** (the one containing `manifest.json`). If Moonfill is already installed on its own, let any running scans finish, then remove it, so that two copies don't run on the same pages. The old copy's scan history doesn't carry over.

## Using Checklist Autofill

On an Implementation record, a **Checklist Autofill** panel appears at the bottom right of the page, separate from Moonfill's buttons.

| Button | What it does |
| --- | --- |
| **Check page** | Read-only report: which field labels were found, where the creation date comes from, and the page structure. It never includes field values. |
| **Fill only** | Fills the Technical Checklist but does not save. |
| **Fill & save** | Fills, checks that nothing else changed, saves once and reads the values back. |
| **Settings** | Your own choice per field (team default, leave untouched, your own value, or for the two dates the creation date or today), plus the date format. |

Each run fills 30 fields: 28 fixed values, plus **Pixel Sent** (the date on the "Created." line of the record's Implementation History) and **Successful Tracking Test** (today's date). Both dates are filled only when the field is empty. Fifteen fields are always left untouched, including **Moonpull Status** and **Consent Signals**, which Moonfill fills from its scan.

Safety checks: it refuses to start if the record is already in edit mode, and stops before Save if a field is missing or a dropdown option doesn't exist. It also stops if anything outside its target fields changes, for example because Moonfill is filling the record at the same moment. In that case, run it again once Moonfill has finished.

## Fields both tools fill

After a scan, Moonfill fills five Technical Checklist fields from the scan result. Checklist Autofill's team defaults also set three of them:

| Field | Moonfill (from the scan) | Checklist Autofill team default |
| --- | --- | --- |
| Moonpull Status | scan result | left untouched |
| Consent Signals | scan result | left untouched |
| Transparency & Consent Framework Plugin | scan result (Yes/No) | always **No** |
| AASAF | scan result (Yes/No) | always **No** |
| Consent Management Platform | detected CMP, or Other | always **Other** |

So **Fill & save after a scan replaces the scan's values for the last three.** Until the team decides how these should work, set those three to **Leave untouched** in Settings if you want to keep the scan values.

## Development

Everything for development is in `autofill/dev/`: the field specification, two mock record pages and the tests. It needs Node.js 18+.

```sh
cd autofill/dev
npm ci
npm test        # 31 tests against the mock pages
npm run check   # syntax check of autofill/*.js
```

| Path | Purpose |
| --- | --- |
| `fields.js` | The 45 field decisions, generated from `dev/field-specification.json`; a test keeps them identical |
| `config.js` | Date format, history box, page selectors, timeouts |
| `engine.js` | Check / fill / save logic, and the read-only page check |
| `content.js` | The floating panel |
| `settings.js`, `options.html`, `options.js` | Personal settings, saved with `chrome.storage.sync` under the key `tcaSettings`. Moonfill uses `chrome.storage.local` and `session`, so the two never touch each other's data |
| `dev/mock/` | Fictional record pages for testing (enable **Allow access to file URLs** on the extension to use them in Edge) |

All Checklist Autofill code runs in its own function scope. It shares no global names with Moonfill's scripts, and its panel sits in its own shadow root.

### Taking Moonfill updates

The `upstream` remote points at the Moonfill repository. Moonfill's files are untouched, so its updates merge cleanly. Only `manifest.json` can need a hand merge, when Moonfill changes its content scripts.

```sh
git fetch upstream
git merge upstream/dev
```

### Differences from the standalone SalesforceAutofill

The code is the same as SalesforceAutofill v0.5.0, except for three things:
- The **Settings** link opens the page directly instead of messaging a background script, so Moonfill's `background.js` stays unchanged.
- The mock-page match pattern is `autofill/dev/mock/`.
- The tests check the combined manifest.
