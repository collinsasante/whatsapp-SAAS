#!/usr/bin/env bash
# End-to-end test of offhost-backup.sh / offhost-restore.sh with REAL age, rclone, a real pg_dump and a throwaway postgres. A local directory plays the
# remote, so nothing is transmitted anywhere. Needs: age, rclone, docker (postgres:16-alpine), GNU coreutils; run on Linux.
#   usage: bash infra/scripts/tests/offhost-backup.test.sh <real pg_dump .sql.gz file>
set -uo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd); S=$HERE/..; DUMP=${1:?path to a real postgres_*.sql.gz produced by pg_dump}
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT; PASS=0; FAIL=0
ok() { echo "PASS  $1"; PASS=$((PASS + 1)); }; bad() { echo "FAIL  $1"; FAIL=$((FAIL + 1)); }; check() { local l=$1; shift; if "$@" >/dev/null 2>&1; then ok "$l"; else bad "$l"; fi; }
export TMPDIR=$T RESTORE_IMAGE=${RESTORE_IMAGE:-postgres:16-alpine}
mkdir -p "$T/keys" "$T/backups" "$T/state" "$T/etc" "$T/remote"; chmod 700 "$T/etc"
# two recipients (primary + escrow) and one stranger; secret keys stay in $T/keys ("the recovery workstation"), only public keys go to the "server"
for k in primary escrow stranger; do age-keygen -o "$T/keys/$k.txt" 2>/dev/null; age-keygen -y "$T/keys/$k.txt" > "$T/keys/$k.pub"; done
cat "$T/keys/primary.pub" "$T/keys/escrow.pub" > "$T/etc/recipients.txt"
# a validated local backup set, exactly the shape backup.sh produces
STAMP=20261104_120000; cp "$DUMP" "$T/backups/postgres_$STAMP.sql.gz"; head -c 200000 /dev/urandom > "$T/backups/redis_$STAMP.rdb"
(cd "$T/backups" && for f in postgres_$STAMP.sql.gz redis_$STAMP.rdb; do sha256sum "$f" > "$f.sha256"; done)
printf '{\n  "result": "OK",\n  "postgres_file": "postgres_%s.sql.gz",\n  "redis_file": "redis_%s.rdb"\n}\n' $STAMP $STAMP > "$T/backups/.last-status.json"
approve() { printf 'REMOTE=%s\nREGION=test-region\nAPPROVED_BY=test\nAPPROVED_AT=2026-11-04\nRECIPIENT_FPRS=%s\n' "$1" "$(sha256sum "$T/etc/recipients.txt" | cut -d' ' -f1)" > "$T/etc/approval.conf"; chmod 600 "$T/etc/approval.conf"; }
run() { env BACKUP_DIR="$T/backups" OFFHOST_STATE="$T/state" OFFHOST_APPROVAL="$T/etc/approval.conf" OFFHOST_RECIPIENTS="$T/etc/recipients.txt" OFFHOST_REMOTE="${REMOTE_ARG:-$T/remote}" OFFHOST_TEST_LOCAL=yes "$@" bash "$S/offhost-backup.sh" $ARGS > "$T/out.txt" 2>&1; }
runq() { REMOTE_ARG=${REMOTE_ARG:-}; ARGS=${ARGS:-}; run; }
count_remote() { find "$T/remote" -type f | wc -l; }

