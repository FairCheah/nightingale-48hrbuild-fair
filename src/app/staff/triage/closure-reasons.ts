/**
 * Plain data, deliberately NOT in actions.ts.
 *
 * A 'use server' module may only export async functions - every export
 * becomes a callable server endpoint. Exporting this array from there made
 * Next refuse to load the whole module, which broke "Mark as seen" as well,
 * because acknowledgeEscalation lives in the same file.
 *
 * Kept in step with the CHECK constraint in migration 22. The database is the
 * authority; this list exists so the UI can render the options.
 */
export const CLOSURE_REASONS = [
  { value: 'seen_in_clinic', label: 'Seen in clinic' },
  { value: 'advised_no_visit_needed', label: 'Advised, no visit needed' },
  { value: 'referred_elsewhere', label: 'Referred elsewhere' },
  { value: 'no_response_from_patient', label: 'No response from patient' },
  { value: 'duplicate', label: 'Duplicate of another case' },
]