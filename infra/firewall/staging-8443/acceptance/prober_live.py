# Runs INSIDE the stgacc namespace (the AP-1 matrix scaffolding). One thread per target, ~5 attempts/s; logs "epoch name 1|0" (1 = TCP connect succeeded).
# U4/U6 = unauthorised sources on :8443 (must NEVER be open).  CF4/CF6 = Cloudflare-range sources on :8443.  P443/P80 = production ports (must NEVER close).
import socket,sys,threading,time
log=open(sys.argv[1],"a",buffering=1); lock=threading.Lock(); end=time.time()+float(sys.argv[2])
H4,H6="192.0.2.1","fd00:8443:99::1"
T=[("U4",socket.AF_INET,"192.0.2.2",H4,8443),("CF4",socket.AF_INET,"173.245.48.250",H4,8443),
   ("U6",socket.AF_INET6,"fd00:8443:99::2",H6,8443),("CF6",socket.AF_INET6,"2400:cb00:fffe::7",H6,8443),
   ("P443",socket.AF_INET,"192.0.2.2",H4,443),("P80",socket.AF_INET,"192.0.2.2",H4,80)]
def run(n,fam,src,dst,port):
    while time.time()<end:
        s=socket.socket(fam,socket.SOCK_STREAM); s.settimeout(0.25)
        try: s.bind((src,0)); r=s.connect_ex((dst,port))
        except Exception: r=-1
        s.close()
        with lock: log.write(f"{time.time():.3f} {n} {1 if r==0 else 0}\n")
        time.sleep(0.1 if port==8443 else 0.3)
for t in T: threading.Thread(target=run,args=t,daemon=True).start()
while time.time()<end: time.sleep(0.2)
