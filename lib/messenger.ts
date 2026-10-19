// One way to text the owner and wait for a reply, over whichever transport APPROVAL_TRANSPORT picks:
//   imessage-local  this Mac's Messages app via @spectrum-ts/imessage-local (needs Full Disk Access, no credentials)
//   imessage-cloud  Photon Cloud via @spectrum-ts/imessage (PHOTON_PROJECT_ID + PHOTON_PROJECT_SECRET)
//   slack           @spectrum-ts/slack (SLACK_TEAM_ID + SLACK_BOT_TOKEN, OWNER_ADDRESS = channel or user id)
// All three ride on spectrum-ts, so the send/receive code is the same; only the provider config differs.
// Shapes checked against @spectrum-ts/core@12.12 types: Spectrum({providers}), app.messages yields
// [space, message], message.content.type === 'text', space.send(text, attachment(path)).
import { resolve } from 'node:path'
import { Spectrum, attachment } from '@spectrum-ts/core'

export type Transport = 'imessage-local' | 'imessage-cloud' | 'slack'

export type Messenger = {
  transport: Transport
  send(text: string, imagePath?: string): Promise<void>
  // Resolves with the first reply from the owner that arrives after `after` (ms since epoch).
  nextReply(after: number): Promise<string>
  stop(): Promise<void>
}

export function chosenTransport(): Transport | 'fake' {
  const t = process.env.APPROVAL_TRANSPORT
  if (t === 'imessage-local' || t === 'imessage-cloud' || t === 'slack') return t
  if (t && t !== 'fake') throw new Error(`APPROVAL_TRANSPORT must be imessage-local, imessage-cloud, slack or fake (got ${t})`)
  return 'fake'
}

const digits = (s: string) => s.replace(/\D/g, '')
const env = (k: string) => {
  const v = process.env[k]
  if (!v) throw new Error(`${k} missing in .env`)
  return v
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPlatform = any // the three providers have different Def generics; we only use config() and platform(app).space

async function providerFor(transport: Transport): Promise<{ platform: AnyPlatform; config: unknown; project?: { projectId: string; projectSecret: string } }> {
  if (transport === 'imessage-local') {
    const { localIMessage } = await import('@spectrum-ts/imessage-local')
    return { platform: localIMessage, config: localIMessage.config() }
  }
  if (transport === 'imessage-cloud') {
    const { imessage } = await import('@spectrum-ts/imessage')
    return { platform: imessage, config: imessage.config(), project: { projectId: env('PHOTON_PROJECT_ID'), projectSecret: env('PHOTON_PROJECT_SECRET') } }
  }
  const { slack } = await import('@spectrum-ts/slack')
  return { platform: slack, config: slack.config({ tokens: { [env('SLACK_TEAM_ID')]: env('SLACK_BOT_TOKEN') } }) }
}

export async function createMessenger(transport: Transport): Promise<Messenger> {
  const owner = transport === 'slack' ? env('OWNER_ADDRESS') : env('OWNER_PHONE')
  const { platform, config, project } = await providerFor(transport)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const app: any = await Spectrum({ ...(project ?? {}), providers: [config] } as any)
  const space = await platform(app).space.create(owner) // platform(app) → PlatformInstance, per @spectrum-ts/core types
  console.log(`[${transport}] ready, talking to ${owner} (space ${space.id})`)

  // Every text in the owner's DM that Genie didn't send lands here; askers take the first one newer than
  // their question. Direction isn't trusted: when the Mac and the phone share an Apple ID, the owner's
  // replies are also "from me" in chat.db.
  const sent = new Set<string>()
  const inbox: { t: number; text: string }[] = []
  let wake: (() => void) | undefined
  const isOwner = (sp: { id?: string }, m: { sender?: { id?: string } }) =>
    sp.id === space.id || (!!m.sender?.id && digits(m.sender.id).endsWith(digits(owner).slice(-10)))
  const listen = (async () => {
    for await (const [sp, m] of app.messages as AsyncIterable<[{ id?: string }, { direction?: string; content: { type: string; text?: string }; sender?: { id?: string }; timestamp?: Date }]>) {
      if (m.content?.type !== 'text' || !m.content.text) continue
      if (!isOwner(sp, m)) continue
      if (sent.has(m.content.text.trim())) continue // our own question echoed back
      inbox.push({ t: m.timestamp?.getTime() ?? Date.now(), text: m.content.text })
      wake?.()
    }
  })()
  listen.catch((e) => console.error(`[${transport}] listener stopped:`, e))

  return {
    transport,
    async send(text, imagePath) {
      sent.add(text.trim())
      if (imagePath) await space.send(text, attachment(resolve(imagePath)))
      else await space.send(text)
    },
    async nextReply(after) {
      let waited = 0
      while (true) {
        const i = inbox.findIndex((r) => r.t > after)
        if (i >= 0) return inbox.splice(i, 1)[0].text
        await new Promise<void>((r) => { wake = r; setTimeout(r, 60_000) })
        wake = undefined
        if ((waited += 60) % 300 === 0) console.log(`[${transport}] still waiting for a reply (${waited / 60} min)`)
      }
    },
    stop: () => app.stop?.() ?? Promise.resolve(),
  }
}
