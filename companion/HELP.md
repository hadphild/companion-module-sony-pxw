## Sony PXW camcorder control

Controls **PXW-Z300**, **PXW-Z200** and **HXR-NX800** bodies over Sony's
"Pro Camera Remote Control" interface — PTP-IP tunnelled through SSH.

These are camcorders, not PTZ heads. The lens rings physically own iris, zoom
and focus, so several properties are readable but not settable. What is and
isn't controllable is listed below.

---

### Camera setup

1. **[Network] > [Network Setup] > [Edit Authentication]** — set a user name and
   password (8–16 characters, mixing letters and numbers).
   **[Show Authentication]** displays the current values and a QR code.
2. **[Network] > [Wired LAN] > [Camera Remote Control] > [Enable]**
   (or the same item under **[Wireless LAN]** on Wi-Fi).
3. Give the camera a reachable IP address and enter it in the connection config.

---

### Before controls respond

Most "nothing happened" cases are a camera precondition rather than a fault —
the camera accepts the command, returns success, and discards it.

| Control | Requires |
| --- | --- |
| Record | A card in slot 1 or 2 |
| Colour temp / tint / WB gains | WB switch on memory **A** or **B**, not PRESET |
| Anything manual | **FULL AUTO** switched off |

---

### Actions

**Record** — start, stop or toggle. Latching: a start keeps recording until stopped.

**Zoom** — direction plus speed 1–8. Motion is continuous, so the supplied
presets drive on press and stop on release. *Zoom stop* halts it explicitly.

**White balance** — set colour temperature (2000–15000 K), tint (−99…99),
red/blue gain (−990…990), and the switch position (PRESET / memory A / memory B).
Tint recomputes the gains, so set gains first and tint last.

**Iris** — set f-stop, step, or drive from a fader percent (0-100). Needs the
physical IRIS switch on AUTO; the actions set the direct-menu mode to Manual
automatically.

**Shutter** — set angle. Needs the physical SHUTTER switch ON; the mode is set
to Manual automatically.

**S&Q Motion** — on/off (the frame rate itself is menu-only).

**AI focus** — cycles Subject Recognition AF (Off / Human Only / Human
Priority); the current mode is shown by the `ai_focus` variable.

**White balance nudges** — R/B gain, tint and colour temperature encoder
actions accumulate locally and coalesce writes, so encoders feel immediate.

**Set any property / Send a key** — advanced escape hatches for experimenting
with property and control codes by number.

---

### Feedbacks

- **Camera connected**
- **Camera is recording**
- **Property has value** — highlight a button when a property matches a value
- **Camera reports control not Active**

---

### Variables

`model`, `recording`, `iris`, `iris_mode`, `shutter_angle`, `colour_temp`,
`tint`, `wb_switch`, `focus_distance`, `focus_mode`, `focus_unit`, `zoom`,
`battery`, `slot1_status`, `slot1_time`, `slot2_status`, `slot2_time`,
`iris_state`, `focus_state`, `wb_state`.

Slot times are `mm:ss` remaining. `*_state` reports what the camera says about a
control (Off / Locked / Active) — note this reflects switch positions and does
**not** reliably predict whether a write will be accepted.

---

### Presets

Around 85 once connected, across Iris, Shutter, White balance, Focus, Zoom,
Menu, Record and Status. The iris and shutter banks are generated from the value
lists the attached camera reports, so they match the body rather than a fixed table.

---

### Troubleshooting

**Connection fails** — check Camera Remote Control is enabled for the interface
in use, and that the user name and password match the camera exactly.

**A command does nothing** — check the preconditions table above. The module
logs a warning when it detects a write being accepted and ignored.

**Formatting media** is deliberately not exposed as an action.
