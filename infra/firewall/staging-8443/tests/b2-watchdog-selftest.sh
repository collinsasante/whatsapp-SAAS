#!/bin/bash
# Local, stub-based test of the B2 watchdog logic (no Docker, no firewall). usage: ap2-b2-watchdog-selftest.sh <dir-of-scripts>
S=$1; T=$(mktemp -d); PASS=0; FAIL=0; ok() { if "$@" >/dev/null 2>&1; then echo "PASS  $L"; PASS=$((PASS+1)); else echo "FAIL  $L"; FAIL=$((FAIL+1)); fi; }
cat > $T/docker <<'STUB'
#!/bin/bash
ST=${STUB_STATE:?}; [ "$1" = info ] && { [ -e $ST/docker_down ] && exit 1 || exit 0; }; [ "$1 $2" = "network inspect" ] || [ "$1 $2" = "network rm" ] || exit 9
if [ "$2" = rm ]; then [ -e $ST/net ] && { rm -f $ST/net; echo removed >> $ST/calls; exit 0; } || exit 1; fi
[ -e $ST/net ] || exit 1; if [ "$3" = "--format" ]; then cat $ST/net; fi; exit 0
STUB
cat > $T/oldfw <<'STUB'
#!/bin/bash
echo "$1" >> ${STUB_STATE}/oldfw_calls; [ "$1" = apply ] && : > ${STUB_STATE}/old_ok; exit 0
STUB
cat > $T/oldchk <<'STUB'
#!/bin/bash
[ -e ${STUB_STATE}/old_ok ]
STUB
chmod +x $T/docker $T/oldfw $T/oldchk
run() { n=$1; dl=$2; shift 2; ST=$T/$n; mkdir -p $ST/d; export STUB_STATE=$ST; for f in "$@"; do touch $ST/d/$f; done; WD_DOCKER=$T/docker WD_OLD_FW=$T/oldfw WD_OLD_CHECK=$T/oldchk bash $S/ap2-b2-watchdog.sh $ST/d $dl; }
mk() { mkdir -p $T/$1; echo -n "$2" > $T/$1/net; [ "$3" = ok ] && : > $T/$1/old_ok; true; }
mk c1 b2 ok; L="deadline: our labelled network is removed"; run c1 2; ok bash -c "[ ! -e $T/c1/net ] && [ \"\$(cat $T/c1/d/result)\" = CLEAN ]"
mk c2 b2 ok; L="fail signal: removed immediately"; ( time run c2 300 fail ) 2>$T/c2.time; ok bash -c "[ ! -e $T/c2/net ] && [ \"\$(cat $T/c2/d/result)\" = CLEAN ] && grep -q 'real.*0m[0-2]' $T/c2.time"
mk c3 "" ok; L="FOREIGN network of the same name (no label) is NOT removed"; run c3 300 fail; ok bash -c "[ -e $T/c3/net ] && grep -q REFUSING $T/c3/d/watchdog.log"
mk c4 other ok; L="network with a DIFFERENT label is NOT removed"; run c4 300 fail; ok bash -c "[ -e $T/c4/net ] && grep -q REFUSING $T/c4/d/watchdog.log"
mk c5 b2 ok; L="confirm cancels without touching anything"; run c5 300 confirm; ok bash -c "[ -e $T/c5/net ] && [ \"\$(cat $T/c5/d/result)\" = CANCELLED ] && [ ! -e $T/c5/calls ]"
mk c6 b2 no; L="old layer damaged: re-applied and verified"; run c6 300 fail; ok bash -c "[ ! -e $T/c6/net ] && [ \"\$(cat $T/c6/oldfw_calls)\" = apply ] && [ \"\$(cat $T/c6/d/result)\" = CLEAN ]"
mk c7 b2 ok; L="network already absent and old layer fine: CLEAN, nothing invoked"; rm -f $T/c7/net; run c7 300 fail; ok bash -c "[ \"\$(cat $T/c7/d/result)\" = CLEAN ] && [ ! -e $T/c7/oldfw_calls ]"
mk c8 b2 ok; L="idempotent: second run after cleanup is still CLEAN"; run c8 300 fail; rm -f $T/c8/d/fail; mv $T/c8/d/result $T/c8/d/result.1; touch $T/c8/d/fail; WD_DOCKER=$T/docker WD_OLD_FW=$T/oldfw WD_OLD_CHECK=$T/oldchk bash $S/ap2-b2-watchdog.sh $T/c8/d 300; ok bash -c "[ \"\$(cat $T/c8/d/result)\" = CLEAN ]"
mk c9 b2 ok; : > $T/c9/docker_down; L="Docker unreachable: reported NOT_CLEAN, network not assumed absent"; run c9 300 fail; ok bash -c "[ \"\$(cat $T/c9/d/result)\" = NOT_CLEAN ] && grep -q 'NOT reachable' $T/c9/d/watchdog.log"
L="script has no ssh/curl/wget/ufw/nft calls (docker, iptables and the old-layer apply only)"; ok bash -c "! grep -v '^#' $S/ap2-b2-watchdog.sh | grep -qE '\b(ssh|scp|curl|wget|ufw|nft)\b'"
echo "B2 watchdog selftest: $PASS pass, $FAIL fail"; rm -rf $T; [ $FAIL = 0 ]
