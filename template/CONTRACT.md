# CONTRACT (Cline reads this before every build and fix)

- Build one `index.html`: inline CSS and JS, CDN libraries allowed, no npm, no other files.
- No backend and no keys.
- Viewport meta tag, works at 375px wide.
- Footer: `Wished by {WISHER}, granted by Genie (open source) · report a bug → {ISSUES_URL}`.
- Order of priority: it loads without errors, then the core feature works, then the footer, then styling.
- Styling: clean and modern, mobile-first, system font stack, one accent color, cards with soft corners, generous spacing. It should look finished, not like a prototype.
- **STOP** when done. No refactoring, no tests, no polish.
