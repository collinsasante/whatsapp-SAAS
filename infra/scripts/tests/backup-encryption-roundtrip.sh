#!/usr/bin/env bash
# LOCAL proof that a backup can be encrypted with a PUBLIC key only, that the machine doing the encryption cannot decrypt, that tampering and truncation are detected,
# and that the decrypted file still passes the full restore test. Nothing is transmitted anywhere. Uses a THROWAWAY test key (not a custody-grade key).
#   usage: backup-encryption-roundtrip.sh <postgres_*.sql.gz> [workdir]
# Everything created here (keys, ciphertext, decrypted plaintext) is removed on exit; only the PASS/FAIL report remains.
set -Eeuo pipefail
umask 077
DUMP=${1:?usage: backup-encryption-roundtrip.sh <dump.sql.gz> [workdir]}; BASE=${2:-/root}
SELF_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
W=$(mktemp -d "$BASE/dr-encryption-test.XXXXXX"); trap 'rm -rf "$W"' EXIT
PASS=0; FAILN=0; ok() { echo "PASS  $1"; PASS=$((PASS + 1)); }; bad() { echo "FAIL  $1"; FAILN=$((FAILN + 1)); }
command -v gpg >/dev/null || { echo "gpg is required"; exit 2; }
G_FULL=$W/gpg-recovery-workstation; G_SERVER=$W/gpg-server; mkdir -m 700 "$G_FULL" "$G_SERVER"
gpgf() { gpg --homedir "$G_FULL" --batch --no-tty --quiet "$@"; }; gpgs() { gpg --homedir "$G_SERVER" --batch --no-tty --quiet "$@"; }

# 1. a throwaway key pair on the "recovery workstation"; only its PUBLIC half is given to the "server"
gpgf --passphrase '' --pinentry-mode loopback --quick-generate-key "dr-test-key" ed25519 cert never 2>/dev/null
FPR=$(gpgf --list-keys --with-colons | awk -F: '/^fpr/{print $10; exit}')
gpgf --passphrase '' --pinentry-mode loopback --quick-add-key "$FPR" cv25519 encr never 2>/dev/null
gpgf --export "$FPR" > "$W/public.key"; gpgs --import "$W/public.key" 2>/dev/null
[ -z "$(gpgs --list-secret-keys --with-colons 2>/dev/null)" ] && ok "the server-side keyring holds a public key and NO secret key" || bad "server-side keyring unexpectedly has a secret key"

# 2. encrypt on the "server" with the public key only (the dump is already gzip: no second compression)
ORIG_SHA=$(sha256sum -- "$DUMP" | cut -d' ' -f1); ORIG_BYTES=$(stat -c %s -- "$DUMP")
t0=$(date +%s.%N); gpgs --trust-model always --cipher-algo AES256 --compress-algo none --recipient "$FPR" --output "$W/backup.enc" --encrypt "$DUMP"; t1=$(date +%s.%N)
ENC_BYTES=$(stat -c %s "$W/backup.enc")
[ -s "$W/backup.enc" ] && ok "encrypted $ORIG_BYTES bytes -> $ENC_BYTES bytes (+$(( (ENC_BYTES - ORIG_BYTES) * 100 / ORIG_BYTES ))% overhead) in $(python3 -c "print(round($t1-$t0,1))") s"
! head -c 2000 "$W/backup.enc" | grep -aq 'PostgreSQL database dump' && ! head -c 2000 "$W/backup.enc" | grep -aq 'CREATE TABLE' && ok "ciphertext contains no readable SQL" || bad "ciphertext contains readable SQL"

# 3. the server cannot decrypt
if gpgs --output "$W/should-not-exist" --decrypt "$W/backup.enc" 2>/dev/null; then bad "the server-side keyring was able to decrypt"; else ok "the server-side keyring cannot decrypt (no secret key)"; fi
[ ! -s "$W/should-not-exist" ] || bad "plaintext was produced by the server keyring"

# 4. the recovery workstation can, and the result is byte-identical
gpgf --passphrase '' --pinentry-mode loopback --output "$W/restored.sql.gz" --decrypt "$W/backup.enc" 2>/dev/null
[ "$(sha256sum "$W/restored.sql.gz" | cut -d' ' -f1)" = "$ORIG_SHA" ] && ok "decrypted file is byte-identical to the original (sha256 ${ORIG_SHA:0:16})" || bad "decrypted file differs from the original"

# 5. tamper and truncation must be detected, and must not yield usable plaintext
cp "$W/backup.enc" "$W/tampered.enc"; python3 - "$W/tampered.enc" <<'PY'
import sys
p=sys.argv[1]; b=bytearray(open(p,'rb').read()); i=len(b)//2; b[i]^=0xFF; open(p,'wb').write(b)
PY
if gpgf --passphrase '' --pinentry-mode loopback --output "$W/tampered.out" --decrypt "$W/tampered.enc" >/dev/null 2>&1; then bad "a ciphertext with one flipped byte was accepted"; else ok "a ciphertext with one flipped byte is rejected"; fi
head -c $(( ENC_BYTES - 5000 )) "$W/backup.enc" > "$W/truncated.enc"
if gpgf --passphrase '' --pinentry-mode loopback --output "$W/truncated.out" --decrypt "$W/truncated.enc" >/dev/null 2>&1; then bad "a truncated ciphertext was accepted"; else ok "a truncated ciphertext is rejected"; fi
rm -f "$W/tampered.out" "$W/truncated.out"

# 6. the decrypted copy passes the FULL restore test (throwaway database, exact row counts)
cp "$W/restored.sql.gz" "$W/postgres_decrypted.sql.gz"
if "$SELF_DIR/backup-restore-test.sh" "$W/postgres_decrypted.sql.gz" > "$W/restore.out" 2>&1; then ok "decrypted copy restores: $(grep -E 'exact row counts' "$W/restore.out" | sed 's/^PASS  //')"; else bad "decrypted copy failed the restore test"; sed -n '1,12p' "$W/restore.out"; fi
echo "ENCRYPTION ROUND TRIP: $PASS pass, $FAILN fail  (all keys, ciphertext and plaintext copies are removed on exit)"; [ "$FAILN" = 0 ]
