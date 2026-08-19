-- Test data for sync_logs table — run this in Supabase SQL editor
-- Covers: both sources, all statuses, varied partner/stove counts, realistic entries

INSERT INTO sync_logs (
  source, status, application_name,
  started_at, completed_at, duration_ms,
  total_partners, partners_created, partners_updated, partners_failed,
  total_stove_ids, stove_ids_created, stove_ids_skipped,
  entries, request_summary, error_message
) VALUES

-- 1. CSV sync — full success, 3 partners
(
  'external-csv-sync', 'success', 'NABDA Portal',
  NOW() - INTERVAL '2 hours', NOW() - INTERVAL '2 hours' + INTERVAL '4321 ms', 4321,
  3, 2, 1, 0,
  8, 5, 3,
  '[
    {"step":"request","level":"info","message":"CSV sync request from application: NABDA Portal","ts":"2026-04-24T08:00:00Z"},
    {"step":"token-validation","level":"success","message":"Token validated successfully","ts":"2026-04-24T08:00:00.1Z"},
    {"step":"csv-parse","level":"success","message":"Parsed 3 partner(s) from CSV","detail":{"mappings_used":{"partner_id":"partner_id","partner_name":"partner_name","email":"email","stove_ids":"stove_ids"}},"ts":"2026-04-24T08:00:00.2Z"},
    {"step":"partner-processing","level":"info","message":"--- Processing partner B8A107: NABDA Abuja ---","ts":"2026-04-24T08:00:00.3Z"},
    {"step":"org-sync","level":"info","message":"Partner \"NABDA Abuja\" (B8A107) is new — creating","ts":"2026-04-24T08:00:00.4Z"},
    {"step":"org-sync","level":"success","message":"Partner created (org ID: 3e1f2a00-0001-0000-0000-000000000001)","ts":"2026-04-24T08:00:00.6Z"},
    {"step":"user-creation","level":"info","message":"No user found — creating admin user","ts":"2026-04-24T08:00:00.7Z"},
    {"step":"user-creation","level":"info","message":"Valid email — using email-based auth","ts":"2026-04-24T08:00:00.8Z"},
    {"step":"create-user","level":"success","message":"New auth user created (ID: auth-uid-0001)","ts":"2026-04-24T08:00:01.0Z"},
    {"step":"save-credentials","level":"success","message":"Credentials saved for partner B8A107","ts":"2026-04-24T08:00:01.1Z"},
    {"step":"user-creation","level":"success","message":"Admin user created for org 3e1f2a00-0001-0000-0000-000000000001","ts":"2026-04-24T08:00:01.2Z"},
    {"step":"stove-ids","level":"info","message":"Processing 3 stove ID(s) for NABDA Abuja","ts":"2026-04-24T08:00:01.3Z"},
    {"step":"stove-ids","level":"success","message":"Stove IDs done — created: 3, already existed: 0","ts":"2026-04-24T08:00:01.5Z"},
    {"step":"partner-processing","level":"info","message":"--- Processing partner 598581: LAPO Microfinance ---","ts":"2026-04-24T08:00:01.6Z"},
    {"step":"org-sync","level":"info","message":"Partner \"LAPO Microfinance\" (598581) already exists — updating","ts":"2026-04-24T08:00:01.7Z"},
    {"step":"org-sync","level":"success","message":"Partner updated (org ID: 3e1f2a00-0002-0000-0000-000000000002)","ts":"2026-04-24T08:00:01.9Z"},
    {"step":"stove-ids","level":"info","message":"Processing 2 stove ID(s) for LAPO Microfinance","ts":"2026-04-24T08:00:02.0Z"},
    {"step":"stove-ids","level":"success","message":"Stove IDs done — created: 1, already existed: 1","ts":"2026-04-24T08:00:02.2Z"},
    {"step":"partner-processing","level":"info","message":"--- Processing partner FMF001: FMF Partners Ltd ---","ts":"2026-04-24T08:00:02.3Z"},
    {"step":"org-sync","level":"info","message":"Partner \"FMF Partners Ltd\" (FMF001) is new — creating","ts":"2026-04-24T08:00:02.4Z"},
    {"step":"org-sync","level":"success","message":"Partner created (org ID: 3e1f2a00-0003-0000-0000-000000000003)","ts":"2026-04-24T08:00:02.6Z"},
    {"step":"user-creation","level":"warn","message":"Invalid email \"not-an-email\" — using username-based login: fmf001_fmf","ts":"2026-04-24T08:00:02.7Z"},
    {"step":"create-user","level":"success","message":"New auth user created (ID: auth-uid-0003)","ts":"2026-04-24T08:00:02.9Z"},
    {"step":"save-credentials","level":"success","message":"Credentials saved for partner FMF001","ts":"2026-04-24T08:00:03.0Z"},
    {"step":"stove-ids","level":"info","message":"Processing 3 stove ID(s) for FMF Partners Ltd","ts":"2026-04-24T08:00:03.1Z"},
    {"step":"stove-ids","level":"success","message":"Stove IDs done — created: 1, already existed: 2","ts":"2026-04-24T08:00:03.3Z"},
    {"step":"complete","level":"success","message":"CSV sync complete — 3 succeeded, 0 failed out of 3 partners","ts":"2026-04-24T08:00:03.4Z"}
  ]'::jsonb,
  '{"application_name":"NABDA Portal","total_partners":3,"field_mappings_used":{"partner_id":"partner_id","partner_name":"partner_name","email":"email","stove_ids":"stove_ids"},"origin_url":"https://nabda.gov.ng"}'::jsonb,
  NULL
),

