#!/usr/bin/env bash
# Off-host backup: encrypt the newest VALIDATED local backup with age (PUBLIC keys only) and copy the ciphertext to an approved rclone destination.
#
#   offhost-backup.sh                       encrypt + upload the newest validated backup set
#   offhost-backup.sh --dry-run             do every check and the encryption into a temp dir, upload nothing
#   offhost-backup.sh --check-freshness H   exit 1 unless the last off-host upload succeeded within H hours (monitoring)
#
# NOTHING LEAVES THE HOST unless an operator-created approval file exists and matches (see APPROVAL below). The server holds only age PUBLIC keys: it can
# create backups but can never read them. Plaintext never leaves the host and is never written outside a 0700 temp dir that is removed on exit.
#
# APPROVAL  (default /etc/verz-offhost/approval.conf, mode 600, root-owned; created by a human after the destination, region, access model and key custody
# were approved; this script never creates it):
#     REMOTE=b2:verzchat-dr/prod            exact rclone destination; the script refuses any other value of OFFHOST_REMOTE
#     REGION=eu-central-003                 recorded, informational
#     APPROVED_BY=<name>  APPROVED_AT=<ISO date>
#     RECIPIENT_FPRS=<sha256 of the recipients file>    the exact recipient set that was approved
# Environment: OFFHOST_REMOTE (required), OFFHOST_RECIPIENTS (file of age public keys, default /etc/verz-offhost/recipients.txt), BACKUP_DIR
# (default /opt/backups/whatsapp-platform-v2), OFFHOST_STATE (default /var/lib/verz-offhost), OFFHOST_APPROVAL, OFFHOST_TEST_LOCAL=yes (tests only: allows
# a local directory as the remote).  Credentials for the remote live in rclone's own config (root-only), never in this script.
set -Eeuo pipefail
umask 077
IFS=$' \n\t'

BACKUP_DIR=${BACKUP_DIR:-/opt/backups/whatsapp-platform-v2}
STATE=${OFFHOST_STATE:-/var/lib/verz-offhost}
APPROVAL=${OFFHOST_APPROVAL:-/etc/verz-offhost/approval.conf}
RECIPIENTS=${OFFHOST_RECIPIENTS:-/etc/verz-offhost/recipients.txt}
REMOTE=${OFFHOST_REMOTE:-}
DRY=0; MODE=upload; FRESH_H=
while [ $# -gt 0 ]; do
  case $1 in
    --dry-run) DRY=1; shift;;
    --check-freshness) MODE=freshness; FRESH_H=${2:?hours}; shift 2;;
    -h|--help) sed -n '2,22p' "$0"; exit 0;;
    *) echo "unknown option: $1" >&2; exit 2;;
  esac
done
log() { printf '[%s] %s\n' "$(date '+%F %T')" "$*"; }
mkdir -p "$STATE"; chmod 700 "$STATE"; LAST=$STATE/last-offhost.json

if [ "$MODE" = freshness ]; then
  res=$(sed -n 's/.*"result": *"\([A-Z]*\)".*/\1/p' "$LAST" 2>/dev/null | head -1); fin=$(sed -n 's/.*"finished_epoch": *\([0-9]*\).*/\1/p' "$LAST" 2>/dev/null | head -1)
  [ "${res:-}" = OK ] || { log "last off-host run did not succeed (result=${res:-none})"; exit 1; }
  age=$(( $(date +%s) - ${fin:-0} )); [ "$age" -le $(( FRESH_H * 3600 )) ] || { log "last successful off-host upload is $((age / 3600)) h old (limit ${FRESH_H} h)"; exit 1; }
  log "OK: last off-host upload finished $((age / 60)) min ago"; exit 0
fi

RESULT=FAIL; MESSAGE="did not finish"; STARTED=$(date +%s); SET_NAME=; TMP=
write_status() {
  local t; t=$(mktemp "$STATE/.status.XXXXXX") || return 0
  printf '{\n  "result": "%s",\n  "message": "%s",\n  "dry_run": %s,\n  "started_epoch": %s,\n  "finished_epoch": %s,\n  "set": "%s"\n}\n' "$RESULT" "$(printf '%s' "$MESSAGE" | tr -d '\000-\037"\\' | cut -c1-300)" "$DRY" "$STARTED" "$(date +%s)" "$SET_NAME" > "$t" && chmod 600 "$t" && mv -f "$t" "$LAST" || rm -f "$t"
}
cleanup() { local rc=$?; [ -n "$TMP" ] && rm -rf -- "$TMP"; [ "$RESULT" = OK ] || { [ "$rc" -ne 0 ] || rc=1; log "FAILED: $MESSAGE"; }; [ "$DRY" = 1 ] && [ "$RESULT" = OK ] || write_status; exit "$rc"; }
trap cleanup EXIT
fail() { MESSAGE=$1; exit 1; }

