# HACKDAY: Mon Oct 19

Read in 5 minutes. Code and details for every step are in build-plan.md.

## 1. Goal

By **3:15 PM**: Genie running for real (no fakes), a library of **2–5 real apps** from real Reddit wishes, a **recorded demo video**, README + MIT license, **submitted**.

The demo, two things at once on the board:
- **Left:** Genie finds a real Reddit wish, texts Rishab, Cline builds it, Playwright tests it, Rishab approves the screenshot, Composio posts it to r/GenieGrants.
- **Right:** a GitHub issue asks for dark mode on a library app. Genie texts for approval, Cline adds it, v1 → v2, Genie replies and closes the issue.

Hours: hacking **11:45–3:15**. Submission due **3:15**. Demos **3:35**.

## 2. Who owns what

Equal split. Each person edits only their own files.

| Aryan: front end + building | Rishab: connections + finding |
|---|---|
| `board/index.html` | `steps/askApproval.ts`, `lib/messenger.ts` (Photon Cloud) |
| `steps/build.ts`, `steps/fix.ts` (real Cline), Cline setup | `steps/discover.ts`, `steps/discover.fake.ts` (Parallel) |
| Playwright, `template/CONTRACT.md`, `template/apps/` | `steps/launch.ts` (Composio Reddit post, GitHub issues: read, reply, close, publish) |
| README.md, LICENSE | Reddit `u/GenieGrants` + r/GenieGrants, GitHub org `genie-wishes` + repo `wishes` |
| Video recording and editing | Writing the dark-mode issue on camera, the phone on camera |

**Shared, touch only together:** `genie.ts`, `lib/types.ts`, `lib/state.ts`. Say it out loud before editing.

## 3. Step 1: connect every sponsor first

Nothing gets built until every row passes. Keys go in `.env` on both laptops (copy `.env.example`), shared through 1Password, **never committed**. Stuck 20+ min on a connection → ask that sponsor's team at the event.

| Connection | Owner | Where to get it | `.env` | Test | Pass looks like |
|---|---|---|---|---|---|
| **Parallel** | Rishab | platform.parallel.ai → API keys | `PARALLEL_API_KEY` | `npx tsx spikes/parallel.ts` | Prints wishes, then `PASS: best wish has N unique askers` with N ≥ 5, real reddit links. Raw JSON in `spikes/out/` |
| **Photon Cloud** | Rishab | Photon dashboard → project id + secret | `APPROVAL_TRANSPORT=imessage-cloud` `PHOTON_PROJECT_ID` `PHOTON_PROJECT_SECRET` `OWNER_PHONE=+1…` | `npx tsx spikes/photon.ts` | Phone gets a text, you reply YES, terminal prints `reply "yes" → yes in 4.2s`; second text arrives with the screenshot image. (Fallback that already works: `APPROVAL_TRANSPORT=imessage-local` on a Mac with Full Disk Access) |
| **Composio + Reddit** | Rishab | app.composio.dev → API key; connect Reddit there logged in as `u/GenieGrants` | `COMPOSIO_API_KEY` | A 10-line script calling `REDDIT_CREATE_REDDIT_POST` into r/GenieGrants (put it in `spikes/reddit.ts`) | A post is visible in r/GenieGrants **logged out**, with `u/…` in the body. Then read its comments back |
| **GitHub issues** | Rishab | github.com → settings → developer settings → fine-grained token on `genie-wishes/wishes`: contents, issues, pages, read/write. Or `gh auth login` | `GITHUB_TOKEN` `ISSUES_URL` `PAGES_BASE` | `gh issue list -R genie-wishes/wishes --json number,title,body` then `gh issue comment` + `gh issue close` | Open an issue by hand, the list shows it, comment and close work. `git push` to the repo works with the token and Pages shows the file |
| **Cline + open model** | Aryan | Hackathon model credits (ask the Cline table which provider/key). Plain API key, no browser login | `CLINE_PROVIDER` `CLINE_MODEL` `CLINE_API_KEY` | `cd apps/_spike && cline -y --json -t 180 -P $CLINE_PROVIDER -m $CLINE_MODEL "Read CONTRACT.md. Build a tip calculator. Stop when done."` | `index.html` exists, opens, works at 375px. Note the time: that number goes in the video. `--json` lines stream to stdout |
| **Playwright** | Aryan | `npx playwright install chromium` | — | `npm run demo` | Runs to `--once: a new app is live and an issue is answered, done` with no errors. Board at localhost:3000 |

