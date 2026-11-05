#!/usr/bin/env python3
"""Read-only server-side soak monitor for the staging 8443 firewall. Runs as a transient systemd service on the VPS.
It never changes firewall, unit, container or application state: every command below only reads. It never records the admin address."""
import datetime as dt, hashlib, json, os, re, signal, subprocess, sys, time

EVID = sys.argv[1]
DURATION = int(sys.argv[2]) if len(sys.argv) > 2 else 1500
INTERVAL = 30
EXPECTED_SIG = os.environ.get('EXPECT_SIG', '471c8a8d90ccad70')
EXPECTED_SNAPSHOT = os.environ.get('EXPECT_SNAP', '20261103T191201Z-b42a')
FW = '/usr/local/sbin/staging-8443-fw'
NOW = lambda: dt.datetime.now(dt.timezone.utc)
ISO = lambda t: t.strftime('%Y-%m-%dT%H:%M:%SZ')
errors = []
state = {'status': 'RUNNING', 'started': None, 'ended': None, 'samples': 0, 'exit_reason': None}


def write_json(name, obj):
    tmp = os.path.join(EVID, name + '.tmp')
    with open(tmp, 'w') as f:
        json.dump(obj, f, indent=2, sort_keys=True)
    os.replace(tmp, os.path.join(EVID, name))


def sh(cmd, timeout=25, merge_err=False):
    try:
        p = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
        out = p.stdout + (p.stderr if merge_err else '')
        if p.returncode != 0 and not merge_err:
            errors.append({'t': ISO(NOW()), 'cmd': cmd[:90], 'rc': p.returncode, 'err': p.stderr.strip()[:160]})
        return out
    except Exception as e:  # a failing read must be recorded, never stop the monitor
        errors.append({'t': ISO(NOW()), 'cmd': cmd[:90], 'exc': str(e)[:160]})
        return ''


JC = lambda iso: iso.replace('T', ' ').replace('Z', ' UTC')
h = lambda s: hashlib.sha256(s.encode()).hexdigest()[:16]


def nft_counters():
    out = sh('nft list table inet staging8443')
    c = {'gate_drop': None, 'fwd_drop': None, 'input_drop': None}
    for line in out.splitlines():
        m = re.search(r'counter packets (\d+) bytes (\d+) drop', line)
        if not m:
            continue
        pk = int(m.group(1))
        if 'proto-dst 8443' in line:
            c['fwd_drop'] = pk
        elif 'tcp dport 8443' in line:
            c['input_drop'] = pk
        else:
            c['gate_drop'] = pk
    return c


def others_hash():
    out = sh('nft list ruleset')
    keep, skip = [], False
    for line in out.splitlines():
        if line.startswith('table '):
            skip = line.split()[2] == 'staging8443'
        if not skip:
            keep.append(re.sub(r'packets \d+ bytes \d+', '', line))
    return h('\n'.join(keep))


def ipt(tool, chain):
    rules = len(sh(f'{tool} -S {chain}').splitlines())
    pk = []
    for line in sh(f'{tool} -vnxL {chain}').splitlines()[2:]:
        f = line.split()
        if len(f) >= 3 and f[0].isdigit():
            pk.append([int(f[0]), f[2]])  # packets and target only; source addresses are never kept
    save = '\n'.join(l for l in sh(f'{tool}-save').splitlines() if not l.startswith(('#', ':')))
    return {'rules': rules, 'counters': pk, 'save_hash': h(save)}


