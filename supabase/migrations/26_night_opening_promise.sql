-- ============================================================================
-- 26_night_opening_promise.sql
--
-- The after-hours instagram_comment opening said the clinic team was offline
-- "but I can answer general questions now and pass anything on when they're
-- back."
--
-- That last clause is a promise the build cannot keep for this channel. An
-- instagram_comment lead is handle_only: no email, no phone, no push. If she
-- asks something at 23:30 and closes the tab, nothing reaches her when the
-- team is back. It is the same shape as the escalation confirmation that told
-- her the clinic had no way to reply - copy describing a capability that does
-- not exist.
--
-- The replacement moves the action to her: she can ask to send it, whenever
-- she likes. That is what actually happens, and it is what the rest of this
-- build argues for - the person decides when the clinic is involved.
--
-- The opening still names no condition. She commented publicly, and a DM
-- saying "you asked about egg freezing" arrives on a lock screen where
-- someone else can read it. The chips carry the specificity instead, in
-- private, including "I'd rather not say this publicly".
-- ============================================================================

update channel_rules
set opening_template =
  'Hi {{social_handle}} — thanks for commenting. It''s late, so the clinic ' ||
  'team is offline, but I can answer general questions now, and you can ask ' ||
  'me to send anything to a nurse whenever you like. This chat is private.'
where source_channel = 'instagram_comment'
  and time_of_day = 'night'
  and active = true;

select time_of_day, opening_template
from channel_rules
where source_channel = 'instagram_comment' and active = true;