-- The legacy users.role column is only a fallback: a person's real role is their workspace membership. Invitation
-- acceptance used to hard-code AGENT into users.role, so an invited Owner, Admin or Manager looks like an Agent
-- there. Sign-in and /me now use the membership, so nobody loses or gains access from this repair; it only fixes
-- the fallback column for people who belong to the workspace they were created in (an invited member's users.role
-- belongs to THEIR home workspace, so it is left alone).
--
-- ONLY that exact signature is changed on apply: legacy AGENT while the membership is OWNER, ADMIN or MANAGER.
-- Every other disagreement is listed for a person to judge, because it may be evidence of a real mistake.
--
--   report only : psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 02-roles.sql
--   one workspace: add  -v tenant_id='<uuid>'
--   apply        : add  -v apply=1
\if :{?tenant_id} \else \set tenant_id '' \endif
\if :{?apply} \else \set apply 0 \endif
SELECT (:apply = 1) AS do_apply \gset

BEGIN;

CREATE TEMP TABLE _role_cand ON COMMIT DROP AS
SELECT u.id AS user_id, u.tenant_id, u.email, wm.role AS membership_role, u.role::text AS legacy_role,
       CASE wm.role WHEN 'OWNER' THEN 'ADMIN' WHEN 'ADMIN' THEN 'ADMIN' WHEN 'MANAGER' THEN 'ADMIN'
                    WHEN 'AGENT' THEN 'AGENT' ELSE 'VIEWER' END AS expected_legacy
FROM workspace_members wm
JOIN users u ON u.id = wm.user_id AND u.tenant_id = wm.workspace_id
WHERE wm.status = 'ACTIVE'
  AND u.role::text <> 'SUPER_ADMIN'              -- platform staff are never touched
  AND (:'tenant_id' = '' OR wm.workspace_id = :'tenant_id');

\echo
\echo '== 1. The known invitation bug: legacy AGENT, membership OWNER/ADMIN/MANAGER (will be set to ADMIN on apply)'
SELECT tenant_id, user_id, split_part(email, '@', 1) AS email_local, membership_role, legacy_role, expected_legacy
FROM _role_cand WHERE legacy_role = 'AGENT' AND membership_role IN ('OWNER', 'ADMIN', 'MANAGER') ORDER BY tenant_id, email LIMIT 200;
SELECT count(*) AS to_align FROM _role_cand WHERE legacy_role = 'AGENT' AND membership_role IN ('OWNER', 'ADMIN', 'MANAGER');

\echo
\echo '== 1b. REVIEW ONLY, never changed: any other disagreement between legacy role and membership'
SELECT tenant_id, user_id, split_part(email, '@', 1) AS email_local, membership_role, legacy_role, expected_legacy
FROM _role_cand WHERE legacy_role <> expected_legacy AND NOT (legacy_role = 'AGENT' AND membership_role IN ('OWNER', 'ADMIN', 'MANAGER'))
ORDER BY tenant_id, email LIMIT 200;

\echo
\echo '== 2. REVIEW ONLY, never changed automatically: legacy VIEWER but membership AGENT or higher (these are also in 1b)'
\echo '       (the old "create user" path stored every non-Admin role as AGENT, so a Viewer may have been over-granted)'
SELECT tenant_id, user_id, split_part(email, '@', 1) AS email_local, membership_role, legacy_role
FROM _role_cand WHERE legacy_role = 'VIEWER' AND membership_role IN ('AGENT', 'MANAGER', 'ADMIN', 'OWNER') ORDER BY tenant_id, email LIMIT 200;

\echo
\echo '== 3. REVIEW ONLY: workspaces with no active Owner'
SELECT t.id AS tenant_id, t.name FROM tenants t
WHERE (:'tenant_id' = '' OR t.id = :'tenant_id')
  AND NOT EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = t.id AND wm.role = 'OWNER' AND wm.status = 'ACTIVE')
ORDER BY t.name LIMIT 200;

\if :do_apply
  \echo
  \echo '== APPLYING (section 1 only: the known invitation bug)'
  CREATE TABLE IF NOT EXISTS remediation_backup_users_20261019 AS SELECT * FROM users WHERE false;
  INSERT INTO remediation_backup_users_20261019
    SELECT u.* FROM users u JOIN _role_cand x ON x.user_id = u.id
    WHERE x.legacy_role = 'AGENT' AND x.membership_role IN ('OWNER', 'ADMIN', 'MANAGER')
    AND NOT EXISTS (SELECT 1 FROM remediation_backup_users_20261019 b WHERE b.id = u.id);
  UPDATE users u SET role = x.expected_legacy::"UserRole", updated_at = now()
    FROM _role_cand x WHERE x.user_id = u.id AND x.legacy_role = 'AGENT' AND x.membership_role IN ('OWNER', 'ADMIN', 'MANAGER');
  \echo '== Done. Backup: remediation_backup_users_20261019'
\else
  \echo
  \echo '== REPORT ONLY. Nothing was changed. Re-run with  -v apply=1  to apply.'
\endif

COMMIT;
