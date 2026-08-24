-- Khyte CRM — demo seed data
--
-- The same records that used to live in lib/mock-data/, now as real rows. IDs
-- are fixed (not random) so relationships stay stable and the file can be run
-- more than once: every insert is `on conflict (id) do nothing`, so re-running
-- never duplicates rows and never overwrites edits you have made since.
--
-- owner_id is left null — there is no auth yet. When auth lands, claim these
-- rows with:  update companies set owner_id = '<your-user-uuid>'; (and so on)
--
-- This is optional. Skip it entirely if you would rather start with an empty
-- CRM; the app runs fine against empty tables.

-- Companies -----------------------------------------------------------------

insert into companies (id, name, domain, industry, size, location, tags) values
  ('11111111-1111-4111-8111-000000000001', 'Meridian Labs',    'meridianlabs.io',   'SaaS',           '50-200',  'Berlin, DE',     '{enterprise,high-intent}'),
  ('11111111-1111-4111-8111-000000000002', 'Nordvik Capital',  'nordvik.com',       'Finance',        '200-500', 'Stockholm, SE',  '{warm,decision-maker-engaged}'),
  ('11111111-1111-4111-8111-000000000003', 'Calloway Systems', 'calloway.systems',  'Infrastructure', '10-50',   'London, UK',     '{cold,researched}'),
  ('11111111-1111-4111-8111-000000000004', 'Sable Analytics',  'sableanalytics.co', 'Data',           '50-200',  'Amsterdam, NL',  '{proposal-sent}'),
  ('11111111-1111-4111-8111-000000000005', 'Fenwick Advisory', 'fenwick.io',        'Consulting',     '10-50',   'Paris, FR',      '{new,referral}'),
  ('11111111-1111-4111-8111-000000000006', 'Orin Technologies','orin.tech',         'Hardware',       '500+',    'Munich, DE',     '{enterprise,slow-moving}')
on conflict (id) do nothing;

-- Contacts ------------------------------------------------------------------

insert into contacts (id, company_id, name, role, email, linkedin) values
  ('22222222-2222-4222-8222-000000000001', '11111111-1111-4111-8111-000000000001', 'Elena Hartmann',   'VP of Growth',      'e.hartmann@meridianlabs.io', 'linkedin.com/in/elenahartmann'),
  ('22222222-2222-4222-8222-000000000002', '11111111-1111-4111-8111-000000000002', 'Marcus Lindqvist', 'CFO',               'm.lindqvist@nordvik.com',    null),
  ('22222222-2222-4222-8222-000000000003', '11111111-1111-4111-8111-000000000003', 'James Okafor',     'Head of Ops',       'j.okafor@calloway.systems',  null),
  ('22222222-2222-4222-8222-000000000004', '11111111-1111-4111-8111-000000000004', 'Priya Nair',       'CEO',               'priya@sableanalytics.co',    'linkedin.com/in/priyanair'),
  ('22222222-2222-4222-8222-000000000005', '11111111-1111-4111-8111-000000000005', 'Théo Moreau',      'Managing Partner',  't.moreau@fenwick.io',        null),
  ('22222222-2222-4222-8222-000000000006', '11111111-1111-4111-8111-000000000006', 'Ingrid Bauer',     'CTO',               'i.bauer@orin.tech',          null)
on conflict (id) do nothing;

-- Opportunities -------------------------------------------------------------