# ---- gates (nothing below runs unless every one passes) ---------------------------------------------------------------------------------------------
[ -n "$REMOTE" ] || fail "OFFHOST_REMOTE is not set"
[ -r "$APPROVAL" ] || fail "no approval file at $APPROVAL: the destination, region, key custody and access model must be approved and recorded first"
[ "$(stat -c %a "$APPROVAL")" = 600 ] || fail "approval file must be mode 600"
ap() { sed -n "s/^$1=\(.*\)$/\1/p" "$APPROVAL" | head -1; }
for k in REMOTE REGION APPROVED_BY APPROVED_AT RECIPIENT_FPRS; do [ -n "$(ap $k)" ] || fail "approval file lacks $k"; done
[ "$(ap REMOTE)" = "$REMOTE" ] || fail "OFFHOST_REMOTE does not equal the approved destination"
case $REMOTE in /*|./*|../*) [ "${OFFHOST_TEST_LOCAL:-}" = yes ] || fail "a local path is not an approved off-host destination";; esac
command -v age >/dev/null || fail "age is not installed"; command -v rclone >/dev/null || fail "rclone is not installed"
[ -r "$RECIPIENTS" ] || fail "recipients file $RECIPIENTS not readable"
grep -q 'AGE-SECRET-KEY' "$RECIPIENTS" && fail "the recipients file contains a SECRET key; it must hold public keys only"
grep -vE '^\s*(#|$)' "$RECIPIENTS" | grep -vq '^age1[a-z0-9]\{50,\}$' && fail "the recipients file may contain only age public keys (age1…) and comments"
[ "$(grep -cE '^age1' "$RECIPIENTS")" -ge 2 ] || fail "at least two recipients are required (primary and escrow key holders)"
[ "$(sha256sum "$RECIPIENTS" | cut -d' ' -f1)" = "$(ap RECIPIENT_FPRS)" ] || fail "the recipients file differs from the approved set"

# ---- choose the backup set: only what the backup job itself marked OK and whose checksums still match -----------------------------------------------
S=$BACKUP_DIR/.last-status.json
[ "$(sed -n 's/.*"result": *"\([A-Z]*\)".*/\1/p' "$S" 2>/dev/null | head -1)" = OK ] || fail "the last local backup did not succeed; nothing to upload"
pg=$(sed -n 's/.*"postgres_file": *"\([^"]*\)".*/\1/p' "$S" | head -1); rd=$(sed -n 's/.*"redis_file": *"\([^"]*\)".*/\1/p' "$S" | head -1)
[[ $pg =~ ^postgres_[0-9_]+\.sql\.gz$ ]] || fail "unexpected PostgreSQL backup name"
FILES=("$pg"); if [ -n "$rd" ]; then [[ $rd =~ ^redis_[0-9_]+\.rdb$ ]] || fail "unexpected Redis backup name"; FILES+=("$rd"); fi
for f in "${FILES[@]}"; do [ -s "$BACKUP_DIR/$f" ] || fail "$f is missing"; (cd "$BACKUP_DIR" && sha256sum -c --quiet "$f.sha256") || fail "$f no longer matches its checksum"; done
gzip -t -- "$BACKUP_DIR/$pg" || fail "$pg is not a valid gzip"
SET_NAME=${pg#postgres_}; SET_NAME=${SET_NAME%.sql.gz}

# ---- idempotent: a set that is already at the destination is never uploaded again (age output differs on every run, and --immutable would refuse it)
if [ "$DRY" != 1 ] && [ -n "$(rclone lsf "${REMOTE%/}/$SET_NAME" --include "manifest-$SET_NAME.json" --log-level ERROR 2>/dev/null)" ]; then
  RESULT=OK; MESSAGE="set $SET_NAME is already at the destination; nothing to upload"; log "$MESSAGE"; exit 0
fi

# ---- encrypt into a private temp dir -------------------------------------------------------------------------------------------------------------------
TMP=$(mktemp -d "${TMPDIR:-/var/tmp}/offhost.XXXXXX"); chmod 700 "$TMP"
{
  printf '{\n  "set": "%s",\n  "created": "%s",\n  "host": "%s",\n  "recipients_sha256": "%s",\n  "files": [\n' "$SET_NAME" "$(date -u +%FT%TZ)" "$(hostname -s)" "$(sha256sum "$RECIPIENTS" | cut -d' ' -f1)"
  first=1
  for f in "${FILES[@]}"; do
    age -R "$RECIPIENTS" -o "$TMP/$f.age" "$BACKUP_DIR/$f"
    [ -s "$TMP/$f.age" ] || fail "encryption of $f produced no output"
    [ $first = 1 ] || printf ',\n'; first=0
    printf '    {"name": "%s", "plaintext_bytes": %s, "plaintext_sha256": "%s", "ciphertext_bytes": %s, "ciphertext_sha256": "%s"}' "$f" "$(stat -c %s "$BACKUP_DIR/$f")" "$(sha256sum "$BACKUP_DIR/$f" | cut -d' ' -f1)" "$(stat -c %s "$TMP/$f.age")" "$(sha256sum "$TMP/$f.age" | cut -d' ' -f1)"
  done
  printf '\n  ]\n}\n'
} > "$TMP/manifest-$SET_NAME.json"
log "encrypted ${#FILES[@]} file(s) for set $SET_NAME to $(grep -cE '^age1' "$RECIPIENTS") recipients"

if [ "$DRY" = 1 ]; then RESULT=OK; MESSAGE="dry run: checks and encryption passed, nothing uploaded"; log "$MESSAGE"; exit 0; fi

# ---- upload (never overwrite: --immutable), then verify by downloading and comparing -----------------------------------------------------------------
DEST=${REMOTE%/}/$SET_NAME
rclone copy "$TMP" "$DEST" --immutable --retries 3 --low-level-retries 5 --log-level ERROR || fail "upload failed"
rclone check "$TMP" "$DEST" --download --one-way --log-level ERROR || fail "the uploaded copy does not match what was encrypted"
RESULT=OK; MESSAGE="uploaded and verified set $SET_NAME"; log "$MESSAGE ($(du -ch "$TMP"/*.age | tail -1 | cut -f1) of ciphertext)"
