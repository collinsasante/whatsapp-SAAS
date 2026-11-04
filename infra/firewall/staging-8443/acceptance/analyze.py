# usage: analyze.py <events.txt> <probe.log>   events: "<epoch> <label>" ; probe: "<epoch> <target> <0|1>"
# Prints key=value verdict lines. Expectations: U* never open; P* never closed; CF* may be closed ONLY inside a "<case> inject" .. "<case> repaired" window.
import sys
ev=[]
for l in open(sys.argv[1]):
    if l.strip(): t,m=l.split(None,1); ev.append((float(t),m.strip()))
pr=[]
for l in open(sys.argv[2]):
    f=l.split()
    if len(f)==3: pr.append((float(f[0]),f[1],int(f[2])))
def runs(rows,val):
    out=[];s=last=None
    for t,v in rows:
        if v==val:
            s=t if s is None else s; last=t
        elif s is not None: out.append((s,last)); s=None
    if s is not None: out.append((s,last))
    return out
by={}
for t,n,v in pr: by.setdefault(n,[]).append((t,v))
wins={}
for t,m in ev:
    if m.endswith(" inject"): wins[m[:-7]]=[t,None]
    if m.endswith(" repaired") and m[:-9] in wins: wins[m[:-9]][1]=t
for n,rows in sorted(by.items()):
    print(f"probes_{n}={len(rows)} open={sum(v for _,v in rows)} closed={sum(1-v for _,v in rows)}")
unauth=sum(v for n in ("U4","U6") for _,v in by.get(n,[]))
pclosed=sum(1-v for n in ("P443","P80") for _,v in by.get(n,[]))
print(f"UNAUTH_EXPOSED_PROBES={unauth}"); print(f"PROD_PORT_CLOSED_PROBES={pclosed}")
cfmax=0.0; outside=0
for n in ("CF4","CF6"):
    for a,b in runs(by.get(n,[]),0):
        d=b-a
        inwin=any(w[0]-0.5<=a and (w[1] or 1e18)+1.0>=b for w in wins.values())
        print(f"cf_closed_window {n} {d:.1f}s {'inside-injection-window' if inwin else 'OUTSIDE-any-window'}")
        cfmax=max(cfmax,d); outside+=0 if inwin else 1
print(f"CF_BLOCKED_MAX_S={cfmax:.1f}"); print(f"CF_BLOCKED_OUTSIDE_WINDOWS={outside}")
for k,(a,b) in wins.items(): print(f"repair_time {k} {((b or a)-a):.1f}s")
