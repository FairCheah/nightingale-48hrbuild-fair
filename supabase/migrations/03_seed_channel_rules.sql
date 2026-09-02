-- ============================================================
-- FAIRBLOOM — CHANNEL RULES v2 (declarative opening strategy)
-- channel x identity_level x time_of_day x intent -> opening
-- Lower priority number wins (more specific rules rank first).
-- ============================================================

-- Determinism: exactly one rule per combination.
create unique index if not exists channel_rules_unique_combo
  on channel_rules (source_channel, identity_level, time_of_day, intent);

insert into channel_rules
  (source_channel, identity_level, time_of_day, intent, opening_strategy, opening_template, ask_for_email, priority)
values

-- ================= STAFF REFERRAL (topic pre-loaded) =================
('staff_referral', 'anonymous', 'any', 'any',
 'prefilled_topic',
 'Hi — your care team at Fairbloom mentioned you were asking about {{referral_topic}}. I can share general information now, and connect you with the clinic whenever you''re ready. What would you like to know?',
 false, 10),

('staff_referral', 'email_known', 'any', 'any',
 'prefilled_topic_identified',
 'Hi — your Fairbloom care team noted you asked about {{referral_topic}}. I already have your contact details, so I won''t ask again. Where would you like to start?',
 false, 10),

-- ================= SOCIAL COMMENT (handle known only) =================
('instagram_comment', 'handle_only', 'any', 'any',
 'warm_private_reply',
 'Hi {{social_handle}} — thanks for commenting on our post. I''m Nightingale, Fairbloom''s assistant. This chat is private, and you don''t need an account. What''s on your mind?',
 false, 20),

('tiktok_comment', 'handle_only', 'any', 'any',
 'warm_private_reply',
 'Hi {{social_handle}} — you commented on our video, so here''s a private space to ask properly. I''m Nightingale, Fairbloom''s assistant. No sign-up needed. What would you like to know?',
 false, 20),

('facebook_comment', 'handle_only', 'any', 'any',
 'warm_private_reply',
 'Hi {{social_handle}} — thanks for reaching out on our post. I''m Nightingale from Fairbloom. This is private, and you don''t need to sign up. What can I help with?',
 false, 20),

('instagram_comment', 'handle_only', 'night', 'any',
 'warm_private_reply_night',
 'Hi {{social_handle}} — thanks for commenting. It''s late, so the clinic team is offline, but I can answer general questions now and pass anything on when they''re back. This chat is private.',
 false, 15),

-- ================= AD CLICKS (anonymous + campaign) =================
('instagram_ad_click', 'anonymous', 'any', 'any',
 'campaign_context',
 'Hi, I''m Nightingale — Fairbloom''s assistant. You came from our {{campaign_id}} post. Ask me anything about it; no account needed, and nothing is shared with the clinic unless you choose to send it.',
 false, 30),

('google_ad_click', 'anonymous', 'any', 'any',
 'campaign_context',
 'Hi, I''m Nightingale — Fairbloom''s assistant. Happy to answer general questions about {{campaign_id}}. No sign-up required, and nothing goes to the clinic unless you ask me to send it.',
 false, 30),

('instagram_ad_click', 'anonymous', 'night', 'any',
 'campaign_context_night',
 'Hi, I''m Nightingale — Fairbloom''s assistant. It''s late, and a lot of people look things up at this hour. I can answer general questions now; the clinic team replies during opening hours. Nothing is shared unless you choose to send it.',
 false, 25),

('google_ad_click', 'anonymous', 'night', 'any',
 'campaign_context_night',
 'Hi, I''m Nightingale from Fairbloom. It''s late — I can help with general information right now, and the clinic team picks things up in the morning. Nothing goes to them unless you ask.',
 false, 25),

-- ================= GOOGLE REVIEWS ("ask us" link in reply) =================
('google_reviews', 'anonymous', 'any', 'any',
 'review_reply_link',
 'Hi, I''m Nightingale — Fairbloom''s assistant. You followed an "ask us" link from one of our review replies. Ask me anything general; nothing is shared with the clinic unless you choose to send it.',
 false, 30),

-- ================= WEBSITE WIDGET (page context) =================
('website_widget', 'anonymous', 'any', 'any',
 'page_context',
 'Hi, I''m Nightingale. I see you''re reading about {{page_context}} — I can answer general questions about it right here. No account needed.',
 false, 40),

('website_widget', 'anonymous', 'night', 'any',
 'page_context_night',
 'Hi, I''m Nightingale. It''s late to be reading about {{page_context}} — I can answer general questions now, and a human at Fairbloom can follow up during clinic hours.',
 false, 35),

-- ================= LEAD FORM (email volunteered) =================
('lead_form', 'email_known', 'any', 'any',
 'identified_no_repeat',
 'Hi, I''m Nightingale from Fairbloom. Thanks for leaving your details — I already have your email, so I won''t ask again. What would you like to know?',
 false, 50),

-- ================= INTENT-BASED RULES (bonus) =================
-- These outrank generic channel rules when intent is detected.
('instagram_ad_click', 'anonymous', 'any', 'fertility',
 'intent_fertility',
 'Hi, I''m Nightingale from Fairbloom. Questions about fertility timing and options are some of the most common ones we get — and there''s no wrong time to ask. I can share general information; nothing reaches the clinic unless you send it.',
 false, 12),

('website_widget', 'anonymous', 'any', 'fertility',
 'intent_fertility',
 'Hi, I''m Nightingale. Fertility questions are rarely simple, and asking early tends to widen your options rather than narrow them. I can cover the general picture here — no account needed.',
 false, 12),

('instagram_comment', 'handle_only', 'any', 'sexual_health',
 'intent_sexual_health',
 'Hi {{social_handle}} — this is a private chat, and nothing you write here is visible on your post or to the clinic unless you choose to send it. Sexual health questions are completely routine here. What would you like to know?',
 false, 11),

('website_widget', 'anonymous', 'any', 'sexual_health',
 'intent_sexual_health',
 'Hi, I''m Nightingale. This chat is private and anonymous — nothing goes to the clinic unless you send it. Sexual and reproductive health questions are among the most common ones we answer. Ask away.',
 false, 11),

('google_ad_click', 'anonymous', 'any', 'pregnancy',
 'intent_pregnancy',
 'Hi, I''m Nightingale from Fairbloom. I can share general pregnancy information here. If anything you describe needs a clinician, I''ll tell you honestly and help you send it to the team.',
 false, 12),

('website_widget', 'anonymous', 'night', 'pregnancy',
 'intent_pregnancy_night',
 'Hi, I''m Nightingale. Late-night pregnancy worries are very common. I can give general information now — and if what you describe needs urgent attention, I''ll say so plainly rather than reassure you.',
 false, 8),

-- ================= FALLBACKS (one per identity level) =================
('default', 'anonymous', 'any', 'any',
 'generic_warm',
 'Hi, I''m Nightingale — Fairbloom Fertility & Women''s Health''s assistant. Ask me anything general; no account needed. If something needs a clinician, I''ll help you send it to the team.',
 false, 999),

('default', 'handle_only', 'any', 'any',
 'generic_warm_handle',
 'Hi {{social_handle}} — I''m Nightingale, Fairbloom''s assistant. This chat is private and you don''t need an account. What would you like to know?',
 false, 999),

('default', 'email_known', 'any', 'any',
 'generic_warm_identified',
 'Hi, I''m Nightingale from Fairbloom. I already have your contact details, so I won''t ask again. What can I help with?',
 false, 999);