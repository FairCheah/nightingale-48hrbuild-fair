-- ============================================================================
-- 23_message_scope.sql
--
-- assessKeywordRisk returns a scope — in_scope, out_of_scope or unclear —
-- which decides whether Fairbloom offers its own nurse. It was never stored.
--
-- So ChatThread reconstructed it by string-searching risk_reason for
-- 'ambiguous_cardiac'. That label only appears on the MEDIUM cardiac rule.
-- A HIGH cardiac match produces "Emergency phrase matched: cardiac", which
-- does not contain it, so the reconstruction fell through to in_scope and
-- offered a Fairbloom nurse for crushing chest pain — the exact thing the
-- scope system exists to prevent.
--
-- The value was correct at the point it was computed and discarded one line
-- later. Storing it makes the UI read a fact instead of guessing at one.
--
-- Older rows stay null; the UI keeps its previous fallback for those.
-- ============================================================================

alter table messages
  add column if not exists scope text
  check (scope in ('in_scope', 'out_of_scope', 'unclear'));

comment on column messages.scope is
  'Whether this clinic can act on the concern, from assessKeywordRisk. '
  'Drives whether a Fairbloom nurse is offered. Stored rather than re-derived '
  'from risk_reason, which was wrong for every high-risk out-of-scope match.';