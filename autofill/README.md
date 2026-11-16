# Technical Checklist: developer notes

The code behind Moonfill's **Checklist Autofill** panel. For how to use it, see the main [README](../README.md#technical-checklist).

## How it fits into Moonfill

The checklist is loaded as its own content script on `awin.lightning.force.com`, alongside `salesforce.js`. The manifest also registers its settings page (`options_ui`) and makes that page web-accessible on Salesforce only, so the panel's **Settings** link can open it directly. The scan code (`background.js`, `salesforce.js`, `content.js`, the popup) doesn't depend on it, and it doesn't depend on them.

- **Separate scope:** all checklist code runs inside its own function scope and exposes only `TCA_*` globals, so it shares no names with `salesforce.js` (content scripts of one extension share a page's isolated world).
- **Separate storage:** settings are saved with `chrome.storage.sync` under the key `tcaSettings`. The scan code uses `chrome.storage.local` and `session`, so neither touches the other's data.
- **Separate UI:** the panel is drawn in its own shadow root, so page styles and Moonfill's record buttons don't affect it.
- **Shared fields:** a scan writes five checklist fields (see [Fields filled by both](../README.md#fields-filled-by-both)). If a scan fills the record while the checklist runs, the checklist's before/after comparison spots the change and stops before Save.

## Files

| Path | Purpose |
| --- | --- |
| `fields.js` | The 45 field decisions, generated from `dev/field-specification.json`; a test keeps them identical |
| `config.js` | Date format, history box, page selectors, timeouts |
| `engine.js` | Find → expand → edit → check → fill → verify → save → read back; plus the read-only page check |
| `content.js` | The floating panel |
| `settings.js` | Loads, cleans and applies personal settings over the team defaults |
| `options.html`, `options.js` | The settings page |
| `dev/field-specification.json` | The agreed field decisions (source of `fields.js`) |
| `dev/mock/` | Fictional record pages for testing. To use them in Edge, turn on **Allow access to file URLs** for the extension |
| `dev/tests/` | Tests run against the mock pages with jsdom |

```sh
cd autofill/dev
npm ci
npm test        # 31 tests
npm run check   # syntax check of autofill/*.js
```

## Taking upstream Moonfill updates

The `upstream` remote points at the original Moonfill repository (fetch only). The scan files are kept identical to it, so its updates merge cleanly. Only `manifest.json` (content scripts and the settings page entries) and `README.md` may need a hand merge.

```sh
git fetch upstream
git merge upstream/dev
```

## Origin

Ported from SalesforceAutofill v0.5.0. Two differences:
- The Settings link opens the page directly, rather than messaging a background script, so `background.js` needs no changes.
- The tests check the combined manifest.