-- 2. API sync — success, single partner with stove IDs
(
  'external-sync', 'success', 'AgriTech Connect',
  NOW() - INTERVAL '5 hours', NOW() - INTERVAL '5 hours' + INTERVAL '1843 ms', 1843,
  1, 0, 1, 0,
  5, 0, 5,
  '[
    {"step":"request","level":"info","message":"Request received from application: AgriTech Connect","detail":{"partner_id":"AGT-009","partner_name":"Green Harvest Ltd","stove_ids_count":5,"origin_url":"https://agritech.example.com"},"ts":"2026-04-24T05:00:00Z"},
    {"step":"token-validation","level":"success","message":"Token validated successfully","ts":"2026-04-24T05:00:00.1Z"},
    {"step":"org-sync","level":"info","message":"Partner \"Green Harvest Ltd\" (AGT-009) already exists — updating","ts":"2026-04-24T05:00:00.3Z"},
    {"step":"org-sync","level":"success","message":"Partner updated (org ID: 3e1f2a00-0009-0000-0000-000000000009)","ts":"2026-04-24T05:00:00.5Z"},
    {"step":"stove-ids","level":"info","message":"Processing 5 stove ID(s)","ts":"2026-04-24T05:00:00.6Z"},
    {"step":"stove-ids","level":"success","message":"Stove IDs done — created: 0, already existed: 5","ts":"2026-04-24T05:00:01.8Z"}
  ]'::jsonb,
  '{"application_name":"AgriTech Connect","partner_id":"AGT-009","partner_name":"Green Harvest Ltd","email_provided":true,"stove_ids_count":5,"origin_url":"https://agritech.example.com"}'::jsonb,
  NULL
),

