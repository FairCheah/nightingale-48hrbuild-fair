-- ============================================================
-- 12. OPENING CHIPS
--
-- Three tappable prompts shown on the empty state, before the first message.
--
-- WHY: this clinic's subject matter is stigmatised, and the hardest part is
-- often typing the first sentence. A blank box asks someone to compose the
-- words they have been avoiding. A tappable "I have a question about my
-- periods" does not.
--
-- Deliberately BROAD. Chips name a topic, never a symptom — "a question about
-- my periods", not "heavy bleeding". A chip must not put a clinical claim in
-- someone's mouth that then lands in their medical record. The free-text box
-- stays visible throughout, because the chips are a door, not a menu.
-- ============================================================

alter table channel_rules
  add column if not exists opening_chips text[];

-- Social comment: they already asked something in public, so the chips
-- acknowledge that and offer the private version.
update channel_rules
set opening_chips = array[
  'I saw your post and had a question',
  'I''d rather not say this publicly',
  'What does the clinic actually do?'
]
where identity_level = 'handle_only';

-- Staff referral: the topic is already known, so chips move it forward
-- rather than asking them to restate it.
update channel_rules
set opening_chips = array[
  'Tell me more about that',
  'What happens at a first appointment?',
  'I have a different question'
]
where source_channel = 'staff_referral';

-- Everyone else: the three doors, broad enough that none is a diagnosis.
update channel_rules
set opening_chips = array[
  'I have a question about my periods',
  'I''m thinking about fertility',
  'Something feels off and I''m not sure'
]
where opening_chips is null;

select source_channel, identity_level, opening_chips
from channel_rules
order by source_channel
limit 10;