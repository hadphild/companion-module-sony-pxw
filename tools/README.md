# PXW-Z300 control research

Camera: PXW-Z300, firmware 1.08

## Control path (verified working)

    SSH :22  (admin / password, keyboard-interactive)
      └─ direct-tcpip forward to  localhost:15740     <- ONLY permitted target
           └─ PTP-IP  (InitCommandRequest / InitEventRequest)
                └─ Sony PTP extensions (VendorExtensionID 17)

Notes:
- The camera's SSH allows no shell, no exec, no subsystem; only the one
  direct-tcpip forward to localhost:15740. Port 15740 is NOT reachable directly.
- Two SSH connections are needed: one for the PTP command channel, one for events.
- SDIO_GetExtDeviceInfo (0x9202) must be called with version 0x012C (300).
  0x00C8 only exposes 5 properties; 0x0190+ returns 0xA101.

## Handshake

    OpenSession           0x1002 (1)
    SDIO_Connect          0x9201 (1,0,0)
    SDIO_Connect          0x9201 (2,0,0)
    SDIO_GetExtDeviceInfo 0x9202 (0x012C)   -> 183 props, 25 controls
    SDIO_Connect          0x9201 (3,0,0)
    SDIO_GetAllExtDevicePropInfo 0x9209     -> 5077 bytes, all 183 props

## SDIO_GetAllExtDevicePropInfo wire format

    u32 count
    u32 reserved
    per property:
      u16 code
      u16 dataType
      u8  getSet          (1 = writable)
      u8  isEnable        (0 = currently greyed out)
      val defaultValue
      val currentValue
      u8  formFlag
      form 1 (range): min, max, step
      form 2 (enum) : u16 nGet + values, u16 nSet + values   <- TWO lists

## Confirmed properties

    0x5007  Iris        f-number x100   (cur 800 = f/8.0), 27 steps
    0xD20F  ColorTemp   2000..15000 K   (cur 5733)
    0xD00E  Shutter     angle x1000     (360000 = 360.0 deg), 19 steps
    0xD004  Focus dist  metres x100     (1400 = 14.00 m)
    0xD005  Focus dist  feet x100       (4500 = 45.00 ft)
    0xD086  WB preset K 2000..15000 step 100

## Control gate (important)

Property writes via `SDIO_SetExtDevicePropValue` (0x9205) return `rc=0x2001`
(OK) but are silently ignored unless
**[Network] > [Wired LAN] > [Camera Remote Control]** is set to **Enable**.

Observed while that setting was disabled:
- all 183 properties readable, `SDIO_GetDisplayStringList` readable
- `0xD006` (focus distance unit, a display preference) — writable
- `0xD2E4` / `0xD2EF` (touch focus via ControlDevice 0x9207) — effective
- iris `0x5007`, colour temp `0xD20F`, shutter, record — accepted and ignored

`enable` on a property is a *separate* gate meaning "a physical switch owns this
control right now": 0 unavailable, 1 locked, 2 settable. Both must be satisfied.

## Switch-tracking properties

Flipping the iris and focus switches to manual moved:

    0xD007  1 -> 2   focus mode      (CONFIRMED)
    0xD073  1 -> 2   iris mode       (inferred - mirrors 0xD007 exactly)
    0xD074  1 -> 0
    0xD091  1 -> 0
    0xD019  3 -> 5
    0xD01B  4294967300 -> 0

## Control opcodes identified by state-sweep (2026-08-28)

    0xD2FE  Record toggle (press 2-then-1; starts when idle, stops when recording)
    0xD2FF  Subject Recognition AF cycle (press cycles; STATE reads from 0xD080,
            labels = string group 21: 1 Off, 2 Human Only AF, 3 Human Priority AF)
    0xD2F9  While recording flipped 0xD122 1->2 once - clip flag / shot mark
            suspect, not yet confirmed
    0xD03E  RO live readout that drifts on its own; a rolling-base diff once
            attributed its movement to 0xF000/F001 - false positive, since
            retracted. Sweep lesson: re-test any single-occurrence hit.

Direct-select of AI AF via 0xD07F refuses writes in every state tried,
including FOCUS switch AUTO; the cycle button is the working mechanism.

## Multi-camera Companion config

tools/make-cc1-config.js builds z300-cc1.companionconfig. For one camera it uses
CAM / CAM_PASS. For several, pass CAMS as a JSON array:

    CAMS='[{"label":"CAM1","host":"192.168.0.10","pass":"pw1"},
           {"label":"CAM2","host":"192.168.0.11","pass":"pw2"}]' \
      node tools/make-cc1-config.js

Each camera gets its own connection, a live page, and a full set of preset
pages. The < / > buttons on every page move to the previous/next page, and when
the destination is a camera live page they also set the `selected_camera`
custom variable. One fader trigger per camera is gated on that variable, so the
physical CC121MK2 fader drives only the camera you are currently looking at, and
every tile on the live page reads that camera's values.
