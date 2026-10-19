// FAKE Parallel step. Used when PARALLEL_API_KEY is empty, so `npm run demo` works without keys.
// Saves the same shapes the real step saves (state.discovery, app.validation, app.askers), with
// realistic sample data, so the board shows the same thing when the real results come in.
import type { App, Asker, Checked, Hit } from '../lib/types'
import { state, save, advance, fakeDelay, sleep, uniqueAuthors } from '../lib/state'
import { newApp, dedupe } from './discover'

const DAY = 864e5
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString()
const thread = (sub: string, id: string, slug: string) => `https://www.reddit.com/r/${sub}/comments/${id}/${slug}/`

type FakeAsker = { author: string; subreddit: string; quote: string; days: number; id: string }
type FakeWish = {
  text: string; author: string; subreddit: string; days: number; id: string
  spec: string; why: string
  askers: FakeAsker[]
  checked: Checked[]
  priorArt: 'none' | 'partial' | 'strong_existing_tool'
  existing?: { name: string; url: string; why: string }
}

const FAKE_WISHES: FakeWish[] = [
  {
    text: 'I wish there was an app that splits a restaurant bill by item, not evenly', author: 'dinner_debts', subreddit: 'personalfinance', days: 2, id: '1q8x2bk',
    spec: 'a bill splitter that splits by item', why: 'Nothing good exists that works without an account.',
    askers: [
      { author: 'm_okafor', subreddit: 'Frugal', quote: 'Every bill app splits evenly. I want to pay for what I actually ate.', days: 9, id: '1q2m7ra' },
      { author: 'tabby_cat_42', subreddit: 'Cooking', quote: 'Is there a site where I tick who had what and it does the math?', days: 14, id: '1pv9d0c' },
      { author: 'jp_in_sf', subreddit: 'AskSF', quote: 'Group dinners always end in Venmo chaos. Someone build an itemized splitter.', days: 21, id: '1pn4k8e' },
      { author: 'ravi.builds', subreddit: 'webdev', quote: 'Surprised there is no free by-item bill splitter without a login.', days: 30, id: '1pf1y3q' },
      { author: 'hollowknight_fan', subreddit: 'college', quote: 'Roommate dinners: we need a split-by-item thing, not Splitwise.', days: 44, id: '1owq2ls' },
      { author: 'ana_travels', subreddit: 'solotravel', quote: 'Hostel dinners with 8 people, I wish an app just split by dish.', days: 61, id: '1oe0b7n' },
    ],
    checked: [
      { name: 'Splitwise', url: 'https://www.splitwise.com', verdict: 'needs an account, splits evenly by default' },
      { name: 'Tab', url: 'https://www.tabapp.co', verdict: 'iOS only, paid' },
      { name: 'Plates by Splitwise', url: 'https://www.splitwise.com/plates', verdict: 'discontinued' },
    ],
    priorArt: 'partial',
  },
  {
    text: 'Is there a tool that turns a recipe into a grocery list sorted by aisle?', author: 'weeknight_cook', subreddit: 'Cooking', days: 3, id: '1q7h5mc',
    spec: 'a recipe to grocery list sorter', why: 'Existing tools want you to sign up and pay.',
    askers: [
      { author: 'mealprep_mo', subreddit: 'MealPrepSunday', quote: 'I paste a recipe and want the list in store order. Does this exist?', days: 7, id: '1q3b9xt' },
      { author: 'hannah.bakes', subreddit: 'EatCheapAndHealthy', quote: 'Would pay for a grocery list that groups by aisle. Nothing free does it.', days: 18, id: '1pr6w2d' },
      { author: 'rp_runs', subreddit: 'loseit', quote: 'Someone should build: recipe in, aisle-sorted list out. No account.', days: 33, id: '1pb8c4v' },
    ],
    checked: [
      { name: 'AnyList', url: 'https://www.anylist.com', verdict: 'aisle sorting needs a subscription' },
      { name: 'Paprika', url: 'https://www.paprikaapp.com', verdict: 'paid app, no aisle order' },
      { name: 'Out of Milk', url: 'https://www.outofmilk.com', verdict: 'ads, cannot paste a recipe' },
    ],
    priorArt: 'partial',
  },
  {
    text: 'Someone should build a timer that tells you when your parking meter runs out', author: 'street_parked', subreddit: 'Seattle', days: 5, id: '1q5n3fd',
    spec: 'a parking meter countdown', why: 'Only city-specific apps exist.',
    askers: [{ author: 'dave_commutes', subreddit: 'driving', quote: 'I just want a countdown I can open in a browser when I park.', days: 12, id: '1pz1h9a' }],
    checked: [
      { name: 'ParkMobile', url: 'https://parkmobile.io', verdict: 'city-specific, needs an account' },
      { name: 'PayByPhone', url: 'https://www.paybyphone.com', verdict: 'only where the city uses it' },
    ],
    priorArt: 'partial',
  },
  {
    text: 'I wish there was a simple pomodoro timer website with no sign up', author: 'late_night_ta', subreddit: 'productivity', days: 1, id: '1q9c1pw',
    spec: 'a pomodoro timer with no sign up', why: '',
    askers: [],
    checked: [{ name: 'Pomofocus', url: 'https://pomofocus.io', verdict: 'free, no sign up, does exactly this' }],
    priorArt: 'strong_existing_tool',
    existing: { name: 'Pomofocus', url: 'https://pomofocus.io', why: 'Free, no sign up, does exactly this.' },
  },
]

