-- The server reads the sale field rules: an explicit grant, not a default.
--
-- calculate_sale_status() reads public.sale_field_rules from the BEFORE trigger
-- on public.sales, and since #129 create-sale inserts the sale as the server
-- (service_role). sale-dictionary also reads the table as the server.
--
-- 20260909010000_sale_field_rules.sql granted SELECT to authenticated only and
-- left service_role to the platform's default grants. Production received
-- those defaults when the table was made, so it already holds this grant and
-- this statement changes nothing there. A database built from the migrations
-- alone (a preview branch, 2026-10-14) did not, and every server-side sale
-- insert failed with "permission denied for table sale_field_rules".

grant select on public.sale_field_rules to service_role;

-- Proof it landed (expect true):
--   select has_table_privilege('service_role', 'public.sale_field_rules', 'select');
