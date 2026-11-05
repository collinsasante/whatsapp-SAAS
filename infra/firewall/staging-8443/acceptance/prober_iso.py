# Runs INSIDE the client namespace. One thread per target; logs "epoch name 1|0" (1 = TCP connect succeeded).
import socket,sys,threading,time
log=open(sys.argv[1],"a",buffering=1); lock=threading.Lock(); end=time.time()+float(sys.argv[2])
T=[("U4",socket.AF_INET,"10.88.1.2","10.88.1.1"),("CF4",socket.AF_INET,"173.245.48.250","10.88.1.1"),
   ("U6",socket.AF_INET6,"fd00:88:1::2","fd00:88:1::1"),("CF6",socket.AF_INET6,"2400:cb00:fffe::7","fd00:88:1::1")]
def run(n,fam,src,dst):
    while time.time()<end:
        s=socket.socket(fam,socket.SOCK_STREAM); s.settimeout(0.25)
        try: s.bind((src,0)); r=s.connect_ex((dst,8443))
        except Exception: r=-1
        s.close()
        with lock: log.write(f"{time.time():.3f} {n} {1 if r==0 else 0}\n")
        time.sleep(0.05)
for t in T: threading.Thread(target=run,args=t,daemon=True).start()
while time.time()<end: time.sleep(0.2)
