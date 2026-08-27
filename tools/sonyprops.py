import struct
DT = {0x0001:"i8",0x0002:"u8",0x0003:"i16",0x0004:"u16",0x0005:"i32",0x0006:"u32",
      0x0007:"i64",0x0008:"u64",0x0009:"i128",0x000a:"u128",
      0x4001:"ai8",0x4002:"au8",0x4003:"ai16",0x4004:"au16",0x4005:"ai32",0x4006:"au32",
      0xffff:"str"}
SZ={"i8":1,"u8":1,"i16":2,"u16":2,"i32":4,"u32":4,"i64":8,"u64":8,"i128":16,"u128":16}
SIGNED={"i8","i16","i32","i64","i128"}

class R:
    def __init__(s,b): s.b, s.o = b, 0
    def u8(s):  v=s.b[s.o]; s.o+=1; return v
    def u16(s): v=struct.unpack("<H",s.b[s.o:s.o+2])[0]; s.o+=2; return v
    def u32(s): v=struct.unpack("<I",s.b[s.o:s.o+4])[0]; s.o+=4; return v
    def val(s,dt):
        t=DT.get(dt)
        if t is None: raise ValueError(f"dt 0x{dt:04x}")
        if t=="str":
            n=s.u8()
            if n==0: return ""
            v=s.b[s.o:s.o+n*2].decode("utf-16-le","replace").rstrip("\x00"); s.o+=n*2; return v
        if t.startswith("a"):
            n=s.u32(); base=t[1:]; sz=SZ[base]; out=[]
            for _ in range(n):
                out.append(int.from_bytes(s.b[s.o:s.o+sz],"little",signed=base in SIGNED)); s.o+=sz
            return out
        sz=SZ[t]; v=int.from_bytes(s.b[s.o:s.o+sz],"little",signed=t in SIGNED); s.o+=sz; return v

def parse_all_props(data):
    r=R(data); n=r.u32(); r.u32()          # count + reserved
    props=[]
    for i in range(n):
        p={}
        p["code"]=r.u16(); dt=r.u16(); p["dt"]=dt; p["dtname"]=DT.get(dt,hex(dt))
        p["writable"]=bool(r.u8()); p["enable"]=r.u8()
        p["default"]=r.val(dt); p["current"]=r.val(dt)
        form=r.u8(); p["form"]=form
        if form==1:
            p["min"],p["max"],p["step"]=r.val(dt),r.val(dt),r.val(dt)
        elif form==2:
            ng=r.u16(); p["get_values"]=[r.val(dt) for _ in range(ng)]
            ns=r.u16(); p["set_values"]=[r.val(dt) for _ in range(ns)]
        props.append(p)
    return props, r.o, len(data)
