// Generates z300-cc1.companionconfig (Companion 5.1 export, version 12) with:
//   page 1 laid out for the Yamaha CC121MK2 (LCD tiles, encoders, buttons),
//   one page per preset category (all module presets),
//   a trigger mapping the CC1 fader (custom:cc1_fader) onto the iris.
// Connects to the camera so the iris/shutter banks use its real value lists.
//   CAM=<ip> CAM_PASS=<pw> node tools/make-cc1-config.js
const fs = require('fs')
const crypto = require('crypto')
const { Camera } = require('../src/camera')
const { buildPresets } = require('../src/presets')

const INSTANCE_ID = 'o1MhpVAXi2rXHpD5QEYEh'   // the existing "PXW" connection
const LABEL = 'PXW'

const nid = () => crypto.randomBytes(16).toString('base64url').slice(0, 21)
const V = (value) => ({ value, isExpression: false })

const layer = {
  canvas: () => ({ id: 'canvas', name: 'Canvas', usage: 'auto', type: 'canvas', decoration: V('border'), showStatusIcons: V('default') }),
  box: (color) => ({ id: 'box0', name: 'Background', usage: 'auto', type: 'box', enabled: V(true), opacity: V(100),
    x: V(0), y: V(0), width: V(100), height: V(100), rotation: V(0), color: V(color),
    borderWidth: V(0), borderColor: V(0), borderPosition: V('inside'), cornerRadius: V(0) }),
  text: (text, fontsize, color) => ({ id: 'text0', name: 'Text', usage: 'auto', type: 'text', enabled: V(true), opacity: V(100),
    x: V(0), y: V(0), width: V(100), height: V(100), rotation: V(0), text: V(text), color: V(color),
    halign: V('center'), valign: V('center'), fontsize: V(fontsize), fontsizeAllowShrink: V(true),
    font: V('companion-sans'), outlineColor: V(4278190080), weight: V('normal'), styles: V([]) }),
}

const act = (definitionId, options) => ({
  id: nid(), definitionId, connectionId: INSTANCE_ID,
  options: Object.fromEntries(Object.entries(options).map(([k, v]) => [k, V(v)])),
  type: 'action', children: {},
})

function button ({ text, bg = 2829099, fg = 16777215, size = 14, down = [], up = [], rotateLeft, rotateRight }) {
  return {
    type: 'button-layered',
    style: { layers: [layer.canvas(), layer.box(bg), layer.text(text, size, fg)] },
    options: { stepProgression: 'auto', stepExpression: '', rotaryActions: !!(rotateLeft || rotateRight), canModifyStyleInApis: false, notes: '' },
    feedbacks: [],
    steps: { 0: { action_sets: { down, up, ...(rotateLeft ? { rotate_left: rotateLeft } : {}), ...(rotateRight ? { rotate_right: rotateRight } : {}) }, options: { runWhileHeld: [] } } },
    localVariables: [],
  }
}

