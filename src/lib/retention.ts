/**
 * GUEST DATA RETENTION — single source of truth.
 *
 * Brief §2 requires guest data destruction every X days plus a justification
 * for any PHI-free metadata kept for abandonment analytics. §4 ties session
 * recovery to the same X.
 *
 * We chose 14 days rather than longer because this clinic covers fertility,
 * women's health and sexual health. Unconsented, stigma-carrying free text is
 * a liability, not an asset. 14 days is long enough for a genuine returning
 * visitor to recover their thread.
 *
 * NOTE: lead_sessions.destroy_after still defaults to 30 days from migration
 * 01. Migration 10 lowers it. Until then this constant governs, and it is the
 * stricter of the two.
 */
export const GUEST_RETENTION_DAYS = 14

/** Cookie carrying the guest's recovery token. httpOnly — never readable by JS. */
export const GUEST_COOKIE = 'ng_guest_token'

export const GUEST_COOKIE_MAX_AGE = GUEST_RETENTION_DAYS * 24 * 60 * 60

/**
 * Application-level expiry, deliberately independent of destroy_after so a
 * stale database default can never widen the window beyond our policy.
 */
export function isGuestSessionExpired(
  landedAt: string | Date,
  destroyAfter: string | Date | null,
  now: Date = new Date(),
): boolean {
  const landed = new Date(landedAt)
  const policyCutoff = new Date(
    landed.getTime() + GUEST_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  )
  if (now > policyCutoff) return true
  if (destroyAfter && now > new Date(destroyAfter)) return true
  return false
}