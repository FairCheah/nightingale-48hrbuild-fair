update channel_rules
set opening_template = replace(
  opening_template,
  'Women''s Health''s assistant',
  'Women''s Health''s AI assistant'
)
where opening_template like '%Women''s Health''s assistant%';

-- Confirm nothing still says plain "assistant".
select source_channel, identity_level, opening_template
from channel_rules
where opening_template ilike '%assistant%'
  and opening_template not ilike '%AI assistant%';