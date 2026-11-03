#!/bin/bash
# AP-2 POST-CHECK and evidence sealing. Read-only except chmod/hashing of the evidence directory.
export EV=$1; . $EV/lib.sh; . $EV/ap2-lib.sh; PASS=0; FAIL=0
snap AP2-final 2>/dev/null
echo "== final vs baseline"; cmpsnap AP2-baseline AP2-final
chk "no leftover namespaces/veth/routes/processes" no_scaffolding
chk "no stray test processes" bash -c '[ "$(ps -eo args | grep -E "http\.server|prober_|ap2-b" | grep -v -E "grep|ap2-99" | wc -l)" = 0 ]'
chk "admin file byte-identical to the pre-AP-2 copy" admin_file_identical
chk "no Docker test network left" bash -c '! docker network ls --format "{{.Name}}" | grep -qx stg-acc-probe'
chk "no test units left" bash -c '[ "$(systemctl list-units --no-legend "stg-ap2-*" "stg-acc-*" | grep -v stg-ap2-post | wc -l)" = 0 ]'
chk "evidence contains no copy of the real admin address" bash -c 'REAL=$(awk "{print \$1}" '$ADMIN_BK'/real.line); ! grep -rlF -- "$REAL" '$EV' >/dev/null 2>&1'
chmod -R go-rwx $EV; (cd $EV && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS); echo "files hashed: $(wc -l < $EV/SHA256SUMS)"
P2P=$PASS; P2F=$FAIL; invariants; echo "POST: $P2P pass, $P2F fail; scratch dirs kept: $(ls -d /root/stg-iso-* 2>/dev/null | tr '\n' ' ')"; [ $P2F = 0 ]