insert into opportunities (id, company_id, contact_id, stage, priority, in_pipeline, deal_value, next_step, follow_up_date, last_interaction, tags, notes) values
  ('33333333-3333-4333-8333-000000000001', '11111111-1111-4111-8111-000000000001', '22222222-2222-4222-8222-000000000001', 'Warm',           'high',     true,   48000, 'Send revised proposal with updated pricing', '2026-04-02', '2026-03-24', '{enterprise,high-intent}',      'Elena responded positively to the demo. Main concern is onboarding timeline.'),
  ('33333333-3333-4333-8333-000000000002', '11111111-1111-4111-8111-000000000002', '22222222-2222-4222-8222-000000000002', 'Meeting Booked', 'high',     true,  120000, 'Discovery call Thursday 2pm',               '2026-03-27', '2026-03-22', '{warm,decision-maker-engaged}', 'Marcus connected via LinkedIn. They are evaluating 3 vendors.'),
  ('33333333-3333-4333-8333-000000000003', '11111111-1111-4111-8111-000000000003', '22222222-2222-4222-8222-000000000003', 'Contacted',      'medium',   true,   24000, 'Follow up on email sent last week',         '2026-03-28', '2026-03-18', '{cold}',                        'No reply yet. Sent intro email with case study.'),
  ('33333333-3333-4333-8333-000000000004', '11111111-1111-4111-8111-000000000004', '22222222-2222-4222-8222-000000000004', 'Proposal Sent',  'critical', true,   75000, 'Check if proposal was reviewed',            '2026-03-26', '2026-03-20', '{proposal-sent}',               'Priya asked for a 12-month contract option. Board decision next week.'),
  ('33333333-3333-4333-8333-000000000005', '11111111-1111-4111-8111-000000000005', '22222222-2222-4222-8222-000000000005', 'New',            'low',      false,  18000, 'Research company and personalize outreach', '2026-04-05', '2026-03-25', '{new,referral}',                'Referred by existing client. No contact made yet.'),
  ('33333333-3333-4333-8333-000000000006', '11111111-1111-4111-8111-000000000006', '22222222-2222-4222-8222-000000000006', 'Negotiation',    'high',     true,  200000, 'Legal review of contract terms',            '2026-03-30', '2026-03-23', '{enterprise,slow-moving}',      'Ingrid wants custom SLA terms. Legal is involved on their side.'),
  ('33333333-3333-4333-8333-000000000007', '11111111-1111-4111-8111-000000000001', '22222222-2222-4222-8222-000000000001', 'Researched',     'medium',   false,  32000, 'Draft personalized outreach email',         '2026-04-01', '2026-03-21', '{researched}',                  'Secondary opportunity at Meridian Labs for their EU expansion team.')
on conflict (id) do nothing;

-- Notes ---------------------------------------------------------------------

insert into notes (id, company_id, opportunity_id, raw, created_at, ai_extracted) values
  (
    '44444444-4444-4444-8444-000000000001',
    '11111111-1111-4111-8111-000000000001',
    null,
    'Called Elena this morning. She mentioned their Q2 budget is locked in and they need something deployed before June. Pain is around manual reporting — their ops team spends 3 days a month on it. She wants a demo for the exec team next week.',
    '2026-03-24T10:32:00Z',
    '{"company":"Meridian Labs","contact":"Elena Hartmann","suggestedStage":"Warm","painPoints":["Manual reporting taking 3 days/month","Q2 deadline pressure"],"nextStep":"Book exec team demo for next week","followUpDate":"2026-03-31"}'::jsonb
  ),
  (
    '44444444-4444-4444-8444-000000000002',
    null,
    null,
    'Nordvik — Marcus mentioned they tried a competitor last year and it was a disaster. Migration issues. Wants to know about our data portability story. Also asked about SOC2.',
    '2026-03-22T14:15:00Z',
    '{"company":"Nordvik Capital","contact":"Marcus Lindqvist","suggestedStage":"Meeting Booked","painPoints":["Bad experience with competitor","Data portability concerns","SOC2 requirement"],"nextStep":"Prepare data portability one-pager and SOC2 cert"}'::jsonb
  ),
  (
    '44444444-4444-4444-8444-000000000003',
    null,
    null,
    'random thought — should we build a lighter tier for smb? seems like we keep losing deals under 10k because pricing is too high. talk to the team about this.',
    '2026-03-25T09:00:00Z',
    null
  )
on conflict (id) do nothing;

-- Strategy headlines and cards (all for the Nordvik Capital opportunity) -----
--
-- Headlines are per-opportunity free text, so these are just this deal's
-- lanes. Another deal starts with an empty board.

insert into strategy_columns (id, opportunity_id, title, sort_order) values
  ('77777777-7777-4777-8777-000000000001', '33333333-3333-4333-8333-000000000002', 'Pain Points',  0),
  ('77777777-7777-4777-8777-000000000002', '33333333-3333-4333-8333-000000000002', 'Stakeholders', 1),
  ('77777777-7777-4777-8777-000000000003', '33333333-3333-4333-8333-000000000002', 'Objections',   2),
  ('77777777-7777-4777-8777-000000000004', '33333333-3333-4333-8333-000000000002', 'Offer Angle',  3),
  ('77777777-7777-4777-8777-000000000005', '33333333-3333-4333-8333-000000000002', 'Proof',        4),
  ('77777777-7777-4777-8777-000000000006', '33333333-3333-4333-8333-000000000002', 'Next Actions', 5)
on conflict (id) do nothing;

