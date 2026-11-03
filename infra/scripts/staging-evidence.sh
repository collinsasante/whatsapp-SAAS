#!/usr/bin/env bash
# STAGING EVIDENCE COLLECTOR: READ-ONLY. Run it on the staging host without leaving a file there, from your machine:
#   ssh <staging> 'bash -s' < infra/scripts/staging-evidence.sh > staging-evidence.txt 2>&1
# or on the host as root:   bash staging-evidence.sh > staging-evidence.txt 2>&1
# Review the output before sharing it:   grep -inE 'secret|password|token|apikey|api_key|BEGIN |sk-' staging-evidence.txt
# It never starts, stops, recreates or restarts anything; never writes except stdout; every SQL statement is a SELECT in a READ ONLY session.
# It prints NAMES, hashes, versions, counts and capacities only. Lines that look secret-like (secret/password/token/key/credential/encrypt)
# are withheld from any file or crontab it prints. It does NOT read the production database or the production checkout.
# The preflight scripts are run with --no-minio-test, so even the one write they normally make (a MinIO round trip) is skipped.
set +e
export LC_ALL=C
CHECKOUT=${CHECKOUT:-/root/staging-release-checkout}
BK=${BK:-/root/staging-release-backups}
withhold() { awk '{ l=tolower($0); if (l ~ /secret|password|passwd|token|api_?key|private|credential|encrypt/) print "<line withheld: secret-like name>"; else print }'; }
sec() { printf '\n########## %s\n' "$1"; }
BE=wa_staging_backend; PG=wa_staging_postgres
psqlq() { docker exec -i -e PGOPTIONS='-c default_transaction_read_only=on' "$PG" sh -c 'psql -X -U "$POSTGRES_USER" -d "'"$DBNAME"'" -At'; }