-- 3. CSV sync — partial (2 success, 1 failed)
(
  'external-csv-sync', 'partial', 'NABDA Portal',
  NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day' + INTERVAL '6102 ms', 6102,
  3, 1, 1, 1,
  4, 3, 1,
  '[
    {"step":"request","level":"info","message":"CSV sync request from application: NABDA Portal","ts":"2026-04-23T08:00:00Z"},
    {"step":"token-validation","level":"success","message":"Token validated successfully","ts":"2026-04-23T08:00:00.1Z"},
    {"step":"csv-parse","level":"success","message":"Parsed 3 partner(s) from CSV","ts":"2026-04-23T08:00:00.2Z"},
    {"step":"partner-processing","level":"info","message":"--- Processing partner NB001: Niger Bridge Coop ---","ts":"2026-04-23T08:00:00.3Z"},
    {"step":"org-sync","level":"info","message":"Partner \"Niger Bridge Coop\" (NB001) is new — creating","ts":"2026-04-23T08:00:00.4Z"},
    {"step":"org-sync","level":"success","message":"Partner created (org ID: 3e1f2a00-00a1-0000-0000-0000000000a1)","ts":"2026-04-23T08:00:00.6Z"},
    {"step":"user-creation","level":"info","message":"No user found — creating admin user","ts":"2026-04-23T08:00:00.7Z"},
    {"step":"user-creation","level":"info","message":"Valid email — using email-based auth","ts":"2026-04-23T08:00:00.8Z"},
    {"step":"create-user","level":"success","message":"New auth user created (ID: auth-uid-00a1)","ts":"2026-04-23T08:00:01.0Z"},
    {"step":"save-credentials","level":"success","message":"Credentials saved for partner NB001","ts":"2026-04-23T08:00:01.1Z"},
    {"step":"stove-ids","level":"info","message":"Processing 2 stove ID(s) for Niger Bridge Coop","ts":"2026-04-23T08:00:01.2Z"},
    {"step":"stove-ids","level":"success","message":"Stove IDs done — created: 2, already existed: 0","ts":"2026-04-23T08:00:01.4Z"},
    {"step":"partner-processing","level":"info","message":"--- Processing partner KD-22: Kaduna MFB ---","ts":"2026-04-23T08:00:01.5Z"},
    {"step":"org-sync","level":"info","message":"Partner \"Kaduna MFB\" (KD-22) already exists — updating","ts":"2026-04-23T08:00:01.6Z"},
    {"step":"org-sync","level":"success","message":"Partner updated (org ID: 3e1f2a00-00b2-0000-0000-0000000000b2)","ts":"2026-04-23T08:00:01.8Z"},
    {"step":"stove-ids","level":"info","message":"Processing 2 stove ID(s) for Kaduna MFB","ts":"2026-04-23T08:00:01.9Z"},
    {"step":"stove-ids","level":"success","message":"Stove IDs done — created: 1, already existed: 1","ts":"2026-04-23T08:00:02.1Z"},
    {"step":"partner-processing","level":"info","message":"--- Processing partner XX-BAD: Broken Entry Corp ---","ts":"2026-04-23T08:00:02.2Z"},
    {"step":"org-sync","level":"info","message":"Partner \"Broken Entry Corp\" (XX-BAD) is new — creating","ts":"2026-04-23T08:00:02.3Z"},
    {"step":"org-sync","level":"error","message":"duplicate key value violates unique constraint \"organizations_partner_id_key\"","ts":"2026-04-23T08:00:02.5Z"},
    {"step":"partner-processing","level":"error","message":"Failed to process partner XX-BAD: Organization sync failed: duplicate key value violates unique constraint","ts":"2026-04-23T08:00:02.6Z"},
    {"step":"complete","level":"warn","message":"CSV sync complete — 2 succeeded, 1 failed out of 3 partners","ts":"2026-04-23T08:00:02.7Z"}
  ]'::jsonb,
  '{"application_name":"NABDA Portal","total_partners":3,"field_mappings_used":{"partner_id":"partner_id","partner_name":"partner_name","email":"email","stove_ids":"stove_ids"}}'::jsonb,
  NULL
),

-- 4. API sync — failed (bad token)
(
  'external-sync', 'failed', 'Unknown App',
  NOW() - INTERVAL '3 days', NOW() - INTERVAL '3 days' + INTERVAL '210 ms', 210,
  1, 0, 0, 1,
  0, 0, 0,
  '[
    {"step":"request","level":"info","message":"Request received from application: Unknown App","detail":{"partner_id":"TEST-01","partner_name":"Test Partner","stove_ids_count":0},"ts":"2026-04-21T10:00:00Z"},
    {"step":"token-validation","level":"error","message":"Invalid token, secret key, or application name","ts":"2026-04-21T10:00:00.2Z"}
  ]'::jsonb,
  '{"application_name":"Unknown App","partner_id":"TEST-01","partner_name":"Test Partner"}'::jsonb,
  'Invalid token, secret key, or application name'
),