const cam = new Camera({ host: process.env.CAM, user: process.env.CAM_USER || 'admin', pass: process.env.CAM_PASS, pollInterval: 2000 })
cam.once('props', () => {
  const pages = {}

  // ---------- page 1: CC121MK2 live layout ----------
  const c = {}
  const put = (row, col, b) => { (c[row] = c[row] || {})[col] = b }
  const GREY = 2829099, DARK = 0, BLUE = 1130636, RED = 13107200, TEAL = 23130, PURPLE = 3947630
  const lcd = (t) => button({ text: t, bg: DARK, size: 14 })

  put(0, 0, lcd(`REC\n$(${LABEL}:recording)`)); put(0, 1, lcd(`IRIS\n$(${LABEL}:iris)`))
  put(0, 2, lcd(`SHUT\n$(${LABEL}:shutter_angle)`)); put(0, 3, lcd(`CT\n$(${LABEL}:colour_temp)`))
  put(1, 0, lcd(`FOCUS\n$(${LABEL}:focus_distance)`)); put(1, 1, lcd(`ZOOM\n$(${LABEL}:zoom)`))
  put(1, 2, lcd(`WB SW\n$(${LABEL}:wb_switch)`)); put(1, 3, lcd(`SLOT1\n$(${LABEL}:slot1_time)`))
  put(2, 0, lcd(`R GAIN\n$(${LABEL}:wb_r_gain)`)); put(2, 1, lcd(`B GAIN\n$(${LABEL}:wb_b_gain)`))
  put(2, 2, lcd(`TINT\n$(${LABEL}:tint)`)); put(2, 3, lcd(`CT\n$(${LABEL}:colour_temp)`))

  // encoders (row 3): 1 = R gain, 2 = B gain, 3 = tint, 4 = colour temp
  const enc = (label, left, right) => button({ text: label, bg: PURPLE, size: 14, rotateLeft: [left], rotateRight: [right] })
  put(3, 0, enc('R -/+', act('nudgeWbGain', { channel: 'r', delta: -10 }), act('nudgeWbGain', { channel: 'r', delta: 10 })))
  put(3, 1, enc('B -/+', act('nudgeWbGain', { channel: 'b', delta: -10 }), act('nudgeWbGain', { channel: 'b', delta: 10 })))
  put(3, 2, enc('TINT', act('nudgeTint', { delta: -5 }), act('nudgeTint', { delta: 5 })))
  put(3, 3, enc('CT', act('nudgeColourTemp', { delta: -100 }), act('nudgeColourTemp', { delta: 100 })))
  // encoder 5: zoom rocker - wide anticlockwise, tele clockwise, auto-stop
  put(3, 4, enc('ZOOM', act('zoomNudge', { direction: -1, speed: 2 }), act('zoomNudge', { direction: 1, speed: 2 })))

  // physical buttons (rows 4-6)
  put(4, 0, button({ text: 'REC', bg: RED, size: 18, down: [act('record', { mode: 'toggle' })] }))
  put(4, 1, button({ text: 'ZOOM\nWIDE', bg: TEAL, down: [act('zoom', { direction: -1, speed: 5 })], up: [act('zoomStop', {})] }))
  put(4, 2, button({ text: 'ZOOM\nTELE', bg: TEAL, down: [act('zoom', { direction: 1, speed: 5 })], up: [act('zoomStop', {})] }))
  put(4, 3, button({ text: 'WB\nPRESET', bg: BLUE, down: [act('setWbSwitch', { value: 1 })] }))
  put(4, 4, button({ text: 'WB\nMEM A', bg: BLUE, down: [act('setWbSwitch', { value: 2 })] }))
  put(4, 5, button({ text: 'WB\nMEM B', bg: BLUE, down: [act('setWbSwitch', { value: 3 })] }))
  const stops = [[280, 'f/2.8'], [400, 'f/4.0'], [560, 'f/5.6'], [800, 'f/8.0']]
  stops.forEach(([v, l], i) => put(5, i, button({ text: l, bg: BLUE, down: [act('setIris', { value: v })] })))
  put(5, 4, button({ text: 'IRIS\nAUTO', bg: GREY, down: [act('setIrisMode', { mode: 1 })] }))
  put(5, 5, button({ text: 'IRIS\nMAN', bg: GREY, down: [act('setIrisMode', { mode: 2 })] }))
  put(6, 0, button({ text: '180°', bg: 12088064, down: [act('setShutterAngle', { value: 180000 })] }))
  put(6, 1, button({ text: '216°', bg: 12088064, down: [act('setShutterAngle', { value: 216000 })] }))
  put(6, 2, button({ text: '360°', bg: 12088064, down: [act('setShutterAngle', { value: 360000 })] }))
  put(6, 3, button({ text: 'SHUT\nAUTO', bg: GREY, down: [act('setShutterMode', { mode: 1 })] }))
  put(6, 4, button({ text: 'SHUT\nMAN', bg: GREY, down: [act('setShutterMode', { mode: 2 })] }))

  pages[1] = { id: nid(), name: 'Z300 CC1 Live', controls: c }

  // ---------- preset pages: everything the module generates ----------
  const presets = buildPresets(cam)
  const byCat = {}
  for (const p of Object.values(presets)) (byCat[p.category] = byCat[p.category] || []).push(p)
  let pageNo = 2
  for (const [cat, list] of Object.entries(byCat)) {
    const pc = {}
    list.forEach((p, i) => {
      const row = Math.floor(i / 6), col = i % 6
      if (row > 6) return
      const down = (p.steps?.[0]?.down || []).map(a => act(a.actionId, a.options || {}))
      const up = (p.steps?.[0]?.up || []).map(a => act(a.actionId, a.options || {}))
      const text = String(p.style.text || '').replace(/sony-pxw:/g, `${LABEL}:`)
      ;(pc[row] = pc[row] || {})[col] = button({ text, bg: p.style.bgcolor ?? 0, fg: p.style.color ?? 16777215, size: Number(p.style.size) || 14, down, up })
    })
    pages[pageNo] = { id: nid(), name: `Z300 ${cat}`, controls: pc }
    pageNo++
  }

  // ---------- trigger: CC1 fader -> iris ----------
  const trigger = {
    type: 'trigger',
    options: { name: 'CC1 fader -> Z300 iris', enabled: true, sortOrder: 1,
      notes: 'Fader 0-100 (custom:cc1_fader, published by the CC121MK2 surface) mapped onto the f-stop list the camera reports. 100 = wide open. The setIrisPercent action parses the variable and coalesces bursts.' },
    actions: [{ id: nid(), definitionId: 'setIrisPercent', connectionId: INSTANCE_ID,
      options: { percent: V('$(internal:custom_cc1_fader)') }, type: 'action', children: {} }],
    condition: [],
    events: [{ id: nid(), type: 'variable_changed', enabled: true, options: { variableId: 'custom:cc1_fader' } }],
    localVariables: [],
  }

  const out = {
    version: 12, type: 'full', companionBuild: '5.1.0',
    pages,
    triggers: { [nid()]: trigger }, triggerCollections: [],
    custom_variables: { cc1_fader: { description: 'CC121MK2 fader position (written by the surface)', defaultValue: '0', persistCurrentValue: false, sortOrder: 0 } },
    customVariablesCollections: [],
    instances: { [INSTANCE_ID]: { moduleInstanceType: 'connection', moduleId: 'sony-pxw', moduleVersionId: '0.4.0', updatePolicy: 'stable', sortOrder: 16, label: LABEL, isFirstInit: false, config: { user: 'admin', poll: 1000, host: process.env.CAM, pass: process.env.CAM_PASS }, secrets: {}, lastUpgradeIndex: -1, enabled: true } },
    connectionCollections: [],
  }
  fs.writeFileSync(__dirname + '/../z300-cc1.companionconfig', JSON.stringify(out))
  const nControls = Object.values(pages).reduce((n, p) => n + Object.values(p.controls).reduce((m, r) => m + Object.keys(r).length, 0), 0)
  console.log(`written: ${Object.keys(pages).length} pages, ${nControls} controls, 1 trigger`)
  for (const [n, p] of Object.entries(pages)) console.log(`  page ${n}: ${p.name}`)
  cam.stop(); process.exit(0)
})
cam.start()