## 4. Step 2: build each part for real

Every row replaces a fake body in `steps/*.ts`. Function names, types, and the board stay. Save the same fields the fakes save now (spans, feed lines, hits, searches, reply url) and the board shows it with no changes.

| Part | Owner | Working means | Test alone |
|---|---|---|---|
| `discover()` + `validate()` in `steps/discover.ts` | Rishab | Already real. One search per query, hits stream in, askers with `foundAt`, prior-art verdict. Fix whatever the spike shows (author extraction is the usual one) | `npx tsx spikes/parallel.ts`, then `npx tsx spikes/parallel.ts "a bill splitter that splits by item"` for one wish |
| `askApproval()` over Photon Cloud | Rishab | Same as the local spike but `imessage-cloud`. Retries if the transport drops | `npx tsx spikes/photon.ts` |
| `build(app, onLine)` in `steps/build.ts` | Aryan | Runs `cline -y --json -t 180` in `apps/<slug>/` with `CONTRACT.md` copied in. Task = spec + askers' quotes + footer values. Each `--json` line → `onLine({t, text, kind, file})`: text/reasoning → `thought`, read_file → `read`, write_to_file / replace_in_file → `edit` with the path. Three builds in a row pass Playwright | `FAKE_REPLIES=yes,yes npm run demo` with `PARALLEL_API_KEY=` empty: fake wishes, real Cline |
| `fix(app, issue, onLine)` in `steps/fix.ts` | Aryan | Same, with the change task. Dark mode on a built app passes Playwright; the diff shows on the board | `curl -X POST 'localhost:3000/report?slug=<app>&author=you' -d 'Can you add dark mode?'` while `npm start` runs |
| `launch()` in `steps/launch.ts` | Rishab | Composio `REDDIT_CREATE_REDDIT_POST` to r/GenieGrants, title from `launchTitle`, body tags `u/{wisher}`, links the askers' threads and the app. Returns real post id + permalink | `spikes/reddit.ts` |
| `publish()` in `steps/launch.ts` | Rishab | Copies `apps/<slug>/` into a clone of `genie-wishes/wishes`, commits, pushes with the token. Returns the Pages URL. Time how long Pages takes to go live | Push once by hand, open the URL |
| `pollReports(apps)` in `steps/launch.ts` | Rishab | Open GitHub issues on the repo (slug in the title or a label) → `Report[]`, plus comments on each launch post if time. Returns each report once | Open an issue by hand, watch `[genie]` log pick it up within 2s |
| `resolveIssue()` in `steps/launch.ts` | Rishab | Comments the text, closes the issue, returns the comment URL | Same issue: reply appears, issue closed, link on the board |
| Board, README, LICENSE, CONTRACT.md | Aryan | Board unchanged unless something looks wrong with real data. README: one paragraph, loop diagram, video link, `npm run demo`. MIT license | `npm run demo` still passes |

## 5. Timeline

| Time | Aryan | Rishab |
|---|---|---|
| **Before 11:45** | `git pull`, `npm i`, `npx playwright install chromium`, `npm run demo` passes. Cline installed. Get the model key at the Cline table | Same pull + demo. Create `u/GenieGrants`, r/GenieGrants (pinned post), GitHub org `genie-wishes` + repo `wishes` with Pages on. Keys into 1Password |
| **11:45–1:00** | Cline test passes, 3 builds timed. Playwright green on all 3. Start replacing `build()` | Parallel spike PASS. Photon Cloud spike PASS. Reddit post from Composio visible. `gh` list/comment/close work |
| **1:00–1:30** | `build()` and `fix()` real. Dark mode on a built app passes the test | `launch()`, `publish()`, `pollReports()`, `resolveIssue()` real |
| **1:30 CHECKPOINT** | **On one laptop, `npm start`, no fakes: real wish → text → YES → Cline builds → Playwright → screenshot text → YES → posted on Reddit → open a GitHub issue → text → YES → v2 shipped, issue closed.** If it isn't working, everything else waits. Both on it | |
| **1:30–2:15** | Board polish on real data. README + LICENSE | Genie builds the library: say YES to 2–5 wishes. Fix whatever breaks in his parts |
| **2:15–2:45** | Record the video (shot list below). Screen + phone | On the phone and on GitHub on cue |
| **2:45–3:15** | Edit, upload, repo public, PR `genie-library` → `main`, **submit** | Check the submission form fields, fill them |

