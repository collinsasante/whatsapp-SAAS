#!/usr/bin/env bash
# Restore an off-host backup set on a RECOVERY machine: download, verify, decrypt, optionally run the full restore test.
#   offhost-restore.sh --remote <rclone path> --identity <age secret key file> --out <dir> [--set <set name>] [--restore-test]
# The identity (age SECRET key) must exist only on the recovery workstation / in offline custody, NEVER on the production server. Every ciphertext is checked
# against the manifest's sha256 before decryption (age additionally authenticates every byte, so a flipped bit fails), and every decrypted file against the
# manifest's plaintext sha256. Output is names, sizes and PASS/FAIL only.
set -Eeuo pipefail
umask 077
REMOTE=; IDENT=; OUT=; SET=; RTEST=0
while [ $# -gt 0 ]; do
  case $1 in
    --remote) REMOTE=${2:?}; shift 2;; --identity) IDENT=${2:?}; shift 2;; --out) OUT=${2:?}; shift 2;; --set) SET=${2:?}; shift 2;; --restore-test) RTEST=1; shift;;
    -h|--help) sed -n '2,8p' "$0"; exit 0;; *) echo "unknown option: $1" >&2; exit 2;;
  esac
done
[ -n "$REMOTE" ] && [ -n "$IDENT" ] && [ -n "$OUT" ] || { echo "usage: offhost-restore.sh --remote R --identity FILE --out DIR [--set NAME] [--restore-test]" >&2; exit 2; }
[ -r "$IDENT" ] || { echo "identity file not readable" >&2; exit 2; }
command -v age >/dev/null && command -v rclone >/dev/null || { echo "age and rclone are required" >&2; exit 2; }
SELF=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PASS=0; FAILN=0; ok() { echo "PASS  $1"; PASS=$((PASS + 1)); }; bad() { echo "FAIL  $1"; FAILN=$((FAILN + 1)); }
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
[ -n "$SET" ] || SET=$(rclone lsf "${REMOTE%/}" --dirs-only --log-level ERROR | tr -d '/' | sort | tail -1)
[ -n "$SET" ] || { echo "FAIL  no backup set found at the destination"; exit 1; }
echo "set: $SET"
rclone copy "${REMOTE%/}/$SET" "$TMP" --log-level ERROR || { echo "FAIL  download failed"; exit 1; }
M=$TMP/manifest-$SET.json; [ -s "$M" ] || { echo "FAIL  manifest missing"; exit 1; }
mkdir -p "$OUT"; chmod 700 "$OUT"
names=$(sed -n 's/.*"name": "\([^"]*\)".*/\1/p' "$M")
[ -n "$names" ] || { echo "FAIL  manifest lists no files"; exit 1; }
for f in $names; do
  line=$(grep "\"name\": \"$f\"" "$M")
  csha=$(printf '%s' "$line" | sed -n 's/.*"ciphertext_sha256": "\([0-9a-f]*\)".*/\1/p'); psha=$(printf '%s' "$line" | sed -n 's/.*"plaintext_sha256": "\([0-9a-f]*\)".*/\1/p')
  [ "$(sha256sum "$TMP/$f.age" 2>/dev/null | cut -d' ' -f1)" = "$csha" ] && ok "$f: ciphertext matches the manifest" || { bad "$f: ciphertext does NOT match the manifest"; continue; }
  if age -d -i "$IDENT" -o "$OUT/$f" "$TMP/$f.age" 2>/dev/null; then ok "$f: decrypted"; else bad "$f: could not be decrypted with this identity (wrong key or damaged data)"; rm -f "$OUT/$f"; continue; fi
  [ "$(sha256sum "$OUT/$f" | cut -d' ' -f1)" = "$psha" ] && ok "$f: plaintext sha256 matches the manifest" || bad "$f: plaintext sha256 differs from the manifest"
done
if [ "$RTEST" = 1 ] && [ "$FAILN" = 0 ]; then
  d=$(ls "$OUT"/postgres_*.sql.gz | head -1)
  if "$SELF/backup-restore-test.sh" "$d" >"$TMP/restore.out" 2>&1; then ok "database restore test: $(grep -E 'RESTORE-TEST' "$TMP/restore.out" | tail -1)"; else bad "database restore test failed"; tail -5 "$TMP/restore.out"; fi
fi
echo "OFFHOST RESTORE: $PASS pass, $FAILN fail  (decrypted files are in $OUT; remove them when done)"
[ "$FAILN" = 0 ]
