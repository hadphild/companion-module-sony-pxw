from ptpip import PTPIP
from sonyprops import parse_all_props
import json

c = PTPIP()
c.op(0x1002,(1,)); c.op(0x9201,(1,0,0)); c.op(0x9201,(2,0,0))
c.op(0x9202,(0x012C,)); c.op(0x9201,(3,0,0))
rc,rp,data = c.op(0x9209)
props, consumed, total = parse_all_props(data)
print(f"parsed {len(props)} props, consumed {consumed}/{total} bytes\n")
for p in props:
    ex=""
    if p["form"]==1: ex=f"range {p['min']}..{p['max']}/{p['step']}"
    elif p["form"]==2:
        sv=p["set_values"]
        ex=f"set[{len(sv)}]={sv[:10]}{'..' if len(sv)>10 else ''}"
    print(f"{p['code']:04x} {p['dtname']:<4} {'RW' if p['writable'] else 'RO'} en={p['enable']} cur={p['current']!r:<18} {ex}")
json.dump(props, open("props.json","w"), indent=1)
c.close()
