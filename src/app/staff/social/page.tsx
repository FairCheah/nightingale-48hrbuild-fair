import { redirect } from 'next/navigation'
import SocialSimulator from './SocialSimulator'

export const metadata = { title: 'Social channel — Fairbloom staff' }

/**
 * Protected by proxy.ts along with the rest of /staff. This is a development
 * and demonstration tool: it fires a real POST at the real webhook handler,
 * so everything downstream of the signature check is exercised exactly as it
 * would be in production.
 *
 * The CHANNEL is not staff-driven. In production Meta posts to
 * /api/webhooks/instagram with an HMAC signature and no person is involved.
 * Only the trigger is simulated; the handler is the real one, and the
 * boundary between them is a signature check rather than a separate code
 * path.
 *
 * That bypass header is refused when NODE_ENV is 'production', so in a real
 * deployment this page would be a button that cannot work. Hiding it there is
 * more honest than leaving staff a control that silently fails.
 */
export default function SocialPage() {
  if (process.env.NODE_ENV === 'production') {
    redirect('/staff/leads?denied=simulator_is_dev_only')
  }

  return <SocialSimulator />
}