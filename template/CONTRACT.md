# CONTRACT (Cline reads this before every build and change)

`index.html` in this directory is always the landing page — for a `web_page` wish it's also the
whole app; for every other kind it's the app's front door, and the rest of the app lives alongside
it. The index.html rules below apply to every kind. Genie's own test always loads index.html with
Playwright, deploys this directory to Vercel, and shows a screenshot of it for approval, so it must
hold up on its own whatever else the directory contains.

## index.html, every kind

- Inline CSS and JS, no CDN, no npm, no other files that index.html itself needs. It must work offline.
- No backend and no keys.
- Viewport meta tag, works at 375px wide.
- Footer: `Wished by {WISHER}, granted by Genie (open source) · report a bug → {ISSUES_URL}`. Genie appends a changelog to the footer after every shipped change; leave it alone.
- Every form submits on Enter (use a `<form>` with an `onsubmit` handler, never a lone button).
- Styling through CSS variables on `:root` (`--bg --card --ink --ink-2 --line --accent --accent-soft`), clean and modern, mobile-first, system font stack, one accent color, cards with soft corners, generous spacing. It should look finished, not like a prototype.
- If asked for dark mode: a toggle in the corner that remembers the choice, dark set as the default, done by overriding the variables above for `html[data-theme="dark"]`.
- Order of priority: it loads without errors, then the core feature works, then the footer, then styling.

## The app itself, by kind

- **web_page** (default when no kind is given): index.html *is* the app — nothing else to build.
- **browser_extension**: a Manifest V3 Chrome extension in `extension/` (`extension/manifest.json`
  with `"manifest_version": 3`, a background service worker and/or content scripts, a popup if
  needed) — no remote code, no external network calls unless the wish genuinely needs one. index.html
  explains what it does, shows a plain HTML/CSS mock/preview of it in action, and links an install
  line: "Install: download the repo zip → chrome://extensions → Load unpacked → pick the extension
  folder".
- **cli**: a Node CLI directly in this directory — `package.json` with `"bin"` pointing at
  `bin/<name>.js` and `"type": "module"`, zero npm dependencies where possible, `README.md`, and an
  `examples/` directory with at least one sample input file. index.html shows usage as
  `npx github:<owner>/<slug> ...` and a rendered example of real output.
- **editor_plugin**: a VS Code extension directly in this directory — `package.json` with
  `engines.vscode`, `contributes`, `activationEvents`, `"main": "extension.js"`, zero npm
  dependencies; `extension.js`; `README.md`. index.html explains what it does with a plain HTML/CSS
  mock/preview and gives install instructions.

## Changes

- For a change request: the smallest change, to the fewest files, that does it. Touch nothing else.
  If the change is visible to someone using the app, keep the index.html landing page in sync with it.

**STOP** when done. No refactoring, no tests, no polish.
