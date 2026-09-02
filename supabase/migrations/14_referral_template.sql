-- ============================================================
-- 14. STAFF REFERRAL TEMPLATE — survive whatever staff type
--
-- The old template read "...asking about {{referral_topic}}", which is only
-- grammatical when the topic is a noun phrase. Staff type sentences, because
-- nothing told them not to. Rather than police the input, quote it: a quoted
-- fragment reads correctly whether it is two words or twenty, and showing
-- the patient the exact note is more honest than paraphrasing it.
-- ============================================================

update channel_rules
set opening_template =
  'Hi — your care team at Fairbloom passed on a note from your visit: ' ||
  '"{{referral_topic}}". I can share general information about that now, ' ||
  'and connect you with the clinic whenever you''re ready. ' ||
  'What would you like to know?'
where source_channel = 'staff_referral'
  and identity_level = 'anonymous';

update channel_rules
set opening_template =
  'Hi — your Fairbloom care team noted: "{{referral_topic}}". ' ||
  'I already have your contact details, so I won''t ask again. ' ||
  'Where would you like to start?'
where source_channel = 'staff_referral'
  and identity_level = 'email_known';

select identity_level, opening_template
from channel_rules
where source_channel = 'staff_referral';