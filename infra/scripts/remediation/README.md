# Data remediation (October 2026)

Three one-off repairs for records created by bugs that are now fixed in code. Each is **read-only by default**:
it prints what it would change. Nothing is written until you ask for it, every change is backed up first, and
nothing is ever merged or deleted.

Run against **staging first**, read the report, then apply. Take a database dump before applying on production.

| Script | What it repairs | Backup |
|---|---|---|
| `01-contacts-anonymous-ids.sql` | Contacts whose "phone" is really WhatsApp's anonymous `@lid` ID, and names that are opaque IDs | `remediation_backup_contacts_20261019`, `remediation_backup_contact_names_20261019` |
| `02-roles.sql` | Home-workspace users whose legacy role column disagrees with their workspace membership | `remediation_backup_users_20261019` |
| `node dist/manage/webhooks/webhook-secret-backfill.cli.js [--apply]` (inside the backend container) | Webhook secrets stored as plaintext | none needed (idempotent; reversible only with the key, so keep it safe) |

## Webhook secrets need the encryption key first

`CREDENTIALS_ENCRYPTION_KEY` must be set on the backend (a 32-byte base64 value). Without it the app stores secrets as plain
text and this script refuses to run, because "encrypting" without a key would just write the same text back. Set the key,
restart the backend, then run the script (dry run first). **Back the key up somewhere safe: lost key means lost secrets.**

## Running the SQL scripts

From the server, through the database container (no client install needed):
```bash
docker exec -i wa_staging_postgres psql -U waplatform -d waplatform_staging -v ON_ERROR_STOP=1 \
  < infra/scripts/remediation/01-contacts-anonymous-ids.sql
```
or directly with `psql` as below.

```bash
# 1. Report only (default). Safe at any time.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f infra/scripts/remediation/01-contacts-anonymous-ids.sql

# 2. Restrict to one workspace (recommended for the first real run).
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v tenant_id='<workspace-uuid>' -f infra/scripts/remediation/01-contacts-anonymous-ids.sql

# 3. Apply, after reading the report.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v apply=1 -f infra/scripts/remediation/01-contacts-anonymous-ids.sql
```

Each script runs in one transaction, so a failure changes nothing. Re-running after applying finds nothing to do.

## What is deliberately NOT changed automatically

- A contact whose odd-looking number could be real (it has conversations outside the WhatsApp Web channel) is listed
  as **review**, not converted.
- A contact whose anonymous address already exists as another contact is listed as **conflict**. Contacts are never merged.
- Members whose workspace role is *lower* than their legacy role, or who might have been over-granted by the old
  "create user" path, are listed for an admin to decide. Permissions are not reduced automatically.
- Platform staff (legacy role `SUPER_ADMIN`) are never touched.

## Rolling back

```sql
-- contacts
UPDATE contacts c SET phone = b.phone, external_id_type = b.external_id_type, external_id = b.external_id, updated_at = now()
FROM remediation_backup_contacts_20261019 b WHERE b.id = c.id;
UPDATE contacts c SET name = b.name, updated_at = now()
FROM remediation_backup_contact_names_20261019 b WHERE b.id = c.id;
-- roles
UPDATE users u SET role = b.role, updated_at = now() FROM remediation_backup_users_20261019 b WHERE b.id = u.id;
```
