import { config } from 'dotenv'

/**
 * Tests run against the real Supabase project, using synthetic data only as
 * the brief requires. Every test that writes cleans up after itself, and
 * tags its rows so a failed run leaves nothing a later run could mistake
 * for real traffic.
 */
config({ path: '.env.local' })