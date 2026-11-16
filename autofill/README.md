# Technical Checklist: developer notes

The code behind Moonfill's **Checklist Autofill** panel. For how to use it, see the main [README](../README.md#technical-checklist).

## How it fits into Moonfill

The checklist is loaded as its own content script on `awin.lightning.force.com`, alongside `salesforce.js`. The manifest also:
- registers its settings page (`options_ui`) and makes that page web-accessible on Salesforce only, so the panel's **Settings** link can open it directly
- declares `optional_host_permissions` for all websites, used only by platform detection and granted by the user in Settings

Moonfill's `background.js` gains one line at the end: `importScripts("autofill/background.js")`, wrapped so a failure can't stop Moonfill's own code. That file adds a single message listener (`tcaReadSite`) that ignores every other message. Apart from that line and the manifest additions, the scan code (`background.js`, `salesforce.js`, `content.js`, the popup) is unchanged. It doesn't depend on the checklist code, and the checklist code doesn't depend on it.

- **Separate scope:** all checklist code runs inside its own function scope and exposes only `TCA_*` globals, so it shares no names with `salesforce.js` (content scripts of one extension share a page's isolated world).
- **Separate storage:** settings are saved with `chrome.storage.sync` under the key `tcaSettings`. The scan code uses `chrome.storage.local` and `session`, so neither touches the other's data.
- **Separate UI:** the panel is drawn in its own shadow root, so page styles and Moonfill's record buttons don't affect it.
- **Shared fields:** a scan writes five checklist fields (see [Fields filled by both](../README.md#fields-filled-by-both)). If a scan fills the record while the checklist runs, the checklist's before/after comparison spots the change and stops before Save.

## Files

| Path | Purpose |
| --- | --- |
| `fields.js` | The 45 field decisions and 13 platform templates, generated from `dev/field-specification.json` with `npm run generate`; a test keeps them identical |
| `config.js` | Date format, history box, Landing Page URL label, **platform signs**, page selectors, timeouts |
| `engine.js` | Find → expand → edit → check → fill → verify → save → read back; plus the read-only page check |
| `content.js` | The floating panel |
| `settings.js` | Loads, cleans and applies personal settings over the team defaults |
| `templates.js` | Applies a platform template (empty fields only) and detects the platform from a page's text |
| `background.js` | Reads a client's site for detection: invisible fetch without cookies, or an inactive tab that is always closed afterwards. Loaded by Moonfill's `background.js` |
| `options.html`, `options.js` | The settings page |
| `dev/field-specification.json` | The agreed field decisions (source of `fields.js`) |
| `dev/mock/` | Fictional record pages for testing. To use them in Edge, turn on **Allow access to file URLs** for the extension |
| `dev/tests/` | Tests run against the mock pages with jsdom |

```sh
cd autofill/dev
npm ci
npm test        # 45 tests
npm run generate  # after editing dev/field-specification.json
npm run check   # syntax check of autofill/*.js
```

## Taking upstream Moonfill updates

The `upstream` remote points at the original Moonfill repository (fetch only). The scan files are kept identical to it, so its updates merge cleanly. Only `manifest.json` (content scripts, settings page and optional permissions), the last line of `background.js` and `README.md` may need a hand merge.

```sh
git fetch upstream
git merge upstream/dev
```

## Platform detection

1. **Template choice.** On Fill, if the panel's template is **Auto-detect**, the panel reads the record's **Landing Page URL**. It prefers a link's address to its text and adds `https://` if missing.
2. **Reading the site.** The panel asks the background script to read the page, first with `fetch` (credentials omitted, 8 s timeout). If that fails, is blocked, or matches no platform, it tries an inactive tab: it waits for the page to load plus 1.5 s, reads the HTML and a few platform globals, then closes the tab.
3. **Matching.** `templates.js` counts each platform's signs (`config.platformSigns`, regular expressions over the HTML and response headers). The platform with the most signs wins. A tie, or no signs at all, means no template.
4. **Filling.** The template's values are layered onto the team defaults, filling empty fields only, and personal settings are applied on top.

The signs were checked against live public shops for Shopify, WooCommerce, BigCommerce, Squarespace and Wix (2026-11-16). For the other platforms they are unverified best guesses, so correct them in `config.js` if a site is detected wrongly.

## Origin

Ported from SalesforceAutofill v0.5.0, then extended here with platform templates and detection (v0.6.0), which exist only in this repository. Other differences from the standalone version:
- The Settings link opens the page directly, rather than messaging a background script.
- The tests check the combined manifest.