-- 5. CSV sync — failed (bad CSV format)
(
  'external-csv-sync', 'failed', 'LAPO Integration',
  NOW() - INTERVAL '2 days', NOW() - INTERVAL '2 days' + INTERVAL '380 ms', 380,
  0, 0, 0, 0,
  0, 0, 0,
  '[
    {"step":"request","level":"info","message":"CSV sync request from application: LAPO Integration","ts":"2026-04-22T14:00:00Z"},
    {"step":"token-validation","level":"success","message":"Token validated successfully","ts":"2026-04-22T14:00:00.1Z"},
    {"step":"csv-parse","level":"error","message":"CSV parsing failed: Required field ''partner_id'' not found. Expected one of: partner_id, partnerid, partner_code, partner-id","ts":"2026-04-22T14:00:00.3Z"}
  ]'::jsonb,
  '{"application_name":"LAPO Integration","origin_url":"https://lapo.example.com"}'::jsonb,
  'Required field ''partner_id'' not found. Expected one of: partner_id, partnerid, partner_code, partner-id'
),

-- 6. API sync — success, new partner with no email (username-based)
(
  'external-sync', 'success', 'AgriTech Connect',
  NOW() - INTERVAL '6 hours', NOW() - INTERVAL '6 hours' + INTERVAL '2190 ms', 2190,
  1, 1, 0, 0,
  2, 2, 0,
  '[
    {"step":"request","level":"info","message":"Request received from application: AgriTech Connect","detail":{"partner_id":"RRL-045","partner_name":"Rural Reach Ltd","stove_ids_count":2},"ts":"2026-04-24T02:00:00Z"},
    {"step":"token-validation","level":"success","message":"Token validated successfully","ts":"2026-04-24T02:00:00.1Z"},
    {"step":"org-sync","level":"info","message":"Partner \"Rural Reach Ltd\" (RRL-045) is new — creating","ts":"2026-04-24T02:00:00.3Z"},
    {"step":"org-sync","level":"success","message":"Partner created successfully (org ID: 3e1f2a00-0045-0000-0000-000000000045)","ts":"2026-04-24T02:00:00.5Z"},
    {"step":"user-creation","level":"warn","message":"No email provided — generated username-based login: rrl045_rural","ts":"2026-04-24T02:00:00.6Z"},
    {"step":"create-user","level":"info","message":"Creating user — email: rrl045_ru..., username: rrl045_rural","ts":"2026-04-24T02:00:00.7Z"},
    {"step":"create-user","level":"success","message":"New auth user created (ID: auth-uid-0045)","ts":"2026-04-24T02:00:01.0Z"},
    {"step":"create-user","level":"success","message":"Profile created successfully","ts":"2026-04-24T02:00:01.2Z"},
    {"step":"save-credentials","level":"success","message":"Credentials saved for partner RRL-045","ts":"2026-04-24T02:00:01.3Z"},
    {"step":"user-creation","level":"success","message":"Admin user created successfully for org 3e1f2a00-0045-0000-0000-000000000045","ts":"2026-04-24T02:00:01.4Z"},
    {"step":"stove-ids","level":"info","message":"Processing 2 stove ID(s)","ts":"2026-04-24T02:00:01.5Z"},
    {"step":"stove-ids","level":"success","message":"Stove IDs done — created: 2, already existed: 0","ts":"2026-04-24T02:00:02.1Z"}
  ]'::jsonb,
  '{"application_name":"AgriTech Connect","partner_id":"RRL-045","partner_name":"Rural Reach Ltd","email_provided":false,"stove_ids_count":2}'::jsonb,
  NULL
),

