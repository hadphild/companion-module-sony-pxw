'use strict'
// Property table for the PXW-Z300 "Pro Camera Remote Control" PTP interface.
// Codes marked CONFIRMED were verified live against a Z300 on firmware 1.08;
// the rest of the 183 reported properties are still unidentified.

const P = {
  // CONFIRMED WRITABLE with the documented recipe: physical IRIS switch on
  // AUTO, then write IRIS_MODE_SETTING = 2 (Manual), then values stick.
  // With the IRIS switch on MANUAL the ring owns it and writes are discarded.
  IRIS:          0x5007, // u16, f-number x100 (800 = f/8.0)
  // CONFIRMED: the direct-menu iris Auto(1)/Manual(2). Writable ONLY while the
  // physical IRIS switch is on AUTO - the gate for remote iris control.
  IRIS_MODE_SETTING: 0xd001,
  // Went 1 -> 2 at the moment the iris switch was set to manual, mirroring the
  // confirmed FOCUS_MODE behaviour exactly. Treated as the iris auto/manual state.
  IRIS_MODE:     0xd073,
  FOCUS_M:       0xd004, // CONFIRMED u32, metres x100
  FOCUS_FT:      0xd005, // CONFIRMED u32, feet x100
  FOCUS_UNIT:    0xd006, // CONFIRMED u8, 1 = metre, 2 = feet
  FOCUS_MODE:    0xd007, // CONFIRMED u8, 1 = auto, 2 = manual
  // CONFIRMED WRITABLE with the same recipe as iris: physical SHUTTER switch
  // ON, then SHUTTER_MODE = 2, then angle values stick (verified 90-300 deg).
  SHUTTER_ANGLE: 0xd00e, // u32, degrees x1000 (360000 = 360.0 = shutter off)
  // CONFIRMED: the shutter Auto/Manual gate. 2 unlocks SHUTTER_ANGLE writes.
  SHUTTER_MODE:  0xd010,
  WB_PRESET_K:   0xd086, // CONFIRMED u16, kelvin, step 100
  // CONFIRMED: three positions tracking the PRESET/A/B switch, and the only
  // exposure-side property observed to accept a write.
  WB_SWITCH:     0xd085,
  // CONFIRMED writable — but only while the WB switch (0xD085) is on a memory
  // position (2 = A, 3 = B). On PRESET (1) the write is accepted and ignored.
  COLOUR_TEMP:   0xd20f, // u16, kelvin 2000..15000
  TINT:          0xd00d, // CONFIRMED i8 writable; drives the R/B gains below
  WB_R_GAIN:     0xd087, // CONFIRMED i16 writable, -990..990
  WB_B_GAIN:     0xd088, // CONFIRMED i16 writable, -990..990
  // CONFIRMED by watching the zoom rocker: focal length readout, moves with
  // 0xD25D (zoom bar). Rejects writes - the rocker owns it.
  ZOOM:          0xd00b,
  ZOOM_BAR:      0xd25d,
  ZOOM_LEGACY:   0xd214, // present, but did not move with the rocker
  BATTERY:       0xd218, // CONFIRMED i8, percent (-1 = no battery / on mains)
  ISO:           0xd21e, // CONFIRMED u32
  FILE_FORMAT:   0xd241, // CONFIRMED u8
  SLOT1_STATUS:  0xd248, // CONFIRMED u8
  SLOT1_TIME:    0xd24a, // CONFIRMED u32, remaining shooting time
  SLOT2_STATUS:  0xd256, // CONFIRMED u8
  SLOT2_TIME:    0xd258, // CONFIRMED u32
  ZOOM_ENABLED:  0xd25b, // CONFIRMED u8
  // CONFIRMED: reads 1 when idle and 0 for exactly the duration of a recording.
  // 0xD292 / 0xD08B / 0xD08C / 0xD08D track it identically.
  REC_STATE:     0xd279,
  // CONFIRMED BY EYE (first pinned as colour bars - wrong; a menu-session
  // coincidence): 2 = S&Q Motion on, 1 = off. Writable. The S&Q frame rate
  // 0xD286 stays read-only even while S&Q is engaged.
  SQ_MOTION:     0xd051,
  // Subject Recognition AF current state (RO). Labels are string group 21:
  // 1 Off, 2 Human Only AF, 3 Human Priority AF. Cycle it with AI_AF_CYCLE;
  // the direct-select property 0xD07F refuses writes in every state tried.
  AI_AF_STATE:   0xd080,
}