insert into strategy_cards (id, opportunity_id, column_id, content, sort_order) values
  ('55555555-5555-4555-8555-000000000001', '33333333-3333-4333-8333-000000000002', '77777777-7777-4777-8777-000000000001', 'Manual vendor evaluation process taking 2 months',   0),
  ('55555555-5555-4555-8555-000000000002', '33333333-3333-4333-8333-000000000002', '77777777-7777-4777-8777-000000000001', 'No unified view of spend across subsidiaries',      1),
  ('55555555-5555-4555-8555-000000000003', '33333333-3333-4333-8333-000000000002', '77777777-7777-4777-8777-000000000002', 'Marcus Lindqvist — CFO (decision maker)',           0),
  ('55555555-5555-4555-8555-000000000004', '33333333-3333-4333-8333-000000000002', '77777777-7777-4777-8777-000000000002', 'Anna Berg — VP Ops (influencer, daily user)',       1),
  ('55555555-5555-4555-8555-000000000005', '33333333-3333-4333-8333-000000000002', '77777777-7777-4777-8777-000000000003', 'Price is 20% above current solution',               0),
  ('55555555-5555-4555-8555-000000000006', '33333333-3333-4333-8333-000000000002', '77777777-7777-4777-8777-000000000003', 'Concerned about migration timeline',                1),
  ('55555555-5555-4555-8555-000000000007', '33333333-3333-4333-8333-000000000002', '77777777-7777-4777-8777-000000000004', 'ROI on ops time savings: 40hrs/month recovered',    0),
  ('55555555-5555-4555-8555-000000000008', '33333333-3333-4333-8333-000000000002', '77777777-7777-4777-8777-000000000005', 'Fenwick case study — similar size, same industry',  0),
  ('55555555-5555-4555-8555-000000000009', '33333333-3333-4333-8333-000000000002', '77777777-7777-4777-8777-000000000006', 'Send SOC2 certificate and data portability doc',    0),
  ('55555555-5555-4555-8555-00000000000a', '33333333-3333-4333-8333-000000000002', '77777777-7777-4777-8777-000000000006', 'Book discovery call for Thursday',                  1)
on conflict (id) do nothing;

-- Tasks ---------------------------------------------------------------------

insert into tasks (id, title, description, related_opportunity_id, related_company_id, due_date, completed, priority, created_at) values
  ('66666666-6666-4666-8666-000000000001', 'Send revised proposal to Elena',              'Updated pricing with the volume discount she asked about', '33333333-3333-4333-8333-000000000001', '11111111-1111-4111-8111-000000000001', '2026-03-26', false, 'high',     '2026-03-24T10:00:00Z'),
  ('66666666-6666-4666-8666-000000000002', 'Prepare SOC2 cert and data portability doc',  'Marcus asked for these during the last call',              '33333333-3333-4333-8333-000000000002', '11111111-1111-4111-8111-000000000002', '2026-03-27', false, 'high',     '2026-03-22T15:00:00Z'),
  ('66666666-6666-4666-8666-000000000003', 'Follow up on intro email to Calloway',        'Sent case study last week, no reply yet',                  '33333333-3333-4333-8333-000000000003', '11111111-1111-4111-8111-000000000003', '2026-03-28', false, 'medium',   '2026-03-18T09:00:00Z'),
  ('66666666-6666-4666-8666-000000000004', 'Check if Sable reviewed the proposal',        'Priya mentioned board decision next week',                 '33333333-3333-4333-8333-000000000004', '11111111-1111-4111-8111-000000000004', '2026-03-26', false, 'critical', '2026-03-20T14:00:00Z'),
  ('66666666-6666-4666-8666-000000000005', 'Research Fenwick Advisory before outreach',   'Referred by existing client — personalize the approach',   '33333333-3333-4333-8333-000000000005', '11111111-1111-4111-8111-000000000005', '2026-04-01', false, 'low',      '2026-03-25T11:00:00Z'),
  ('66666666-6666-4666-8666-000000000006', 'Review Orin contract terms with legal',       'Ingrid wants custom SLA — need legal sign-off',            '33333333-3333-4333-8333-000000000006', '11111111-1111-4111-8111-000000000006', '2026-03-29', false, 'high',     '2026-03-23T16:00:00Z'),
  ('66666666-6666-4666-8666-000000000007', 'Book exec demo for Meridian Labs',            'Elena wants to show the platform to her leadership team',  '33333333-3333-4333-8333-000000000001', '11111111-1111-4111-8111-000000000001', '2026-03-25', true,  'high',     '2026-03-24T10:32:00Z'),
  ('66666666-6666-4666-8666-000000000008', 'Explore lighter tier for SMB segment',        'Internal task — losing deals under 10k on pricing',        null,                                   null,                                   '2026-04-10', false, 'medium',   '2026-03-25T09:00:00Z')
on conflict (id) do nothing;