-- 7. CSV sync — large batch, success
(
  'external-csv-sync', 'success', 'NABDA Portal',
  NOW() - INTERVAL '4 days', NOW() - INTERVAL '4 days' + INTERVAL '18450 ms', 18450,
  10, 7, 3, 0,
  30, 22, 8,
  '[
    {"step":"request","level":"info","message":"CSV sync request from application: NABDA Portal","ts":"2026-04-20T09:00:00Z"},
    {"step":"token-validation","level":"success","message":"Token validated successfully","ts":"2026-04-20T09:00:00.1Z"},
    {"step":"csv-parse","level":"success","message":"Parsed 10 partner(s) from CSV","ts":"2026-04-20T09:00:00.2Z"},
    {"step":"partner-processing","level":"info","message":"--- Processing partner P001: Abuja Cooperative ---","ts":"2026-04-20T09:00:00.3Z"},
    {"step":"org-sync","level":"success","message":"Partner created (org ID: org-p001)","ts":"2026-04-20T09:00:00.6Z"},
    {"step":"stove-ids","level":"success","message":"Stove IDs done — created: 3, already existed: 0","ts":"2026-04-20T09:00:01.1Z"},
    {"step":"partner-processing","level":"info","message":"--- Processing partner P002: Kano Rural MFB ---","ts":"2026-04-20T09:00:01.2Z"},
    {"step":"org-sync","level":"success","message":"Partner created (org ID: org-p002)","ts":"2026-04-20T09:00:01.5Z"},
    {"step":"stove-ids","level":"success","message":"Stove IDs done — created: 2, already existed: 1","ts":"2026-04-20T09:00:01.9Z"},
    {"step":"partner-processing","level":"info","message":"--- Processing partner P003: Lagos Clean Energy ---","ts":"2026-04-20T09:00:02.0Z"},
    {"step":"org-sync","level":"info","message":"Partner already exists — updating","ts":"2026-04-20T09:00:02.1Z"},
    {"step":"org-sync","level":"success","message":"Partner updated (org ID: org-p003)","ts":"2026-04-20T09:00:02.3Z"},
    {"step":"stove-ids","level":"warn","message":"Skipping invalid stove entry","detail":{"raw":""},"ts":"2026-04-20T09:00:02.4Z"},
    {"step":"stove-ids","level":"success","message":"Stove IDs done — created: 4, already existed: 2","ts":"2026-04-20T09:00:02.8Z"},
    {"step":"complete","level":"success","message":"CSV sync complete — 10 succeeded, 0 failed out of 10 partners","ts":"2026-04-20T09:00:18.4Z"}
  ]'::jsonb,
  '{"application_name":"NABDA Portal","total_partners":10,"field_mappings_used":{"partner_id":"partner_id","partner_name":"partner_name","email":"email","stove_ids":"stove_ids","sales_factory":"factory"}}'::jsonb,
  NULL
),

-- 8. API sync — failed (user creation error, org was created but user failed)
(
  'external-sync', 'failed', 'AgriTech Connect',
  NOW() - INTERVAL '7 hours', NOW() - INTERVAL '7 hours' + INTERVAL '3210 ms', 3210,
  1, 0, 0, 1,
  0, 0, 0,
  '[
    {"step":"request","level":"info","message":"Request received from application: AgriTech Connect","detail":{"partner_id":"ERR-007","partner_name":"Error Test Corp","stove_ids_count":0},"ts":"2026-04-24T01:00:00Z"},
    {"step":"token-validation","level":"success","message":"Token validated successfully","ts":"2026-04-24T01:00:00.1Z"},
    {"step":"org-sync","level":"info","message":"Partner \"Error Test Corp\" (ERR-007) is new — creating","ts":"2026-04-24T01:00:00.3Z"},
    {"step":"org-sync","level":"success","message":"Partner created successfully (org ID: 3e1f2a00-0007-0000-0000-000000000007)","ts":"2026-04-24T01:00:00.5Z"},
    {"step":"user-creation","level":"info","message":"No user found — creating admin user","ts":"2026-04-24T01:00:00.6Z"},
    {"step":"create-user","level":"info","message":"Creating user — email: errortes..., username: err007_error","ts":"2026-04-24T01:00:00.7Z"},
    {"step":"create-user","level":"error","message":"Auth user creation failed: User already registered","ts":"2026-04-24T01:00:02.8Z"},
    {"step":"user-creation","level":"error","message":"User creation failed: Auth user creation failed: User already registered","ts":"2026-04-24T01:00:02.9Z"},
    {"step":"sync","level":"error","message":"Organization sync failed: Auth user creation failed: User already registered","ts":"2026-04-24T01:00:03.2Z"}
  ]'::jsonb,
  '{"application_name":"AgriTech Connect","partner_id":"ERR-007","partner_name":"Error Test Corp","email_provided":true,"stove_ids_count":0}'::jsonb,
  'Organization sync failed: Auth user creation failed: User already registered'
);