// SDIO_ControlDevice opcodes. 0xD2E2 is FormatMediaCard and is deliberately
// absent — this module must never be able to wipe a card.
const C = {
  MOVIE_REC:  0xd2c8, // named MovieRecButtonHold; accepted but not yet observed to record
  // CONFIRMED. Takes a SIGNED i8: sign = direction (+ tele, - wide), magnitude
  // = speed 1..8, 0 = stop. Matches 0xD25E ZoomSpeedRange (-8..8). Motion is
  // continuous until a 0 is sent, so every start needs a matching stop.
  ZOOM_OP:    0xd2dd,
  KEY_UP:     0xd2cd,
  KEY_DOWN:   0xd2ce,
  KEY_LEFT:   0xd2cf,
  KEY_RIGHT:  0xd2d0,
  TOUCH:      0xd2e4, // CONFIRMED — drives touch-to-focus
  TOUCH_STOP: 0xd2e5,
  // CONFIRMED by three-state sweeps with property diffing:
  REC_TOGGLE:  0xd2fe, // press (2 then 1) toggles recording - alternative to MOVIE_REC
  AI_AF_CYCLE: 0xd2ff, // press cycles Subject Recognition AF; state reads from 0xD080
  // Continuous adjusters found by sweeping the control list. They read the
  // value as UNSIGNED magnitude (i8 -1 arrives as 255 and ramps hard), so they
  // only drive one way and need a 0 to stop. Writing the property directly is
  // more precise; these are kept for completeness.
  CT_ADJUST:   0xd2ec,
  TINT_ADJUST: 0xd2ed,
  FOCUS_ADJ_A: 0xd2ef,
  FOCUS_ADJ_B: 0xd2f7,
}

// CONFIRMED by observation: a card in slot 1 reported status 1 with a non-zero
// remaining time, while the empty slot 2 reported status 2 with time 0.
const SLOT_STATUS = { 1: 'Card', 2: 'No card', 3: 'Recording', 4: 'Error' }

// The camera's per-property `enable` flag. It tracks switch positions (it moves
// when FULL AUTO or the iris/focus switches change) but it does NOT predict
// whether a write will be accepted: 0xD085 accepts writes at enable=1, while
// iris 0x5007 refuses them at enable=2. Reported as camera state, nothing more.
const AVAILABILITY = { 0: 'Off', 1: 'Locked', 2: 'Active' }

const fmt = {
  // 0xFFFD and friends are the camera's "not a meaningful value" sentinels,
  // reported when the iris ring sits past a stop or the value is unavailable.
  iris: v => (v === undefined || v === 0 || v >= 0xfff0 ? '—' : 'f/' + (v / 100).toFixed(1)),
  angle: v => (v === undefined ? '—' : (v / 1000).toFixed(1) + '°'),
  kelvin: v => (v === undefined ? '—' : v + 'K'),
  metres: v => (v === undefined || v === 0xffffffff ? '—' : (v / 100).toFixed(2) + ' m'),
  feet: v => (v === undefined || v === 0xffffffff ? '—' : (v / 100).toFixed(2) + ' ft'),
  percent: v => (v === undefined || v < 0 ? '—' : v + '%'),
  minutes: v => (v === undefined || v === 0 ? '—' : Math.floor(v / 60) + ':' + String(v % 60).padStart(2, '0')),
  slot: v => SLOT_STATUS[v] || `Unknown (${v})`,
  onOff: v => (v === 2 ? 'Manual' : v === 1 ? 'Auto' : '—'),
}

module.exports = { P, C, fmt, SLOT_STATUS, AVAILABILITY }
