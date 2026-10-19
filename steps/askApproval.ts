// PHOTON (iMessage) — ask the owner, wait for one reply. FAKE for now.
// REAL: @spectrum-ts/imessage (cloud package): send `text` (+ `image` attachment) to OWNER_PHONE,
// resolve with the next incoming message from OWNER_PHONE.
// FALLBACK after 9 PM if Photon isn't working: Composio Slack, post to SLACK_CHANNEL, resolve with the first thread reply.
import { fakeDelay } from '../lib/state'

// Scripted replies for the fake, e.g. FAKE_REPLIES="different,yes,yes". Runs out → "yes".
const scripted = (process.env.FAKE_REPLIES ?? 'yes,yes').split(',').map((s) => s.trim()).filter(Boolean)

export async function askApproval(text: string, image?: string): Promise<string> {
  console.log(`[photon] → owner: ${text}${image ? ` [image: ${image}]` : ''}`)
  await fakeDelay()
  const reply = scripted.shift() ?? 'yes'
  console.log(`[photon] ← owner: ${reply}`)
  return reply
}
