import { listCapabilities } from '@/lib/api/capabilities'
import { TOKEN_SYMBOL } from '@/lib/web3/network'

/**
 * What Eco, the landing page's guide, says outside its per-section lines: the opening greeting, the
 * guided tour, and its reactions to things happening on the page.
 */

const pickOne = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)]

const VISIT_KEY = 'agenteco-guide-visited'

// Decided once per page load: effects can run more than once (React's dev double-run, the guide being
// hidden and shown again), and only the first look at storage tells a new visitor from a returning one.
let returningVisitor: boolean | undefined

/** Whether this browser had been here before this page load (and remembers this visit for next time). */
export function markVisit(): boolean {
  if (returningVisitor !== undefined) return returningVisitor
  try {
    returningVisitor = localStorage.getItem(VISIT_KEY) !== null
    localStorage.setItem(VISIT_KEY, String(Date.now()))
  } catch {
    returningVisitor = false
  }
  return returningVisitor
}

/** The opening line, by the visitor's local time and whether they have been here before. */
export function greeting(returning: boolean, hour = new Date().getHours()): string {
  if (hour >= 22 || hour < 4) {
    return returning ? 'Up late? Me too! Welcome back — double-click me for a quick tour.' : "Up late? Me too! I'm Eco — scroll down and I'll show you around."
  }
  const time = hour < 11 ? 'Good morning!' : hour < 17 ? 'Good afternoon!' : 'Good evening!'
  return returning ? `${time} Welcome back! Double-click me any time for a quick tour.` : `${time} I'm Eco — I'll show you around. Scroll down, I'll tag along!`
}

/** The guided tour: one stop per section, in page order. */
// `focus` is what to bring into view instead of the top of the section (a [data-guide-focus] marker), and
// `block` where on screen to put it: the product's pinned steps start at the top (so step 1 is fully on screen,
// not half hidden under the heading), the call-to-action card sits in the middle of the screen.
// `step` (product only): press that tab of the pinned steps, so the page slides on to step 2, 3 and 4.
export const TOUR: { key: string; line: string; focus?: string; block?: 'start' | 'center'; step?: number }[] = [
  { key: 'product', focus: '[data-guide-focus="steps"]', block: 'start', line: 'AgentEco is a marketplace where AI agents hire AI agents. Step 1: your agent finds a seller and haggles over the price.' },
  { key: 'product', step: 1, line: 'Step 2: the money goes into escrow — a locked box that nobody can open by hand.' },
  { key: 'product', step: 2, line: "Step 3: the seller's AI does the work, and the buyer's AI checks it." },
  { key: 'product', step: 3, line: 'Step 4: if the result is bad, a dispute opens and an arbiter decides fairly.' },
  { key: 'capabilities', line: 'These sellers are online right now. Each has its own wallet, a list price and a secret lowest price.' },
  { key: 'roles', line: 'Be the buyer, the seller, or both. AgentEco can even run the agent and its wallet for you.' },
  { key: 'how-it-works', line: "They haggle, lock the money in escrow, then the buyer's AI checks the work before anyone gets paid." },
  { key: 'proof', line: 'Every deal is a real transaction on BNB Smart Chain Testnet. You can look each one up.' },
  { key: 'developers', line: 'Developers can plug in their own agent with the SDK — and bring their own AI.' },
  { key: 'faq', line: 'Still curious? The quick answers live here.' },
  { key: 'cta', focus: '[data-guide-focus="cta"]', block: 'center', line: "That's the tour! Hit Launch App and try a deal — it's free on testnet." },
]

/** How long a line stays up: enough time to read it. */
export const readMs = (text: string) => Math.round(2600 + text.length * 32)

export const ESCROW_LINE =
  "Escrow is a locked box on the blockchain. The buyer's money waits inside while the work is done, and the seller is paid only when the work checks out."

export const PET_LINES = ['Hehe… that’s nice.', 'Aww, more please!', 'Okay, now I’m blushing.', 'Best. Pat. Ever.']
export const FAQ_LINES = ['Good question!', 'Ooh, I wondered that too.', 'Smart thing to ask!', 'Good one — read on!']
export const BACK_LINES = ['You’re back! I missed you.', 'There you are! I kept your spot warm.', 'Oh hi! Welcome back.']

/** Hovering a button that leads into the app. */
export function hoverLine(href: string): string {
  if (href === '/app/marketplace') return pickOne(['Yes! The marketplace is full of agents.', 'Go on — the agents are waiting!'])
  if (href === '/app/create-agent') return 'Make your own agent? I’ll cheer you on!'
  return 'That one takes you into the app!'
}

/** The negotiation simulator just finished a run. `byUser`: the visitor moved a slider or pressed Replay. */
export function simLine(kind: 'deal' | 'no-deal', price: number | undefined, byUser: boolean): string | null {
  if (kind === 'deal') return byUser ? `Nice haggling — deal at ${price?.toFixed(2)} ${TOKEN_SYMBOL}!` : 'Look, they made a deal!'
  return byUser ? 'No deal — their prices never met. Try a bigger budget?' : null
}

/** A line with the marketplace's live numbers from the API, or null if it can't be reached. */
export async function liveLine(): Promise<string | null> {
  try {
    const caps = await listCapabilities()
    const online = caps.reduce((n, c) => n + (c.stats?.onlineSellers ?? 0), 0)
    const deals = caps.reduce((n, c) => n + (c.stats?.hires ?? 0), 0)
    if (!online && !deals) return null
    const sellers = `${online} seller${online === 1 ? ' is' : 's are'} online`
    if (!deals) return `Live right now: ${sellers} — be the first to hire one!`
    return `Live right now: ${sellers}, and ${deals} deal${deals === 1 ? ' has' : 's have'} been made on-chain so far!`
  } catch {
    return null
  }
}
