import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { App, Stage, State } from './types'

const FILE = 'state.json'

export const state: State = existsSync(FILE)
  ? JSON.parse(readFileSync(FILE, 'utf8'))
  : { candidates: [], apps: [] }

export function save() {
  writeFileSync(FILE, JSON.stringify(state, null, 2))
}

export function reset() {
  state.candidates = []
  state.apps = []
  delete state.pendingApproval
  state.events = []
  delete state.sample
  save()
}

export function find(slug: string): App | undefined {
  return state.apps.find((a) => a.slug === slug) ?? state.candidates.find((a) => a.slug === slug)
}

// The one way anything changes an app. Everyone shares this.
export function advance(slug: string, stage: Stage, patch: Partial<App> = {}): App {
  const app = find(slug)
  if (!app) throw new Error(`advance: no app ${slug}`)
  const t = Date.now()
  Object.assign(app, patch, { stage })
  app.stageAt = { ...app.stageAt, [stage]: t }
  ;(state.events ??= []).push({ t, slug, stage })
  save()
  console.log(`[genie] ${slug} → ${stage}`)
  return app
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export const fakeDelay = () => {
  if (!state.sample) {
    state.sample = true
    save()
  }
  return sleep(Number(process.env.FAKE_DELAY_MS ?? 700))
}

export const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)

export const uniqueAuthors = (askers: { author: string }[]) =>
  new Set(askers.map((a) => a.author.toLowerCase())).size
