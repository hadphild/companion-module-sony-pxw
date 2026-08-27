# companion-module-sony-pxw

Bitfocus Companion module for Sony "Pro Camera Remote Control" camcorders —
**PXW-Z300**, PXW-Z200 and HXR-NX800.

These bodies are not VISCA PTZ cameras: they expose a Sony-extended PTP
interface tunnelled through SSH, so they need their own module rather than an
addition to `companion-module-sony-visca`.

## What works today

Verified live against a PXW-Z300 on firmware 1.08.

### Control

| Feature | How | Notes |
| --- | --- | --- |
| **Record** start / stop / toggle | `0xD2C8` u16, 2 = start, 1 = stop | Needs a card in a slot |
| **Zoom** variable speed | `0xD2DD` signed i8, ±1–8 | Hold to drive, release to stop |
| **Colour temperature** | write `0xD20F` | WB switch must be on memory A/B |
| **Tint** | write `0xD00D` | Recomputes the R/B gains |
| **WB red / blue gain** | write `0xD087` / `0xD088` | Set gains first, tint last |
| **WB switch position** | write `0xD085` | PRESET / memory A / memory B |
| **Focus distance units** | write `0xD006` | Metres or feet |
| **Touch-to-focus** | `0xD2E4` | |

### Monitoring

Iris, shutter angle, colour temperature, tint, focus distance, focus mode, zoom
position, WB switch position, both card slots (status and remaining time),
battery, recording state, and per-property switch state.

### Not controllable

**Iris** (`0x5007`) and **shutter** (`0xD00E`) are readable but reject every
write, in every switch combination tried, via both setter opcodes and a full
sweep of the control-opcode list with signed and unsigned values. **Recording
resolution** (`0xD024`) is likewise read-only. Gain/ISO and ND filter codes are
not yet identified.

## Camera setup

1. **[Network] > [Network Setup] > [Edit Authentication]** — set a user name and
   password (8–16 chars, must mix letters and numbers).
2. **[Network] > [Wired LAN] > [Camera Remote Control] > [Enable]**
   (or the same item under [Wireless LAN] if connecting over Wi-Fi).

Without step 2 the camera still answers, reports every property and accepts
commands with a success code — but silently ignores exposure, white balance and
record. The module logs a warning when it detects a write being ignored.

Manual control also requires the relevant **physical switch** to be off auto.
The camera reports this per property, and the module surfaces it as
`$(sony-pxw:iris_available)` and the *Control locked by a camera switch* feedback,
so buttons can grey out when the camera has taken the control away.

## What it does

77 generated presets across Iris, Shutter, White balance, Focus, Zoom, Menu,
Record and Status. The iris and shutter banks are built from the value lists the
attached camera actually reports, so they match the body rather than a hardcoded
table.

Variables include iris, iris mode, shutter angle, colour temperature, focus
distance and mode, zoom, battery and both card slots.

## Development

    npm install
    node dev.js          # connect to a camera and dump variables + preset counts

`CAM`, `CAM_USER` and `CAM_PASS` override the target.

See [tools/README.md](tools/README.md) for the reverse-engineered protocol notes
and the research scripts.

## What is and isn't remotely settable

Verified against a Z300 on firmware 1.08, in every combination of FULL AUTO,
manual switches and auto/servo rings:

| Property | Function | Writable |
| --- | --- | --- |
| `0x5007` | Iris (f-number x100) | no |
| `0xD00B` | Zoom focal length (`0xD25D` = zoom bar) | no |
| `0xD004` / `0xD005` | Focus distance m / ft | no |
| `0xD00E` | Shutter angle (degrees x1000) | no |
| `0xD20F` | Colour temperature | **yes**, on WB memory A/B |
| `0xD00D` | Tint (drives the R/B gains) | **yes**, on WB memory A/B |
| `0xD087` / `0xD088` | WB red / blue gain | **yes**, on WB memory A/B |
| `0xD085` | WB switch PRESET / A / B | **yes** |
| `0xD006` | Focus distance unit m/ft | **yes** |

