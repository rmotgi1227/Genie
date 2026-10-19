// FAKE Parallel step. Used when PARALLEL_API_KEY is empty, so `npm run demo` works without keys.
import type { App, Asker } from '../lib/types'
import { advance, fakeDelay, uniqueAuthors } from '../lib/state'
import { newApp, dedupe } from './discover'

const FAKE_WISHES = [
  {
    text: 'I wish there was an app that splits a restaurant bill by item, not evenly',
    author: 'fake_wisher',
    spec: 'a bill splitter that splits by item',
    why: 'Nothing good exists that works without an account.',
    askers: 7,
  },
  {
    text: 'Is there a tool that turns a recipe into a grocery list sorted by aisle?',
    author: 'fake_cook',
    spec: 'a recipe to grocery list sorter',
    why: 'Existing tools want you to sign up and pay.',
    askers: 4,
  },
  {
    text: 'Someone should build a timer that tells you when your parking meter runs out',
    author: 'fake_driver',
    spec: 'a parking meter countdown',
    why: 'Only city-specific apps exist.',
    askers: 2,
  },
  {
    text: 'I wish there was a simple pomodoro timer website with no sign up',
    author: 'fake_student',
    spec: 'a pomodoro timer with no sign up',
    why: '',
    askers: 3,
    existing: { name: 'Pomofocus', url: 'https://pomofocus.io', why: 'Free, no sign up, does exactly this.' },
  },
]

export async function discover(): Promise<App[]> {
  console.log('[parallel] searching reddit for wishes (fake)')
  await fakeDelay()
  return FAKE_WISHES.map((w, i) => newApp(w.text, w.author, 'reddit', `https://reddit.com/r/fake/comments/wish${i}`))
}

export async function validate(candidates: App[]): Promise<App[]> {
  console.log(`[parallel] validating ${candidates.length} wishes (fake)`)
  await fakeDelay()
  const out: App[] = []
  for (const app of candidates) {
    const fake = FAKE_WISHES.find((w) => w.text === app.wish.text)
    if (fake?.existing) {
      advance(app.slug, 'exists', { existingTool: fake.existing, spec: fake.spec, askers: [{ author: app.wish.author, url: app.wish.url, quote: app.wish.text, source: 'r/productivity' }] })
      continue
    }
    out.push(app)
    const n = fake?.askers ?? 2
    const found: Asker[] = [{ author: app.wish.author, url: app.wish.url, quote: app.wish.text, source: 'reddit' }]
    for (let i = 1; i < n; i++) {
      found.push({ author: `fake_asker_${app.slug.slice(0, 6)}_${i}`, url: `${app.wish.url}/asker${i}`, quote: app.wish.text, source: 'reddit' })
    }
    found.push(found[1] ?? found[0]) // duplicate on purpose: counting must dedupe by author
    app.askers = dedupe(found)
    app.spec = fake?.spec ?? app.wish.text
    app.why = fake?.why ?? 'You asked for it.'
  }
  return out.sort((a, b) => uniqueAuthors(b.askers) - uniqueAuthors(a.askers))
}