// Posts the search also returned that are not wishes for software, or not buildable.
const NOISE: Hit[] = [
  { title: 'Is there an app that reminds me to water each plant on its own schedule?', subreddit: 'houseplants', author: 'fern_gully_', url: thread('houseplants', '1q6t4ke', 'is_there_an_app_that_reminds_me_to_water'), postedAt: ago(4) },
  { title: 'Someone should build a tool that tells me which streaming service has a movie', subreddit: 'cordcutters', author: 'remote_hog', url: thread('cordcutters', '1q4r8nn', 'someone_should_build_a_tool_that_tells_me'), postedAt: ago(6) },
  { title: 'Looking for a tool to rename thousands of photos by the date taken', subreddit: 'photography', author: 'shutter_nd', url: thread('photography', '1q2z6qb', 'looking_for_a_tool_to_rename_photos'), postedAt: ago(8) },
]

const wishUrl = (w: FakeWish) => thread(w.subreddit, w.id, w.text.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 50))
const QUERIES = ['I wish there was an app that', 'I wish there was a tool that', 'someone should build a website that', 'is there a tool that can']

export async function discover(): Promise<App[]> {
  console.log('[parallel] searching reddit for wishes (fake)')
  state.discovery = { startedAt: Date.now(), queries: QUERIES, hits: [] }
  save()
  await fakeDelay()
  const hits: Hit[] = [
    ...FAKE_WISHES.map((w) => ({ title: w.text, subreddit: w.subreddit, author: w.author, url: wishUrl(w), postedAt: ago(w.days) })),
    ...NOISE,
  ].sort((a, b) => (b.postedAt ?? '').localeCompare(a.postedAt ?? ''))
  state.discovery.hits = hits
  state.discovery.endedAt = Date.now()
  save()
  return FAKE_WISHES.map((w) => newApp(w.text, w.author, 'reddit', wishUrl(w)))
}

export async function validate(candidates: App[]): Promise<App[]> {
  console.log(`[parallel] validating ${candidates.length} wishes (fake)`)
  const out: App[] = []
  for (const app of candidates) {
    const w = FAKE_WISHES.find((w) => w.text === app.wish.text)
    const spec = w?.spec ?? app.wish.text
    app.spec = spec
    app.validation = { startedAt: Date.now(), queries: [`wish there was ${spec}`, `is there an app for ${spec}`, `looking for a tool ${spec}`], checked: [] }
    save()
    await fakeDelay()
    // askers land one at a time, the way the board should show them
    const found: Asker[] = [{ author: app.wish.author, url: app.wish.url, quote: app.wish.text, source: `r/${w?.subreddit ?? 'reddit'}`, postedAt: ago(w?.days ?? 2) }]
    for (const a of w?.askers ?? []) found.push({ author: a.author, url: thread(a.subreddit, a.id, a.quote.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 50)), quote: a.quote, source: `r/${a.subreddit}`, postedAt: ago(a.days) })
    found.push(found[1] ?? found[0]) // duplicate on purpose: counting must dedupe by author
    app.askers = []
    for (const a of dedupe(found)) {
      app.askers.push({ ...a, foundAt: Date.now() })
      save()
      await sleep(Number(process.env.FAKE_DELAY_MS ?? 700) / 3)
    }
    // then the prior-art check
    await fakeDelay()
    app.validation.checked = w?.checked ?? []
    app.validation.priorArt = w?.priorArt ?? 'none'
    app.validation.verdict = w?.existing ? `Already exists: ${w.existing.name}` : w?.why || 'Nothing like it exists.'
    app.validation.endedAt = Date.now()
    app.why = w?.why ?? 'You asked for it.'
    save()
    if (w?.existing) {
      advance(app.slug, 'exists', { existingTool: w.existing })
      continue
    }
    out.push(app)
  }
  return out.sort((a, b) => uniqueAuthors(b.askers) - uniqueAuthors(a.askers))
}
