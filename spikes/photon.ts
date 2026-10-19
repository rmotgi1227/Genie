// Spike 1: text the owner and read the reply through the real switch.
//   APPROVAL_TRANSPORT=imessage-local OWNER_PHONE=+1... npx tsx spikes/photon.ts
// Passes if YES, NO, DIFFERENT and a free-text idea each come back routed correctly, and the round
// trip is timed (the DIFFERENT joke in the demo needs it under 5s).
import '../lib/env'
import { askApproval } from '../steps/askApproval'
import { routeReply } from '../lib/reply'

const t0 = Date.now()
const reply = await askApproval('Genie test. Reply YES, NO, DIFFERENT, or type an idea.')
console.log(`reply "${reply}" → ${routeReply(reply)} in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
const t1 = Date.now()
const reply2 = await askApproval('One more. Reply anything.', 'apps/i-wish-there-was-an-app-that-splits-a-re/screenshot.png')
console.log(`reply "${reply2}" → ${routeReply(reply2)} in ${((Date.now() - t1) / 1000).toFixed(1)}s (with screenshot)`)
process.exit(0)