def sample(prev_ts):
    s = {'t': ISO(NOW()), 'mono': round(time.monotonic(), 1)}
    try:
        st = json.loads(sh(f'timeout 20 {FW} status') or '{}')
    except Exception:
        st = {}
    s['fw'] = {k: st.get(k) for k in ('table_present', 'disabled', 'live_signature', 'expected_signature', 'last_good', 'applied', 'mode', 'last_refresh_result')}
    s['fw']['admin_entries'] = len(st.get('admin_exceptions') or [])
    s['fw']['admin_expiry'] = [e.get('expires') for e in (st.get('admin_exceptions') or [])]
    s['nft'] = nft_counters()
    s['other_tables_hash'] = others_hash()
    s['ipt4'] = ipt('iptables', 'STG-8443')
    s['ipt6'] = ipt('ip6tables', 'STG-8443-V6')
    s['ufw'] = {'active': 'Status: active' in sh('ufw status'), 'hash': h(sh('ufw status verbose'))}
    top = sh('fail2ban-client status')
    jails = re.search(r'Jail list:\s*(.*)', top)
    jl = sorted(j.strip() for j in jails.group(1).split(',')) if jails else []
    banned = {}
    for j in jl:
        m = re.search(r'Currently banned:\s*(\d+)', sh(f'fail2ban-client status {j}'))
        banned[j] = int(m.group(1)) if m else None
    s['f2b'] = {'jails': jl, 'banned': banned}
    units = ['staging-8443-fw.service', 'staging-8443-fw-verify.timer', 'staging-8443-fw-refresh.timer', 'staging-8443-firewall.service']
    s['units'] = {u: sh(f'systemctl is-active {u}').strip() for u in units}
    s['units_enabled'] = {u: sh(f'systemctl is-enabled {u}').strip() for u in units}
    s['failed_units_staging'] = len([l for l in sh('systemctl --failed --no-legend').splitlines() if 'staging-8443' in l])
    sv = sh('systemctl show staging-8443-fw-verify.service -p Result -p ExecMainStatus')
    s['verify_service'] = dict(l.split('=', 1) for l in sv.strip().splitlines() if '=' in l)
    s['refresh_timer_next'] = sh('systemctl show staging-8443-fw-refresh.timer -p NextElapseUSecRealtime').strip()
    s['verify_runs_since_prev'] = sh(f'journalctl -u staging-8443-fw-verify.service --since "{JC(prev_ts)}" --no-pager -o cat').count('Starting')
    # containers: one inspect for all running ones
    ids = sh('docker ps -q').split()
    cont = {}
    if ids:
        for c in json.loads(sh('docker inspect ' + ' '.join(ids)) or '[]'):
            cont[c['Name'].lstrip('/')] = {'status': c['State']['Status'], 'health': (c['State'].get('Health') or {}).get('Status', 'none'),
                                           'restarts': c['RestartCount'], 'started': c['State']['StartedAt']}
    s['containers'] = cont
    s['nginx_5xx'] = {n: len(re.findall(r'" 5\d\d ', sh(f'docker logs --since "{prev_ts}" {n} 2>&1', merge_err=True))) for n in ('wa_nginx', 'wa_staging_nginx')}
    s['sys'] = {'load': os.getloadavg()[0], 'mem_avail_mb': int(re.search(r'MemAvailable:\s+(\d+)', open('/proc/meminfo').read()).group(1)) // 1024,
                'disk_free_gb': round(os.statvfs('/').f_bavail * os.statvfs('/').f_frsize / 1e9, 1)}
    s['alerts_log_lines'] = len(open('/var/log/staging-8443-alerts.log').read().splitlines()) if os.path.exists('/var/log/staging-8443-alerts.log') else 0
    return s


