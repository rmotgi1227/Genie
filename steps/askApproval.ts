// PHOTON / iMESSAGE — ask the owner, wait for one reply. The loop routes the reply through the
// YES / NO / DIFFERENT switch in genie.ts; nothing here interprets it.
//   APPROVAL_TRANSPORT=imessage-local   this Mac's Messages app (OWNER_PHONE), no credentials
//   APPROVAL_TRANSPORT=imessage-cloud   Photon Cloud (PHOTON_PROJECT_ID, PHOTON_PROJECT_SECRET, OWNER_PHONE)
//   APPROVAL_TRANSPORT=slack            Slack (SLACK_TEAM_ID, SLACK_BOT_TOKEN, OWNER_ADDRESS)
//   unset / fake                        scripted replies from FAKE_REPLIES, for demos without a phone
// `image` is a board path like /apps/<slug>/screenshot.png; it's sent as an attachment when present.
import { fakeDelay } from '../lib/state'
import { chosenTransport, createMessenger, type Messenger } from '../lib/messenger'

const transport = chosenTransport()
let messenger: Promise<Messenger> | undefined

// Scripted replies for the fake, e.g. FAKE_REPLIES="different,yes,yes". Runs out → "yes".
const scripted = (process.env.FAKE_REPLIES ?? 'yes,yes').split(',').map((s) => s.trim()).filter(Boolean)

export async function askApproval(text: string, image?: string): Promise<string> {
  if (transport === 'fake') {
    console.log(`[photon] → owner: ${text}${image ? ` [image: ${image}]` : ''} (fake)`)
    await fakeDelay()
    const reply = scripted.shift() ?? 'yes'
    console.log(`[photon] ← owner: ${reply} (fake)`)
    return reply
  }
  messenger ??= createMessenger(transport)
  const m = await messenger
  const asked = Date.now()
  const file = image?.startsWith('/apps/') ? image.slice(1) : image // board URL → local path
  console.log(`[${transport}] → owner: ${text}${file ? ` [image: ${file}]` : ''}`)
  await m.send(text, file)
  const reply = await m.nextReply(asked)
  console.log(`[${transport}] ← owner: ${reply}`)
  return reply
}
