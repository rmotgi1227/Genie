# CONTRACT (Cline reads this before every build and change)

- Build one `index.html`: inline CSS and JS, no CDN, no npm, no other files. It must work offline.
- No backend and no keys.
- Viewport meta tag, works at 375px wide.
- Footer: `Wished by {WISHER}, granted by Genie (open source) · report a bug → {ISSUES_URL}`. Genie appends a changelog to the footer after every shipped change; leave it alone.
- Every form submits on Enter (use a `<form>` with an `onsubmit` handler, never a lone button).
- Styling through CSS variables on `:root` (`--bg --card --ink --ink-2 --line --accent --accent-soft`), clean and modern, mobile-first, system font stack, one accent color, cards with soft corners, generous spacing. It should look finished, not like a prototype.
- If asked for dark mode: a toggle in the corner that remembers the choice, dark set as the default, done by overriding the variables above for `html[data-theme="dark"]`.
- Order of priority: it loads without errors, then the core feature works, then the footer, then styling.
- For a change request: the smallest change that does it. Touch nothing else.
- **STOP** when done. No refactoring, no tests, no polish.