# The body runs in a function with stdin closed, so nothing in it can swallow the rest of this file when it is piped in with `bash -s`.
main() {
sec "0 identity"; date -u +%FT%TZ; hostname -s; uname -sr; id -un
sec "1 capacity"; df -hP / /root /var/lib/docker 2>&1; echo; free -m; echo; docker system df; echo; docker info --format 'docker {{.ServerVersion}} root={{.DockerRootDir}} cpus={{.NCPU}} mem={{.MemTotal}}'
sec "1b containers"; docker ps -a --format '{{.Names}} | {{.Image}} | {{.Status}}' ; for c in $(docker ps -aq); do docker inspect -f '{{.Name}} restart-policy={{.HostConfig.RestartPolicy.Name}}' "$c"; done
sec "1c container memory"; docker stats --no-stream --format '{{.Name}} cpu={{.CPUPerc}} mem={{.MemUsage}}'
sec "2 images (backend, postgres)"
for c in $BE $PG; do echo "-- $c"; docker inspect -f 'config-image={{.Config.Image}}
image-id={{.Image}}
created={{.Created}}
compose-project={{index .Config.Labels "com.docker.compose.project"}}
compose-service={{index .Config.Labels "com.docker.compose.service"}}
compose-config-hash={{index .Config.Labels "com.docker.compose.config-hash"}}' $c; docker image inspect -f 'repo-tags={{.RepoTags}} digests={{.RepoDigests}} id={{.Id}}' "$(docker inspect -f '{{.Image}}' $c)"; done
echo "-- postgres server"; docker exec $PG postgres --version
DBNAME=$(docker exec $BE sh -c 'echo "$DATABASE_URL"' | sed -E 's#^[^@]*@[^/]*/##; s#\?.*$##'); echo "database name: $DBNAME"
sec "2b other service images"; for c in $(docker ps --format '{{.Names}}' | grep '^wa_staging_'); do echo "$c $(docker inspect -f '{{.Config.Image}} {{.Image}}' $c)"; done
sec "3 backend mounts"; docker inspect -f '{{range .Mounts}}{{.Type}} {{.Source}} -> {{.Destination}} ({{if .RW}}rw{{else}}ro{{end}}){{println}}{{end}}' $BE
sec "4 compose configuration actually used"
for c in $BE $PG; do echo "-- $c"; docker inspect -f 'config_files={{index .Config.Labels "com.docker.compose.project.config_files"}}
working_dir={{index .Config.Labels "com.docker.compose.project.working_dir"}}
environment_file={{index .Config.Labels "com.docker.compose.project.environment_file"}}' $c; done
FILES=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.config_files"}}' $BE | tr ',' ' ')
echo "-- hashes and sizes of the compose files in use"; for f in $FILES; do ls -l "$f" 2>&1 | awk '{print $1,$3,$5,$6,$7,$8,$9}'; sha256sum "$f" 2>&1; done
echo "-- override files (secret-like lines withheld)"; ls -l /root/staging-hybrid-rag-e2acaaa/ 2>&1; for f in /root/staging-hybrid-rag-e2acaaa/*.yml /root/staging-hybrid-rag-e2acaaa/*.yaml; do [ -f "$f" ] && { echo "--- $f"; sha256sum "$f"; withhold < "$f"; }; done
echo "-- repo checkout"; git -C "$CHECKOUT" log -1 --format='HEAD=%H %s' 2>&1; git -C "$CHECKOUT" status --porcelain 2>&1 | wc -l | sed 's/^/uncommitted entries: /'; sha256sum "$CHECKOUT/infra/docker-compose.staging.yml" 2>&1
echo "-- images the checkout compose would use (images only, no environment printed)"; (cd "$CHECKOUT/infra" && docker compose -p verzchat-staging --env-file .env.staging -f docker-compose.staging.yml config --images 2>&1 | sort)
echo "-- services in the checkout compose"; (cd "$CHECKOUT/infra" && docker compose -p verzchat-staging --env-file .env.staging -f docker-compose.staging.yml config --services 2>&1 | sort | tr '\n' ' '); echo
sec "4b mechanisms that could recreate services"
echo "-- root crontab"; crontab -l 2>&1 | withhold; echo "-- /etc/cron.d + periodic dirs mentioning docker/compose/staging/verz"; grep -rIlE 'docker|compose|staging|verz|wa_' /etc/cron.d /etc/cron.hourly /etc/cron.daily /etc/cron.weekly 2>/dev/null; for f in $(grep -rIlE 'docker|compose|staging|verz|wa_' /etc/cron.d 2>/dev/null); do echo "--- $f"; withhold < "$f"; done
echo "-- systemd timers"; systemctl list-timers --all --no-pager 2>&1 | head -30; echo "-- units mentioning docker/compose/staging/verz"; systemctl list-unit-files --no-pager 2>/dev/null | grep -iE 'docker|compose|staging|verz|watchtower|autoheal'; ls /etc/systemd/system 2>/dev/null | grep -iE 'staging|verz|compose'
echo "-- auto-updaters / health restarters running as containers"; docker ps -a --format '{{.Names}} {{.Image}}' | grep -iE 'watchtower|autoheal|ouroboros|diun|cron' || echo none
echo "-- host scripts that start or recreate services (file names only)"; grep -rIlE --include='*.sh' --include='*.service' --include='*.timer' --include='*.yml' --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=staging-release-candidates --exclude-dir=staging-release-backups --exclude-dir=whatsapp-platform 'compose.* up|--force-recreate' /root /usr/local/bin /opt /etc/systemd/system 2>/dev/null | head -20
sec "5 environment variable NAMES of the backend (no values)"; docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' $BE | cut -d= -f1 | sort | tr '\n' ' '; echo
echo "-- non-secret flag values"; for n in NODE_ENV ENABLE_DEV_TOOLS RAG_HYBRID_ENABLED EMBEDDING_PROVIDER EMBEDDING_MODEL_DIR NODE_PATH AI_LEARNING_OPT_IN_OPEN AI_LEARNING_RETENTION_ENABLED AI_LEARNING_RETENTION_FREE_TEXT_DAYS AI_LEARNING_RETENTION_METRICS_MONTHS AI_LEARNING_WORKSPACE_MONTHLY_BUDGET_USD AI_LEARNING_GLOBAL_MONTHLY_BUDGET_USD AI_LEARNING_MAX_RESERVATION_USD; do printf '%s=%s\n' "$n" "$(docker exec $BE sh -c "printenv $n" 2>/dev/null || echo '<unset>')"; done
echo "-- presence only (set/empty)"; for n in DEEPSEEK_API_KEY INTERNAL_SECRET CREDENTIALS_ENCRYPTION_KEY WHATSAPP_APP_SECRET WHATSAPP_WEB_INTERNAL_API_KEY; do printf '%s: %s\n' "$n" "$(docker exec $BE sh -c "[ -n \"\$$n\" ] && echo set || echo EMPTY-or-unset")"; done
sec "6 model and runtime files"
sha256sum /opt/verz-models/all-MiniLM-L6-v2/tokenizer.json /opt/verz-models/all-MiniLM-L6-v2/onnx/model_quantized.onnx 2>&1; ls -l /opt/verz-models/all-MiniLM-L6-v2/ 2>&1 | head -12
echo "-- host onnxruntime-web"; sed -n 's/.*"version": *"\([^"]*\)".*/version \1/p' /opt/verz-ort/node_modules/onnxruntime-web/package.json 2>&1 | head -1
echo "-- inside the backend container"; docker exec $BE sh -c 'd="${EMBEDDING_MODEL_DIR:-/models/all-MiniLM-L6-v2}"; for f in "$d/tokenizer.json" "$d/onnx/model_quantized.onnx"; do (sha256sum "$f" 2>/dev/null || echo "cannot hash $f"); done; for p in /ort /opt/verz-ort; do [ -f "$p/node_modules/onnxruntime-web/package.json" ] && node -e "console.log(\"$p onnxruntime-web \"+JSON.parse(require(\"fs\").readFileSync(\"$p/node_modules/onnxruntime-web/package.json\",\"utf8\")).version)"; done'
sec "7 database and pgvector"
psqlq <<'SQL'
select 'server: ' || version();
select 'vector installed: ' || coalesce((select extversion from pg_extension where extname='vector'),'NOT INSTALLED');
select 'vector available: ' || coalesce((select default_version from pg_available_extensions where name='vector'),'NOT AVAILABLE');
select 'kb_vector_chunks rows: ' || count(*) from kb_vector_chunks;
select 'ANN indexes on kb_vector_chunks (must be 0): ' || count(*) from pg_indexes where tablename='kb_vector_chunks' and indexdef ~* 'hnsw|ivfflat';
select 'indexes on kb_vector_chunks: ' || string_agg(indexname, ', ') from pg_indexes where tablename='kb_vector_chunks';
select 'migrations finished: ' || count(*) || ' / rolled back: ' || count(*) filter (where rolled_back_at is not null) || ' / unfinished: ' || count(*) filter (where finished_at is null and rolled_back_at is null) from _prisma_migrations;
select 'newest migrations: ' || string_agg(migration_name, ', ' order by migration_name desc) from (select migration_name from _prisma_migrations where finished_at is not null order by migration_name desc limit 4) m;
select 'learning migrations applied (expect 0 before deploy): ' || count(*) from _prisma_migrations where migration_name in ('20261102120000_ai_learning_settings_and_usage','20261102130000_ai_interaction_log_conversation_fk','20261103120000_ai_learning_disclosure_acknowledgement');
select 'ai_learning_settings table exists: ' || (to_regclass('public.ai_learning_settings') is not null);
select 'database size: ' || pg_size_pretty(pg_database_size(current_database()));
SQL
sec "8 per-table counts (no content)"
psqlq <<'SQL'
select 'tenants: ' || count(*) from tenants;
select 'contacts: ' || count(*) from contacts;
select 'conversations: ' || count(*) from conversations;
select 'messages: ' || count(*) || ' (inbound ' || count(*) filter (where direction='INBOUND') || ')' from messages;
select 'inbound messages in the last 30 days: ' || count(*) from messages where direction='INBOUND' and created_at > now() - interval '30 days';
select 'most recent inbound message (date only): ' || coalesce(max(created_at)::date::text,'none') from messages where direction='INBOUND';
select 'most recent outbound message (date only): ' || coalesce(max(created_at)::date::text,'none') from messages where direction='OUTBOUND';
select 'ai_executions in the last 7 days: ' || count(*) from ai_executions where created_at > now() - interval '7 days';
select 'platform flags: ' || coalesce(string_agg(key || '=' || enabled::text, ', ' order by key),'none') from feature_flags where key in ('ai_learning_system','digital_self','verz_ai_v2');
SQL
sec "9 containment evidence (names and counts; no values)"
psqlq <<'SQL'
do $$ declare r record; n bigint; begin
  for r in select table_name, column_name from information_schema.columns
           where table_schema='public' and table_name in ('tenants','channels','whatsapp_numbers','tenant_settings')
             and (column_name ilike '%token%' or column_name ilike '%secret%' or column_name ilike '%credential%') loop
    execute format('select count(*) from %I where %I is not null and %I::text <> ''''', r.table_name, r.column_name, r.column_name) into n;
    raise notice 'credential-bearing column %.%: % rows hold a value', r.table_name, r.column_name, n;
  end loop; end $$;
select 'channels by type: ' || coalesce(string_agg(type::text || '=' || c, ', '),'none') from (select type, count(*)::text c from channels group by type) x;
select 'tenants whose name looks synthetic (stage|synthetic|test): ' || count(*) filter (where name ~* '(stage|staging|synthetic|test)') || ' of ' || count(*) from tenants;
SQL
echo "-- who can reach the WhatsApp webhook for staging (listening ports, no payloads)"; ss -ltnp 2>/dev/null | awk 'NR==1 || /:(80|443|8080|8443|3001)\b/' | head -8
echo "-- staging containment: secret-boundary check (names only; reads no production data)"
out=$(cd "$CHECKOUT" && INFRA_DIR="$CHECKOUT/infra" bash infra/scripts/staging-recreate.sh check 2>&1); rc=$?; printf '%s
' "$out" | withhold | tail -40; echo "exit status: $rc"
sec "10 AI preflight (read-only; MinIO round trip skipped; shared key allowed per the recorded owner decision)"
out=$(cd "$CHECKOUT" && bash infra/scripts/staging-ai-preflight.sh --no-minio-test --allow-shared-model-key 2>&1); rc=$?; printf '%s
' "$out" | withhold | tail -60; echo "exit status: $rc"
sec "11 backups (metadata only)"
df -hP "$BK" 2>&1 | tail -1; du -sh "$BK" 2>&1; ls -lat "$BK" 2>&1 | head -8
L=$(ls -1dt "$BK"/*/ 2>/dev/null | head -1); echo "latest backup dir: ${L:-none}"
if [ -n "$L" ]; then ls -l "$L"; for f in release-status.txt candidate rollback-image-tag staging.dump.sha256 allowed-extra-migrations.txt; do [ -f "$L$f" ] && { echo "--- $f"; withhold < "$L$f"; }; done
  [ -f "$L/staging.dump" ] && { stat -c 'dump: %s bytes, modified %y' "$L/staging.dump"; echo "dump archive entries: $(docker exec -i $PG pg_restore --list < "$L/staging.dump" 2>/dev/null | wc -l)"; (cd "$L" && sha256sum -c staging.dump.sha256 2>&1); }
  echo "rollback images present for tag: $(cat "$L/rollback-image-tag" 2>/dev/null)"; t=$(cat "$L/rollback-image-tag" 2>/dev/null); [ -n "$t" ] && docker image ls --format '{{.Repository}}:{{.Tag}} {{.ID}}' | grep -- "$t"; fi
echo "-- all backup directories (names and ages only)"; ls -1dt "$BK"/*/ 2>/dev/null | head -10
echo "-- the pgvector image the restore rehearsal needs must be present locally"; docker image ls --format '{{.Repository}}:{{.Tag}} {{.ID}} {{.Size}}' | grep -iE 'pgvector'
sec "end"; date -u +%FT%TZ
}
main </dev/null