## 6. Git workflow

- Branch off `genie-library`: `aryan/…` and `rishab/…`. Commit small and often.
- Merge into `genie-library` at each checkpoint (1:00, 1:30, 2:15). Pull before starting, pull before merging.
- Never commit `.env`. Check with `git ls-files | grep env` before every push.
- Pick **one laptop** to run Genie for the library run and the video. The other laptop is for editing and the GitHub/Reddit tabs.

## 7. Demo video shot list (3 minutes)

Board full screen (press **F** to hide the footer). Phone in hand. Second window: Reddit and GitHub tabs. `FAKE_REPORTS=` empty. Dark-mode issue text ready to paste.

| # | Board | Phone | Reddit / GitHub | Say |
|---|---|---|---|---|
| 1 | Idle. "Watching Reddit · Watching GitHub · Always on". Library: 3 apps, v1, Live | — | — | "Genie reads Reddit for people wishing a tool existed, texts me, builds it, posts it, and looks after it. Earlier today it built these three." |
| 2 | Left: a sweep. Query chips, posts stream in, a wish is picked, asker cards land, counter climbs, "Nothing good exists" with the tools checked | — | Reddit: open one asker's real thread, read a line | "Four real people asked. Parallel checked nothing good exists." |
| 3 | Approval bubble, "Waiting for you" | **Buzz. Hold it up. YES** | — | "It asks me before it does anything." |
| 4 | Cline reasoning lines, then Playwright checks ticking | — | — | "Cline writes it. Playwright tests it." |
| 5 | Right: the issue card lands under the running v1 app | — | **GitHub: open the issue "Can you add dark mode?" on the bill splitter. Back to the board in 5s** | "Meanwhile someone asks for dark mode on an app it built yesterday." |
| 6 | Right: approval bubble | **Buzz. YES** | — | "Same rule." |
| 7 | Right: Cline's reasoning, the diff (green lines), checks, "Shipping v2", preview reloads **dark**, v2 | — | — | "That's Cline's actual reasoning, and the actual diff." |
| 8 | "Genie replied on GitHub · issue closed" | — | **GitHub: refresh. Genie's comment, issue closed** | "It replied and closed it." |
| 9 | Left: screenshot bubble | **Buzz with the screenshot. YES** | — | "Second yes, with a screenshot, before anything goes public." |
| 10 | Left: "Live", the post card. Rail: Parallel · Photon · Cline 48s · Playwright 3s · Composio | — | **Reddit: r/GenieGrants, the new post, the wisher tagged. Open the app on the phone** | "Composio posted it and tagged the person who asked." |
| 11 | Library: 4 apps, bill splitter v2 | Open the bill splitter: dark, footer "v2 · added dark mode · requested by @…" | — | "Every app carries its own history." |
| 12 | Board wide | — | — | "It found strangers on Reddit, built them tools, and keeps improving them when people ask. Most AI serves whoever owns it. Genie serves whoever needs it." |

File the GitHub issue (shot 5) about 10 seconds after the first YES, so both sides are busy at once. Never show a terminal. Record twice if there's time.

## 8. Cut order if behind

Drop in this order, first to last:
1. Fly deploy (laptop + hotspot instead)
2. Reddit comments as a report source (GitHub issues only)
3. "Change X" replies on the post approval (YES/NO only)
4. Linking every asker's thread in the post (link the wisher only)
5. Photon Cloud (use `imessage-local` on the Mac)
6. README polish (one paragraph + video link is enough)

**Never cut:** real Parallel find, the approval text, real Cline build, the Reddit post, the dark-mode upgrade with the GitHub reply.

## 9. Ask the organizers at 11:45

- Live demo on stage, or a video? Both?
- How long is each demo slot?
- What exactly to submit: repo link, video link, form? Where?
- Which model provider do the hackathon credits cover, and how do we get the key?
- Is there a judging rubric, and does "uses all three sponsors" weigh more than polish?