White balance is fully controllable, but only while the WB switch `0xD085` is on
a **memory position** (2 = A, 3 = B). On PRESET (1) every WB write is accepted
and silently discarded. Set colour temperature by writing `0xD20F` directly;
tint recomputes the R/B gains, so set gains first and tint last.

Controls `0xD2EC` (colour temp) and `0xD2ED` (tint) also adjust these, but they
read their argument as **unsigned magnitude** — an i8 `-1` arrives as 255 and
ramps to the limit — so they only drive one way and need a `0` to stop. Writing
the property is precise and preferred.

Zoom **is** drivable — not by writing `0xD00B`, but through the
`SDIO_ControlDevice` opcode `0xD2DD`, which takes a **signed i8**: sign selects
direction (+ tele, − wide) and magnitude is speed 1–8, matching the range
reported by `0xD25E` ZoomSpeedRange. Measured: speed 2 moved 3000 units in
1.2 s, speed 8 moved 274000. Motion is continuous, so every start needs a
matching `0`; the Zoom presets drive on press and stop on release.

Writes to the refused properties return `rc=0x2001` (success) and are silently
discarded. `SDIO_ControlDevice` opcodes do take effect — `0xD2E4` drives
touch-to-focus — so the transport is sound; these specific codes are telemetry.

The per-property `enable` flag does **not** predict this: `0xD085` accepts writes
at `enable=1` while iris refuses them at `enable=2`. Treat it as camera state
only.

## Record

CONFIRMED: `SDIO_ControlDevice` opcode `0xD2C8` as **u16**, `2` = start,
`1` = stop. It latches — a start keeps recording until an explicit stop.

It requires recordable media. With an empty slot the opcode is accepted
(`rc=0x2001`) and silently ignored, which is what made this look unsupported
for a long time. Slot status `1` = card present, `2` = no card.

`0xD279` reads `1` when idle and `0` for exactly the duration of a recording;
`0xD292`, `0xD08B`, `0xD08C` and `0xD08D` track it identically. The module uses
`0xD279` for the `recording` feedback and variable.

## Recording format

    0xD024  resolution, packed (width << 16) | height
            251660400 = 3840x2160, 125830200 = 1920x1080, 83886800 = 1280x720
    0xD286  frame rate, decodes through display-string group 18
            (4 = 50p, 3 = 60p, 6 = 25p, 0 = 59.98p, ...)

Both are readable, and neither accepts a write — recording format has to be
changed in the camera menu.

## Formatting media

`0xD2E2` FormatMediaCard **does work**: as u16 with the slot number, it
unmounts the card, formats and remounts it. It is deliberately **not exposed as
a module action** — an irreversible wipe one keypress away from a live surface
is not worth the convenience.

## Not yet identified

- **Iris and shutter.** Still refused by every route tried, in all switch
  positions including FULL AUTO off with both switches manual, and by sweeping
  the whole control-opcode list with signed and unsigned values. Cyanview report controlling iris, gain, shutter, ND and
  colour temperature on this body, so a mechanism exists, but it is not any of
  `SDIO_SetExtDevicePropValue` / `SDIO_ControlDevice` against these property
  codes, nor any of the 25 advertised control opcodes. `SDIO_GetControlDeviceDesc`
  returns empty for every control. Resolving this most likely needs Sony's
  **Camera Remote Command** specification (free, corporate registration).
- **Record.** `0xD2C8` (`MovieRecButtonHold`) is accepted but never observed to
  record. Both card slots reported 0 minutes remaining during testing, so this
  may simply have been a no-media condition and is worth retesting with a card in.
- Gain / ISO and ND filter codes.
- 165 of the 183 properties remain unnamed. `tools/watch.js` names them by
  diffing while a control is moved on the camera.

`0xD2E2` is `FormatMediaCard`. It is deliberately excluded from the module and
from all research scripts.
