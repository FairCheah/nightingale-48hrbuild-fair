import SocialSimulator from './SocialSimulator'

export const metadata = { title: 'Social channel — Fairbloom staff' }

/**
 * Protected by proxy.ts along with the rest of /staff. This is a development
 * and demonstration tool: it fires a real POST at the real webhook handler,
 * so everything downstream of the signature check is exercised exactly as it
 * would be in production.
 */
export default function SocialPage() {
  return <SocialSimulator />
}