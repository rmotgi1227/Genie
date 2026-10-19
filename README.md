# Genie

**An indie maker that never sleeps.** Genie reads Reddit for developers and everyday people wishing a tool existed, texts you the idea, and on your YES builds it, tests it, open-sources it under MIT, puts it online, and replies to the person who asked. When someone opens an issue asking for a change, it texts you again and ships v2.

Nothing goes public without a YES from a human.

> Built in one afternoon at the Cline × Composio × Parallel hackathon, Oct 19 2026. **Video:** _link coming_

## The loop

```
 every 30 min                                                                      forever, every live app
 ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────────┐   ┌────────────────────────────┐
 │ 1. Find      │→ │ 2. Ask you   │→ │ 3. Build     │→ │ 4. Ask you   │→ │ 5. Ship                   │   │ 6. Look after it           │
 │ a wish       │  │ (text YES)   │  │ + test       │  │ (screenshot) │  │ MIT repo · deploy · reply │ → │ issue → text → YES → v2    │
 │ Parallel +   │  │ Photon       │  │ Cline +      │  │ Photon       │  │ Composio GitHub · Vercel  │   │ Cline · Playwright ·       │
 │ Composio     │  │ iMessage     │  │ Playwright   │  │              │  │ · Composio Reddit         │   │ Composio GitHub            │
 └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘  └───────────────────────────┘   └────────────────────────────┘
```

| Step | What happens | Sponsor |
|---|---|---|
| Find | Reads "what tool do you wish existed?" threads and request posts in dev subreddits (r/webdev, r/selfhosted, r/opensource, r/vscode, r/SomebodyMakeThis…). Every wish keeps its real author, upvotes and link. Unique askers are counted in code, never by a model | **Parallel** search + grouping, **Composio** Reddit |
| Check | Finds other people asking for the same thing and checks whether a good tool already exists, so Genie doesn't build clones | **Parallel** |
| Ask | Texts you: *"6 different people want X. Build it? YES / NO / DIFFERENT, or text your own idea"* | **Photon** (iMessage) |
| Build | Writes the tool: a web app, a browser extension, a CLI or a VS Code extension, always with a landing page | **Cline** (headless) |
| Test | Loads it at phone width, checks for errors, clicks through it, screenshots it | Playwright |
| Ship | New public repo under your GitHub account with an MIT license, deploy to its own URL, reply to the wisher on their Reddit comment | **Composio** GitHub + Reddit, Vercel |
| Maintain | Reads issues on every repo it made, texts you, makes the smallest change, re-tests, ships v2, replies and closes the issue | **Cline**, **Composio** GitHub |

## Run it

```bash
npm i
npx playwright install chromium
npm run demo     # the whole story with sample data, no keys needed
```

For the real thing, copy `.env.example` to `.env` and fill in the keys (Parallel, Composio with Reddit + GitHub connected, Cline, Vercel, Photon), then:

```bash
npm start        # board on http://localhost:3000
```

Every step falls back to sample data when its key is empty, and nothing is deployed, posted or texted on a scripted YES.

## Safety

- Three human approvals by text: before building, before anything goes public (with a screenshot), and before any change to a live app.
- Text from Reddit and GitHub is filtered for prompt injection and passed to Cline marked as untrusted.
- Genie replies only to people who asked publicly, says it's an AI in every message, and never retries a rate-limited post in a loop.

## License

MIT, see [LICENSE](LICENSE). Every tool Genie builds is MIT licensed too.