def analyse(samples, t0, t1):
    anomalies = []
    if not samples:
        return {'verdict': 'INCOMPLETE', 'anomalies': ['no samples']}
    first, last = samples[0], samples[-1]
    ts = [dt.datetime.strptime(x['t'], '%Y-%m-%dT%H:%M:%SZ') for x in samples]
    gaps = [(b - a).total_seconds() for a, b in zip(ts, ts[1:])]
    span = (ts[-1] - ts[0]).total_seconds()
    max_gap = max(gaps) if gaps else None
    if span < DURATION - 5:
        anomalies.append(f'covered only {span:.0f}s of {DURATION}s')
    if max_gap and max_gap > 45:
        anomalies.append(f'sampling gap {max_gap:.0f}s')
    sigs = {x['fw']['live_signature'] for x in samples}
    if sigs != {EXPECTED_SIG}:
        anomalies.append(f'signatures seen: {sorted(map(str, sigs))}')
    if {x['fw']['last_good'] for x in samples} != {EXPECTED_SNAPSHOT} or {x['fw']['mode'] for x in samples} != {'snapshot'}:
        anomalies.append('snapshot identity or mode changed')
    if any(not x['fw']['table_present'] or x['fw']['disabled'] for x in samples):
        anomalies.append('table missing or disabled in a sample')
    if len({json.dumps(x['fw']['admin_expiry']) for x in samples}) != 1 or first['fw']['admin_entries'] != 1:
        anomalies.append('admin exception changed')
    for key in ('gate_drop', 'fwd_drop', 'input_drop'):
        v = [x['nft'][key] for x in samples]
        if None in v:
            anomalies.append(f'counter {key} unreadable in some samples')
        elif v != sorted(v):
            anomalies.append(f'counter {key} decreased (table reloaded?)')
    if any((x['nft']['fwd_drop'] or 0) > 0 or (x['nft']['input_drop'] or 0) > 0 for x in samples):
        anomalies.append('base-chain drop counter non-zero (gate bypassed or emptied)')
    for k, exp in (('ipt4', 21), ('ipt6', 13)):
        if {x[k]['rules'] for x in samples} != {exp} or len({x[k]['save_hash'] for x in samples}) != 1:
            anomalies.append(f'old {k} layer changed')
    if len({x['other_tables_hash'] for x in samples}) != 1:
        anomalies.append('unrelated nft tables changed')
    if len({x['ufw']['hash'] for x in samples}) != 1 or not all(x['ufw']['active'] for x in samples):
        anomalies.append('UFW changed or inactive')
    if {tuple(x['f2b']['jails']) for x in samples} != {tuple(first['f2b']['jails'])} or len(first['f2b']['jails']) != 4:
        anomalies.append('fail2ban jails changed')
    for x in samples:
        for u, v in x['units'].items():
            if v != 'active':
                anomalies.append(f'{u} {v} at {x["t"]}'); break
        if x['failed_units_staging']:
            anomalies.append(f'failed staging unit at {x["t"]}'); break
    if any(x['verify_service'].get('Result') != 'success' for x in samples):
        anomalies.append('verify service result not success')
    base = first['containers']
    for x in samples:
        for n, c in base.items():
            cur = x['containers'].get(n)
            if not cur or cur['status'] != 'running' or cur['restarts'] != c['restarts'] or cur['started'] != c['started'] or cur['health'] == 'unhealthy':
                anomalies.append(f'container {n} changed at {x["t"]}'); break
    n5 = sum(sum(x['nginx_5xx'].values()) for x in samples)
    if n5:
        anomalies.append(f'{n5} nginx 5xx responses')
    if last['alerts_log_lines'] != first['alerts_log_lines']:
        anomalies.append('new lines in the alerts log')
    # verify cadence straight from the journal (supplementary; the pass decision also needs the samples above)
    j = sh(f'journalctl -u staging-8443-fw-verify.service --since "{ISO(t0).replace("T"," ").replace("Z"," UTC")}" --until "{ISO(t1).replace("T"," ").replace("Z"," UTC")}" --no-pager -o short-unix')
    starts = [float(l.split()[0]) for l in j.splitlines() if 'Starting' in l]
    vgap = max((b - a) for a, b in zip(starts, starts[1:])) if len(starts) > 1 else None
    if vgap is None or vgap > 15:
        anomalies.append(f'verify max gap {vgap}')
    perr = sh(f'journalctl -u "staging-8443-*" --since "{ISO(t0).replace("T"," ").replace("Z"," UTC")}" -p warning --no-pager -o cat').strip()
    if perr:
        anomalies.append('warning-or-worse journal lines from staging-8443 units')
    if errors:
        anomalies.append(f'{len(errors)} monitor command errors (see errors.json)')
    return {
        'verdict': 'PASS' if not anomalies else 'REVIEW', 'anomalies': anomalies, 'expected_sig': EXPECTED_SIG,
        'sig_first': first['fw']['live_signature'], 'sig_last': last['fw']['live_signature'],
        'first_sample': first['t'], 'last_sample': last['t'], 'span_seconds': span, 'samples': len(samples), 'max_sampling_gap_s': max_gap,
        'verify_runs': len(starts), 'verify_max_gap_s': vgap, 'nginx_5xx_total': n5,
        'counters_first': first['nft'], 'counters_last': last['nft'],
        'ipt4_first': first['ipt4']['counters'], 'ipt4_last': last['ipt4']['counters'], 'ipt6_first': first['ipt6']['counters'], 'ipt6_last': last['ipt6']['counters'],
        'f2b_banned_first': first['f2b']['banned'], 'f2b_banned_last': last['f2b']['banned'],
        'load_max': max(x['sys']['load'] for x in samples), 'mem_avail_min_mb': min(x['sys']['mem_avail_mb'] for x in samples), 'disk_free_min_gb': min(x['sys']['disk_free_gb'] for x in samples),
        'containers_up': len(last['containers']),
    }


def finish(reason):
    state['ended'] = ISO(NOW())
    state['exit_reason'] = reason
    write_json('errors.json', errors)
    if state['status'] == 'RUNNING':
        state['status'] = 'INCOMPLETE'
    write_json('completion.json', state)


def main():
    os.umask(0o077)
    os.makedirs(EVID, mode=0o700, exist_ok=True)
    os.chmod(EVID, 0o700)
    t0 = NOW()
    state['started'] = ISO(t0)
    write_json('completion.json', state)
    signal.signal(signal.SIGTERM, lambda *a: (_ for _ in ()).throw(KeyboardInterrupt('SIGTERM')))
    samples, prev = [], ISO(t0)
    start = time.monotonic()
    n = 0
    try:
        with open(os.path.join(EVID, 'samples.jsonl'), 'a') as f:
            while True:
                s = sample(prev)
                prev = s['t']
                samples.append(s)
                f.write(json.dumps(s, sort_keys=True) + '\n'); f.flush(); os.fsync(f.fileno())
                state['samples'] = len(samples)
                write_json('completion.json', state)
                n += 1
                if time.monotonic() - start >= DURATION:
                    break
                time.sleep(max(0.0, start + n * INTERVAL - time.monotonic()))
        summary = analyse(samples, t0, NOW())
        write_json('summary.json', summary)
        state['status'] = 'COMPLETED'
        finish('duration reached')
    except BaseException as e:  # always leave a completion record, even on SIGTERM or an unexpected failure
        try:
            write_json('summary.json', analyse(samples, t0, NOW()) | {'verdict': 'INCOMPLETE'})
        except Exception as e2:
            errors.append({'t': ISO(NOW()), 'exc': f'analysis failed: {e2}'})
        state['status'] = 'INCOMPLETE'
        finish(f'{type(e).__name__}: {e}')


main()
