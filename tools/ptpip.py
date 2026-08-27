import paramiko, struct, uuid

import os
HOST = os.environ["CAM"]
USER = os.environ.get("CAM_USER", "admin")
PW = os.environ["CAM_PASS"]

def utf16z(s): return s.encode("utf-16-le") + b"\x00\x00"

class Chan:
    """PTP-IP channel tunnelled through SSH direct-tcpip to localhost:15740."""
    def __init__(self):
        self.t = paramiko.Transport((HOST, 22))
        self.t.start_client(timeout=15)
        self.t.auth_interactive(USER, lambda a,b,p: [PW for _ in p])
        self.c = self.t.open_channel("direct-tcpip", ("localhost",15740), ("127.0.0.1",12345), timeout=10)
        self.c.settimeout(15)
    def send(self, ptype, body):
        self.c.sendall(struct.pack("<II", len(body)+8, ptype) + body)
    def recvn(self, n):
        b = b""
        while len(b) < n:
            d = self.c.recv(n-len(b))
            if not d: raise EOFError("channel closed")
            b += d
        return b
    def recv(self):
        ln, ptype = struct.unpack("<II", self.recvn(8))
        return ptype, self.recvn(ln-8)
    def close(self):
        try: self.c.close(); self.t.close()
        except Exception: pass

class PTPIP:
    def __init__(self, name="Companion"):
        self.guid = uuid.uuid4().bytes
        self.txid = 0
        self.cmd = Chan()
        self.cmd.send(1, self.guid + utf16z(name) + struct.pack("<I", 0x00010000))
        pt, body = self.cmd.recv()
        if pt != 2: raise RuntimeError(f"InitCommandAck failed, type={pt} {body.hex()}")
        self.conn = struct.unpack("<I", body[:4])[0]
        self.evt = Chan()
        self.evt.send(3, struct.pack("<I", self.conn))
        pt, _ = self.evt.recv()
        if pt != 4: raise RuntimeError(f"InitEventAck failed, type={pt}")

    def op(self, opcode, params=(), data=None):
        """Returns (response_code, response_params, data_bytes)."""
        self.txid += 1
        tx = self.txid
        phase = 2 if data is not None else 1
        body = struct.pack("<IHI", phase, opcode, tx) + b"".join(struct.pack("<I", p) for p in params)
        self.cmd.send(6, body)
        if data is not None:
            self.cmd.send(9, struct.pack("<I", tx) + struct.pack("<Q", len(data)))
            self.cmd.send(12, struct.pack("<I", tx) + data)
        buf = b""
        while True:
            pt, b = self.cmd.recv()
            if pt == 9:      continue                 # StartData
            elif pt == 10:   buf += b[4:]             # Data
            elif pt == 12:   buf += b[4:]             # EndData
            elif pt == 7:                             # Response
                rc = struct.unpack("<H", b[0:2])[0]
                rp = [struct.unpack("<I", b[6+i*4:10+i*4])[0] for i in range((len(b)-6)//4)]
                return rc, rp, buf
            else:            raise RuntimeError(f"unexpected packet type {pt}")
    def close(self):
        self.evt.close(); self.cmd.close()

# --- PTP dataset parsing ---
class R:
    def __init__(self, b): self.b, self.o = b, 0
    def u8(self):  v = self.b[self.o]; self.o += 1; return v
    def u16(self): v = struct.unpack("<H", self.b[self.o:self.o+2])[0]; self.o += 2; return v
    def u32(self): v = struct.unpack("<I", self.b[self.o:self.o+4])[0]; self.o += 4; return v
    def arr16(self):
        n = self.u32(); return [self.u16() for _ in range(n)]
    def arr32(self):
        n = self.u32(); return [self.u32() for _ in range(n)]
    def string(self):
        n = self.u8()
        if n == 0: return ""
        s = self.b[self.o:self.o+n*2].decode("utf-16-le","replace").rstrip("\x00")
        self.o += n*2; return s

def parse_device_info(b):
    r = R(b)
    d = {}
    d["StandardVersion"] = r.u16()
    d["VendorExtensionID"] = r.u32()
    d["VendorExtensionVersion"] = r.u16()
    d["VendorExtensionDesc"] = r.string()
    d["FunctionalMode"] = r.u16()
    d["OperationsSupported"] = r.arr16()
    d["EventsSupported"] = r.arr16()
    d["DevicePropertiesSupported"] = r.arr16()
    d["CaptureFormats"] = r.arr16()
    d["ImageFormats"] = r.arr16()
    d["Manufacturer"] = r.string()
    d["Model"] = r.string()
    d["DeviceVersion"] = r.string()
    d["SerialNumber"] = r.string()
    return d
