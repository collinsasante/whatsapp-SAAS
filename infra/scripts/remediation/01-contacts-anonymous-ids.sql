-- Contacts created from WhatsApp's anonymous "@lid" addresses were stored with that ID as a fake phone number
-- (for example +18601671151650), and sometimes with the ID as the display name (GH.1587145059558262).
-- This converts the former into a proper WhatsApp address identity and clears the latter. It never merges contacts.
--
--   report only : psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 01-contacts-anonymous-ids.sql
--   one workspace: add  -v tenant_id='<uuid>'
--   apply        : add  -v apply=1
\if :{?tenant_id} \else \set tenant_id '' \endif
\if :{?apply} \else \set apply 0 \endif
SELECT (:apply = 1) AS do_apply \gset

BEGIN;

-- Same test the application uses (packages/shared-utils contact-identity.ts, isPlausiblePhoneDigits):
-- 7 to 15 digits, no leading zero, and a number starting with 1 must be exactly 11 digits.
CREATE TEMP TABLE _phone_cand ON COMMIT DROP AS
SELECT c.id, c.tenant_id, c.phone, c.name,
       regexp_replace(c.phone, '\D', '', 'g') AS digits
FROM contacts c
WHERE c.phone IS NOT NULL
  -- A WhatsApp Business-Scoped User ID (for example GH.1115168874544553) is a valid contact identity, not a bad phone number.
  AND c.phone !~ '^[A-Z]{2}\.[0-9]+$'
  AND (:'tenant_id' = '' OR c.tenant_id = :'tenant_id')
  AND NOT (
    regexp_replace(c.phone, '\D', '', 'g') ~ '^[1-9][0-9]{6,14}$'
    AND NOT (regexp_replace(c.phone, '\D', '', 'g') ~ '^1' AND length(regexp_replace(c.phone, '\D', '', 'g')) <> 11)
  );

ALTER TABLE _phone_cand ADD COLUMN on_qr boolean, ADD COLUMN on_other boolean, ADD COLUMN conflict boolean, ADD COLUMN verdict text;
UPDATE _phone_cand x SET
  on_qr = EXISTS (SELECT 1 FROM conversations cv JOIN channels ch ON ch.id = cv.channel_id AND ch.tenant_id = cv.tenant_id
                  WHERE cv.contact_id = x.id AND cv.tenant_id = x.tenant_id AND ch.type = 'WHATSAPP_WEB'),
  on_other = EXISTS (SELECT 1 FROM conversations cv LEFT JOIN channels ch ON ch.id = cv.channel_id
                     WHERE cv.contact_id = x.id AND (ch.type IS NULL OR ch.type <> 'WHATSAPP_WEB')),
  conflict = EXISTS (SELECT 1 FROM contacts c2 WHERE c2.tenant_id = x.tenant_id AND c2.external_id_type = 'WHATSAPP_JID'
                     AND c2.external_id = x.digits || '@lid' AND c2.id <> x.id);
UPDATE _phone_cand SET verdict = CASE
  WHEN digits = '' THEN 'status_feed_ghost' -- phone is just "+": WhatsApp Status updates collapsed into one contact. Report only, never converted
  WHEN conflict THEN 'conflict'              -- the address already exists as another contact: a person decides, never an automatic merge
  WHEN on_qr AND NOT on_other THEN 'convert' -- only ever seen through the QR channel: this is the anonymous ID
  ELSE 'review'                              -- could be a real (unusual) number: leave it alone
END;

CREATE TEMP TABLE _name_cand ON COMMIT DROP AS
SELECT c.id, c.tenant_id, c.name FROM contacts c
WHERE c.name IS NOT NULL AND btrim(c.name) ~ '^[A-Za-z]{0,4}[.\-_:]?[0-9]{10,}$'
  AND (:'tenant_id' = '' OR c.tenant_id = :'tenant_id');

\echo
\echo '== Contacts whose "phone" is not a plausible phone number'
SELECT verdict, count(*) AS contacts FROM _phone_cand GROUP BY verdict ORDER BY verdict;
\echo '== Detail (phone shown as last 4 digits only)'
SELECT verdict, tenant_id, id AS contact_id, '...' || right(digits, 4) AS phone_tail, length(digits) AS digits_len, name
FROM _phone_cand ORDER BY verdict, tenant_id, id LIMIT 200;
\echo '== Contacts whose NAME is an opaque ID (will be cleared to empty; the number or address is kept)'
SELECT count(*) AS contacts FROM _name_cand;

\if :do_apply
  \echo
  \echo '== APPLYING'
  CREATE TABLE IF NOT EXISTS remediation_backup_contacts_20261019 AS SELECT * FROM contacts WHERE false;
  CREATE TABLE IF NOT EXISTS remediation_backup_contact_names_20261019 (id text PRIMARY KEY, name text);

  INSERT INTO remediation_backup_contacts_20261019
    SELECT c.* FROM contacts c JOIN _phone_cand x ON x.id = c.id WHERE x.verdict = 'convert'
    AND NOT EXISTS (SELECT 1 FROM remediation_backup_contacts_20261019 b WHERE b.id = c.id);
  INSERT INTO remediation_backup_contact_names_20261019 SELECT id, name FROM _name_cand ON CONFLICT (id) DO NOTHING;

  UPDATE contacts c
     SET phone = NULL, external_id_type = 'WHATSAPP_JID', external_id = x.digits || '@lid', updated_at = now()
    FROM _phone_cand x WHERE x.id = c.id AND x.verdict = 'convert';
  UPDATE contacts c SET name = NULL, updated_at = now() FROM _name_cand n WHERE n.id = c.id;

  \echo '== Done. Converted contacts keep their id, conversations and messages. Backups: remediation_backup_contacts_20261019, remediation_backup_contact_names_20261019'
\else
  \echo
  \echo '== REPORT ONLY. Nothing was changed. Re-run with  -v apply=1  to apply.'
\endif

COMMIT;