echo "== gates: nothing is uploaded unless every one passes"
rm -f "$T/etc/approval.conf"; runq; rc=$?; check "no approval file: refused, nothing uploaded" bash -c "[ $rc != 0 ] && grep -q 'no approval file' $T/out.txt && [ \$(find $T/remote -type f | wc -l) = 0 ]"
approve "$T/remote"; chmod 644 "$T/etc/approval.conf"; runq; rc=$?; check "approval file with loose permissions: refused" bash -c "[ $rc != 0 ] && grep -q 'mode 600' $T/out.txt"; chmod 600 "$T/etc/approval.conf"
approve "$T/other-place"; runq; rc=$?; check "destination different from the approved one: refused" bash -c "[ $rc != 0 ] && grep -q 'approved destination' $T/out.txt && [ \$(find $T/remote -type f | wc -l) = 0 ]"
approve "$T/remote"; cp "$T/etc/recipients.txt" "$T/etc/recipients.bak"; cat "$T/keys/stranger.pub" >> "$T/etc/recipients.txt"; runq; rc=$?; check "recipient set changed after approval: refused" bash -c "[ $rc != 0 ] && grep -q 'differs from the approved set' $T/out.txt"; cp "$T/etc/recipients.bak" "$T/etc/recipients.txt"
cp "$T/etc/recipients.txt" "$T/etc/recipients.bak"; cat "$T/keys/primary.txt" >> "$T/etc/recipients.txt"; approve "$T/remote"; runq; rc=$?; check "a SECRET key in the recipients file: refused" bash -c "[ $rc != 0 ] && grep -q 'SECRET key' $T/out.txt"; cp "$T/etc/recipients.bak" "$T/etc/recipients.txt"
head -1 "$T/etc/recipients.txt" > "$T/etc/recipients.one"; cp "$T/etc/recipients.txt" "$T/etc/recipients.bak"; cp "$T/etc/recipients.one" "$T/etc/recipients.txt"; approve "$T/remote"; runq; rc=$?; check "a single recipient (no escrow holder): refused" bash -c "[ $rc != 0 ] && grep -q 'at least two' $T/out.txt"; cp "$T/etc/recipients.bak" "$T/etc/recipients.txt"; approve "$T/remote"
REMOTE_ARG="$T/remote" ; env BACKUP_DIR="$T/backups" OFFHOST_STATE="$T/state" OFFHOST_APPROVAL="$T/etc/approval.conf" OFFHOST_RECIPIENTS="$T/etc/recipients.txt" OFFHOST_REMOTE="$T/remote" bash "$S/offhost-backup.sh" > "$T/out.txt" 2>&1; rc=$?
check "a local path is not an approved destination outside tests: refused" bash -c "[ $rc != 0 ] && grep -q 'not an approved off-host destination' $T/out.txt"
echo '{"result": "FAIL"}' > "$T/backups/.last-status.json.bad"; mv "$T/backups/.last-status.json" "$T/backups/.last-status.json.good"; mv "$T/backups/.last-status.json.bad" "$T/backups/.last-status.json"; runq; rc=$?; check "last local backup not OK: nothing to upload" bash -c "[ $rc != 0 ] && grep -q 'did not succeed' $T/out.txt"; mv "$T/backups/.last-status.json.good" "$T/backups/.last-status.json"
echo corrupt >> "$T/backups/redis_$STAMP.rdb"; runq; rc=$?; check "a local file that no longer matches its checksum: refused" bash -c "[ $rc != 0 ] && grep -q 'no longer matches' $T/out.txt"; head -c 200000 /dev/urandom > "$T/backups/redis_$STAMP.rdb"; (cd "$T/backups" && sha256sum redis_$STAMP.rdb > redis_$STAMP.rdb.sha256)

echo "== dry run"
ARGS=--dry-run runq; rc=$?; check "dry run passes every check and encrypts, but uploads nothing and records no success" bash -c "[ $rc = 0 ] && grep -q 'nothing uploaded' $T/out.txt && [ \$(find $T/remote -type f | wc -l) = 0 ] && ! grep -q '\"result\": \"OK\"' $T/state/last-offhost.json"; ARGS=

echo "== upload"
runq; rc=$?; check "upload succeeds and is verified by downloading it back" bash -c "[ $rc = 0 ] && grep -q 'uploaded and verified' $T/out.txt"
check "remote holds exactly: two ciphertexts + one manifest, nothing else" bash -c "[ \$(find $T/remote -type f | wc -l) = 3 ] && ls $T/remote/$STAMP | sort | tr '\n' ' ' | grep -q 'manifest-$STAMP.json postgres_$STAMP.sql.gz.age redis_$STAMP.rdb.age'"
check "no plaintext leaves the host: the ciphertext shares no readable SQL and is not gzip" bash -c "! zcat $T/remote/$STAMP/postgres_$STAMP.sql.gz.age 2>/dev/null | head -c 100 | grep -q 'PostgreSQL' && ! grep -qa 'CREATE TABLE' $T/remote/$STAMP/postgres_$STAMP.sql.gz.age && head -c 22 $T/remote/$STAMP/postgres_$STAMP.sql.gz.age | grep -q 'age-encryption.org'"
check "the manifest contains hashes and sizes only (no secret material)" bash -c "! grep -q 'AGE-SECRET-KEY' $T/remote/$STAMP/manifest-$STAMP.json && grep -q plaintext_sha256 $T/remote/$STAMP/manifest-$STAMP.json"
check "the server side holds no decryption key" bash -c "! grep -rl 'AGE-SECRET-KEY' $T/etc $T/state $T/backups"
check "temp files are gone" bash -c "[ -z \"\$(ls -d $T/offhost.* 2>/dev/null)\" ]"
check "status recorded OK and freshness check passes" bash -c "grep -q '\"result\": \"OK\"' $T/state/last-offhost.json && env OFFHOST_STATE=$T/state bash $S/offhost-backup.sh --check-freshness 1"
before=$(find "$T/remote" -type f -exec sha256sum {} + | sort | sha256sum); runq; rc=$?; after=$(find "$T/remote" -type f -exec sha256sum {} + | sort | sha256sum)
check "re-running for the same set is a no-op success (nothing re-uploaded, remote byte-identical)" bash -c "[ $rc = 0 ] && grep -q 'already at the destination' $T/out.txt && [ '$before' = '$after' ]"

