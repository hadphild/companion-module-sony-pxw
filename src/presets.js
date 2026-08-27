'use strict'
const { combineRgb } = require('@companion-module/base')
const { P, C, fmt } = require('./props')

const BLACK = combineRgb(0, 0, 0)
const WHITE = combineRgb(255, 255, 255)
const GREY = combineRgb(40, 40, 40)
const RED = combineRgb(200, 0, 0)
const AMBER = combineRgb(190, 130, 0)
const BLUE = combineRgb(0, 70, 140)
const GREEN = combineRgb(0, 120, 60)

const btn = (category, name, text, bgcolor, actions, feedbacks = [], size = '14') => ({
  type: 'button',
  category,
  name,
  style: { text, size, color: WHITE, bgcolor },
  steps: [{ down: actions, up: [] }],
  feedbacks,
})

// Zoom runs until told to stop, so these buttons drive on press and halt on release.
const holdBtn = (category, name, text, bgcolor, down, up) => ({
  type: 'button',
  category,
  name,
  style: { text, size: '14', color: WHITE, bgcolor },
  steps: [{ down, up }],
  feedbacks: [],
})

/**
 * Presets are built from the camera's own reported value lists, so the iris and
 * shutter banks match whatever the attached body actually offers.
 */
function buildPresets (cam) {
  const presets = {}
  const add = (id, p) => { presets[id] = p }

  // --- Record ---------------------------------------------------------------
  add('rec_toggle', btn('Record', 'Record toggle', 'REC', RED,
    [{ actionId: 'record', options: { mode: 'toggle' } }],
    [{ feedbackId: 'recording', options: {}, style: { bgcolor: RED, color: WHITE } }], '18'))
  add('rec_start', btn('Record', 'Record start', 'REC\\nSTART', GREY, [{ actionId: 'record', options: { mode: 'start' } }]))
  add('rec_stop', btn('Record', 'Record stop', 'REC\\nSTOP', GREY, [{ actionId: 'record', options: { mode: 'stop' } }]))

  // --- Iris: one button per f-stop the camera reports ------------------------
  const iris = cam.get(P.IRIS)
  for (const v of iris?.setValues || []) {
    add(`iris_${v}`, btn('Iris', fmt.iris(v), fmt.iris(v), BLUE,
      [{ actionId: 'setIris', options: { value: v } }],
      [{ feedbackId: 'propertyIs', options: { prop: String(P.IRIS), value: v }, style: { bgcolor: GREEN, color: WHITE } }]))
  }
  add('iris_open', btn('Iris', 'Iris open one stop', 'IRIS\\nOPEN', BLUE, [{ actionId: 'stepIris', options: { delta: -1 } }]))
  add('iris_close', btn('Iris', 'Iris close one stop', 'IRIS\\nCLOSE', BLUE, [{ actionId: 'stepIris', options: { delta: 1 } }]))
  add('iris_value', btn('Iris', 'Iris value display', 'IRIS\\n$(sony-pxw:iris)', GREY, []))

  // --- Shutter angle --------------------------------------------------------
  const shutter = cam.get(P.SHUTTER_ANGLE)
  for (const v of shutter?.setValues || []) {
    add(`shutter_${v}`, btn('Shutter', fmt.angle(v), fmt.angle(v), AMBER,
      [{ actionId: 'setShutterAngle', options: { value: v } }],
      [{ feedbackId: 'propertyIs', options: { prop: String(P.SHUTTER_ANGLE), value: v }, style: { bgcolor: GREEN, color: WHITE } }]))
  }
  add('shutter_value', btn('Shutter', 'Shutter display', 'SHUT\\n$(sony-pxw:shutter_angle)', GREY, []))

  // --- White balance --------------------------------------------------------
  for (const k of [3200, 4300, 5600, 6500, 7500]) {
    add(`wb_${k}`, btn('White balance', `${k}K`, `${k}K`, combineRgb(60, 60, 120),
      [{ actionId: 'setColourTemp', options: { value: k } }],
      [{ feedbackId: 'propertyIs', options: { prop: String(P.COLOUR_TEMP), value: k }, style: { bgcolor: GREEN, color: WHITE } }]))
  }
  add('wb_warmer', btn('White balance', 'Warmer 100K', 'WB\\n+100K', combineRgb(60, 60, 120), [{ actionId: 'nudgeColourTemp', options: { delta: 100 } }]))
  add('wb_cooler', btn('White balance', 'Cooler 100K', 'WB\\n-100K', combineRgb(60, 60, 120), [{ actionId: 'nudgeColourTemp', options: { delta: -100 } }]))
  add('wb_value', btn('White balance', 'Colour temp display', 'WB\\n$(sony-pxw:colour_temp)', GREY, []))

  // --- Focus ----------------------------------------------------------------
  add('focus_mode', btn('Focus', 'Focus mode toggle', 'FOCUS\\n$(sony-pxw:focus_mode)', combineRgb(90, 50, 0),
    [{ actionId: 'toggleProperty', options: { prop: String(P.FOCUS_MODE) } }]))
  add('focus_unit', btn('Focus', 'Distance unit m/ft', 'DIST\\n$(sony-pxw:focus_unit)', GREY,
    [{ actionId: 'toggleProperty', options: { prop: String(P.FOCUS_UNIT) } }]))
  add('focus_value', btn('Focus', 'Focus distance display', 'FOCUS\\n$(sony-pxw:focus_distance)', GREY, []))
  add('iris_mode', btn('Iris', 'Iris mode toggle', 'IRIS\\n$(sony-pxw:iris_mode)', combineRgb(90, 50, 0),
    [{ actionId: 'toggleProperty', options: { prop: String(P.IRIS_MODE) } }]))

  // --- Zoom -----------------------------------------------------------------
  for (const [label, dir] of [['TELE', 1], ['WIDE', -1]]) {
    for (const speed of [2, 5, 8]) {
      add(`zoom_${label.toLowerCase()}_${speed}`, holdBtn('Zoom', `Zoom ${label} speed ${speed}`,
        `ZOOM\\n${label}\\n${speed}`, combineRgb(0, 90, 90),
        [{ actionId: 'zoom', options: { direction: dir, speed } }],
        [{ actionId: 'zoomStop', options: {} }]))
    }
  }
  add('zoom_stop', btn('Zoom', 'Zoom stop', 'ZOOM\\nSTOP', combineRgb(0, 60, 60), [{ actionId: 'zoomStop', options: {} }]))
  add('zoom_value', btn('Zoom', 'Zoom display', 'ZOOM\\n$(sony-pxw:zoom)', GREY, []))

  // White balance switch position — confirmed writable on the Z300.
  for (const [label, v] of [['PRESET', 1], ['MEM A', 2], ['MEM B', 3]]) {
    add(`wb_switch_${v}`, btn('White balance', `WB switch ${label}`, `WB\\n${label}`, combineRgb(60, 60, 120),
      [{ actionId: 'setProperty', options: { prop: String(P.WB_SWITCH), value: v } }],
      [{ feedbackId: 'propertyIs', options: { prop: String(P.WB_SWITCH), value: v }, style: { bgcolor: GREEN, color: WHITE } }]))
  }

  // --- Menu navigation ------------------------------------------------------
  const keys = [['UP', C.KEY_UP], ['DOWN', C.KEY_DOWN], ['LEFT', C.KEY_LEFT], ['RIGHT', C.KEY_RIGHT]]
  for (const [label, code] of keys) {
    add(`key_${label.toLowerCase()}`, btn('Menu', `Key ${label}`, label, GREY, [{ actionId: 'sendKey', options: { code: String(code), value: 1 } }]))
  }

  // --- Status ---------------------------------------------------------------
  add('status_model', btn('Status', 'Model', '$(sony-pxw:model)', BLACK, [], [], '12'))
  add('status_battery', btn('Status', 'Battery', 'BATT\\n$(sony-pxw:battery)', BLACK, []))
  add('status_slot1', btn('Status', 'Slot 1', 'SLOT1\\n$(sony-pxw:slot1_time)', BLACK, []))
  add('status_slot2', btn('Status', 'Slot 2', 'SLOT2\\n$(sony-pxw:slot2_time)', BLACK, []))
  add('status_conn', btn('Status', 'Connection', 'CAM', BLACK, [],
    [{ feedbackId: 'connected', options: {}, style: { bgcolor: GREEN, color: WHITE } }]))

  return presets
}

module.exports = { buildPresets }
