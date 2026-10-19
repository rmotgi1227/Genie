// PHOTON / iMESSAGE — ask the owner, wait for one reply. The loop routes the reply through the
// YES / NO / DIFFERENT switch in lib/reply.ts; nothing here interprets it.
//   APPROVAL_TRANSPORT=imessage-local   this Mac's Messages app (OWNER_PHONE), no credentials
//   APPROVAL_TRANSPORT=imessage-cloud   Photon Cloud (PHOTON_PROJECT_ID, PHOTON_PROJECT_SECRET, OWNER_PHONE)
//   APPROVAL_TRANSPORT=slack            Slack (SLACK_TEAM_ID, SLACK_BOT_TOKEN, OWNER_ADDRESS)
//   unset / fake                        scripted replies from FAKE_REPLIES, for demos without a phone
// `image` is a board path like /apps/<slug>/screenshot.png; it's sent as an attachment when present.
// A transport error is retried with backoff (the messenger is rebuilt), so one dropped
// connection doesn't kill the run.
import { fakeDelay, sleep } from '../lib/state'
import { chosenTransport, createMessenger, type Messenger } from '../lib/messenger'

const transport = chosenTransport()
let messenger: Promise<Messenger> | undefined
const RETRIES = Number(process.env.APPROVAL_RETRIES ?? 5)

// Scripted replies for the fake, e.g. FAKE_REPLIES="different,yes,yes". Runs out → "yes".
const scripted = (process.env.FAKE_REPLIES ?? 'yes,yes,yes').split(',').map((s) => s.trim()).filter(Boolean)

export const approvalsAreFake = () => transport === 'fake'

export async function askApproval(text: string, image?: string): Promise<string> {
  if (transport === 'fake') {
    console.log(`[photon] → owner: ${text}${image ? ` [image: ${image}]` : ''} (fake)`)
    await fakeDelay()
    const reply = scripted.shift() ?? 'yes'
    console.log(`[photon] ← owner: ${reply} (fake)`)
    return reply
  }
  const file = image?.startsWith('/apps/') ? image.slice(1) : image // board URL → local path
  for (let attempt = 1; ; attempt++) {
    try {
      messenger ??= createMessenger(transport)
      const m = await messenger
      const asked = Date.now()
      console.log(`[${transport}] → owner: ${text}${file ? ` [image: ${file}]` : ''}`)
      await m.send(text, file)
      const reply = await m.nextReply(asked)
      console.log(`[${transport}] ← owner: ${reply}`)
      return reply
    } catch (e) {
      const old = messenger
      messenger = undefined
      old?.then((m) => m.stop()).catch(() => {})
      if (attempt > RETRIES) throw e
      const wait = Math.min(30_000, 2_000 * 2 ** (attempt - 1))
      console.log(`[${transport}] failed (${(e as Error).message}), retrying in ${wait / 1000}s (${attempt}/${RETRIES})`)
      await sleep(wait)
    }
  }
}

// One-way text to the owner (no reply expected), e.g. "it's live, here's the link". Never throws:
// a failed heads-up must not undo a launch that already happened.
export async function notify(text: string): Promise<void> {
  if (transport === 'fake') {
    console.log(`[photon] → owner: ${text} (fake)`)
    return
  }
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      messenger ??= createMessenger(transport)
      const m = await messenger
      console.log(`[${transport}] → owner: ${text}`)
      await m.send(text)
      return
    } catch (e) {
      const old = messenger
      messenger = undefined
      old?.then((m) => m.stop()).catch(() => {})
      const wait = Math.min(30_000, 2_000 * 2 ** (attempt - 1))
      console.log(`[${transport}] notify failed (${(e as Error).message}), retrying in ${wait / 1000}s (${attempt}/${RETRIES})`)
      await sleep(wait)
    }
  }
}