echo "== restore on the recovery workstation"
bash "$S/offhost-restore.sh" --remote "$T/remote" --identity "$T/keys/primary.txt" --out "$T/restored-primary" > "$T/r1.txt" 2>&1; rc=$?
check "primary key holder restores: ciphertext hash, decryption and plaintext hash all pass" bash -c "[ $rc = 0 ] && grep -c '^PASS' $T/r1.txt | grep -q '^6\$'"
check "restored files are byte-identical to the originals" bash -c "cmp $T/restored-primary/postgres_$STAMP.sql.gz $DUMP && cmp $T/restored-primary/redis_$STAMP.rdb $T/backups/redis_$STAMP.rdb"
bash "$S/offhost-restore.sh" --remote "$T/remote" --identity "$T/keys/escrow.txt" --out "$T/restored-escrow" > "$T/r2.txt" 2>&1; check "the escrow key holder can restore independently" bash -c "[ $? = 0 ]"
bash "$S/offhost-restore.sh" --remote "$T/remote" --identity "$T/keys/stranger.txt" --out "$T/restored-stranger" > "$T/r3.txt" 2>&1; rc=$?
check "a key that was not a recipient cannot decrypt anything" bash -c "[ $rc != 0 ] && grep -q 'wrong key' $T/r3.txt && [ -z \"\$(ls -A $T/restored-stranger)\" ]"
echo "== tampering and damage are detected"
cp -r "$T/remote" "$T/remote.bak"; python3 - "$T/remote/$STAMP/postgres_$STAMP.sql.gz.age" <<'PY'
import sys
p=sys.argv[1]; b=bytearray(open(p,'rb').read()); b[len(b)//2]^=0xFF; open(p,'wb').write(b)
PY
bash "$S/offhost-restore.sh" --remote "$T/remote" --identity "$T/keys/primary.txt" --out "$T/restored-tamper" > "$T/r4.txt" 2>&1; rc=$?
check "one flipped byte in the remote ciphertext is detected before decryption" bash -c "[ $rc != 0 ] && grep -q 'does NOT match the manifest' $T/r4.txt && [ ! -e $T/restored-tamper/postgres_$STAMP.sql.gz ]"
rm -rf "$T/remote"; cp -r "$T/remote.bak" "$T/remote"; head -c 1000 "$T/remote/$STAMP/redis_$STAMP.rdb.age" > "$T/trunc"; cp "$T/trunc" "$T/remote/$STAMP/redis_$STAMP.rdb.age"
bash "$S/offhost-restore.sh" --remote "$T/remote" --identity "$T/keys/primary.txt" --out "$T/restored-trunc" > "$T/r5.txt" 2>&1; check "a truncated ciphertext is detected" bash -c "[ $? != 0 ]"
rm -rf "$T/remote"; cp -r "$T/remote.bak" "$T/remote"
echo "== full restore test of the recovered database in a throwaway postgres"
bash "$S/offhost-restore.sh" --remote "$T/remote" --identity "$T/keys/primary.txt" --out "$T/restored-full" --restore-test > "$T/r6.txt" 2>&1; rc=$?
check "the recovered dump passes the full restore test (exact row counts, migrations, indexes)" bash -c "[ $rc = 0 ] && grep -q 'database restore test' $T/r6.txt"
echo "OFFHOST TESTS: $PASS pass, $FAIL fail"; [ $FAIL = 0 ]
