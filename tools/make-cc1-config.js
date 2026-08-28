// Generates z300-cc1.companionconfig (Companion 5.1 export, version 12).
//
//   Multiple cameras: set CAMS to a JSON array, else it uses CAM / CAM_PASS.
//     CAMS='[{"label":"CAM1","host":"192.168.0.10","pass":"..."},
//            {"label":"CAM2","host":"192.168.0.11","pass":"..."}]' node tools/make-cc1-config.js
//
// Layout:
//   - One live page per camera (pages 1..N), each with < / > page-nav that also
//     selects that camera, so paging through the camera pages makes the CC1
//     fader (and every tile) follow the camera you are looking at.
//   - Then the full preset category pages, per camera.
//   - One fader trigger per camera, gated on the selected_camera variable, so
//     the physical fader only drives the camera currently selected.
const fs = require('fs')
const crypto = require('crypto')
const { Camera } = require('../src/camera')
const { buildPresets } = require('../src/presets')

const CAMERAS = process.env.CAMS
  ? JSON.parse(process.env.CAMS)
  : [{ label: 'PXW', host: process.env.CAM, pass: process.env.CAM_PASS }]

const nid = () => crypto.randomBytes(16).toString('base64url').slice(0, 21)
const V = (value) => ({ value, isExpression: false })
const X = (value) => ({ value, isExpression: true })   // expression option

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

const internal = (definitionId, options) => ({
  id: nid(), definitionId, connectionId: 'internal',
  options: Object.fromEntries(Object.entries(options).map(([k, v]) => [k, v.value !== undefined ? v : V(v)])),
  type: 'action', children: {},
})
const act = (connectionId, definitionId, options) => ({
  id: nid(), definitionId, connectionId,
  options: Object.fromEntries(Object.entries(options).map(([k, v]) => [k, V(v)])),
  type: 'action', children: {},
})

function button ({ text, bg = 2829099, fg = 16777215, size = 14, down = [], up = [], feedbacks = [] }) {
  return {
    type: 'button-layered',
    style: { layers: [layer.canvas(), layer.box(bg), layer.text(text, size, fg)] },
    options: { stepProgression: 'auto', stepExpression: '', rotaryActions: false, canModifyStyleInApis: false, notes: '' },
    feedbacks,
    steps: { 0: { action_sets: { down, up }, options: { runWhileHeld: [] } } },
    localVariables: [],
  }
}
function encoder ({ text, bg, left, right }) {
  const b = button({ text, bg })
  b.options.rotaryActions = true
  b.steps[0].action_sets.rotate_left = [left]
  b.steps[0].action_sets.rotate_right = [right]
  return b
}

const GREY = 2829099, DARK = 0, BLUE = 1130636, RED = 13107200, TEAL = 23130, PURPLE = 3947630, GREEN = 30720

const cam0 = new Camera({ host: CAMERAS[0].host, user: process.env.CAM_USER || 'admin', pass: CAMERAS[0].pass, pollInterval: 2000 })
cam0.once('props', () => {
  const presets = buildPresets(cam0)
  const N = CAMERAS.length

  // Ordered page list: N live pages first, then per-camera preset pages.
  const pageList = []
  CAMERAS.forEach((c, i) => pageList.push({ kind: 'live', camIdx: i, name: `${c.label} Live` }))
  const byCat = {}
  for (const p of Object.values(presets)) (byCat[p.category] = byCat[p.category] || []).push(p)
  CAMERAS.forEach((c, i) => {
    for (const [catName, list] of Object.entries(byCat)) pageList.push({ kind: 'preset', camIdx: i, cat: catName, list, name: `${c.label} ${catName}` })
  })
  const pageNum = new Map(pageList.map((p, idx) => [p, idx + 1]))
  const liveNumberOf = i => pageNum.get(pageList.find(p => p.kind === 'live' && p.camIdx === i))

  // < / > : move a page. If the destination page belongs to a camera, also
  // select that camera so the fader and tiles follow.
  function navButtons (thisNum) {
    const target = delta => {
      const n = Math.min(pageList.length, Math.max(1, thisNum + delta))
      const dest = pageList[n - 1]
      const acts = [internal('set_page', { surfaceId: V('self'), page: V(String(n)) })]
      if (dest.kind === 'live') acts.push(internal('custom_variable_set_value', { name: V('selected_camera'), create: V(true), value: V(String(dest.camIdx + 1)) }))
      return acts
    }
    return {
      prev: button({ text: '◀\\nPREV', bg: GREY, down: target(-1) }),
      next: button({ text: 'NEXT\\n▶', bg: GREY, down: target(1) }),
    }
  }

  const pages = {}

  // ---- live page per camera ----
  CAMERAS.forEach((cfg, ci) => {
    const num = liveNumberOf(ci)
    const conn = `conn:${ci}`               // resolved to a real connection id below
    const L = cfg.label
    const c = {}
    const put = (r, col, b) => { (c[r] = c[r] || {})[col] = b }
    const lcd = t => button({ text: t, bg: DARK })
    const camSel = { feedbackId: 'check_expression', connectionId: 'internal', options: { expression: X(`$(internal:custom_selected_camera) == ${ci + 1}`) }, style: { bgcolor: GREEN, color: 16777215 } }

    // row 0-2: status tiles (follow this camera)
    put(0, 0, button({ text: `${L}\\n$(${L}:recording)`, bg: DARK, feedbacks: [{ feedbackId: 'recording', connectionId: conn, options: {}, style: { bgcolor: RED, color: 16777215 } }] }))
    put(0, 1, lcd(`IRIS\\n$(${L}:iris)`)); put(0, 2, lcd(`SHUT\\n$(${L}:shutter_angle)`)); put(0, 3, lcd(`CT\\n$(${L}:colour_temp)`))
    put(1, 0, lcd(`FOCUS\\n$(${L}:focus_distance)`)); put(1, 1, lcd(`ZOOM\\n$(${L}:zoom)`)); put(1, 2, lcd(`WB SW\\n$(${L}:wb_switch)`)); put(1, 3, lcd(`SLOT1\\n$(${L}:slot1_time)`))
    put(2, 0, lcd(`R GAIN\\n$(${L}:wb_r_gain)`)); put(2, 1, lcd(`B GAIN\\n$(${L}:wb_b_gain)`)); put(2, 2, lcd(`TINT\\n$(${L}:tint)`))
    put(2, 3, button({ text: `${L}\\nSELECTED`, bg: DARK, feedbacks: [camSel] }))

    // row 3: encoders
    put(3, 0, encoder({ text: 'R -/+', bg: PURPLE, left: act(conn, 'nudgeWbGain', { channel: 'r', delta: -10 }), right: act(conn, 'nudgeWbGain', { channel: 'r', delta: 10 }) }))
    put(3, 1, encoder({ text: 'B -/+', bg: PURPLE, left: act(conn, 'nudgeWbGain', { channel: 'b', delta: -10 }), right: act(conn, 'nudgeWbGain', { channel: 'b', delta: 10 }) }))
    put(3, 2, encoder({ text: 'TINT', bg: PURPLE, left: act(conn, 'nudgeTint', { delta: -5 }), right: act(conn, 'nudgeTint', { delta: 5 }) }))
    put(3, 3, encoder({ text: 'CT', bg: PURPLE, left: act(conn, 'nudgeColourTemp', { delta: -100 }), right: act(conn, 'nudgeColourTemp', { delta: 100 }) }))
    put(3, 4, encoder({ text: 'ZOOM', bg: TEAL, left: act(conn, 'zoomNudge', { direction: -1, speed: 2 }), right: act(conn, 'zoomNudge', { direction: 1, speed: 2 }) }))
    put(3, 5, encoder({ text: 'ND', bg: BLUE, left: act(conn, 'stepNdVariable', { delta: -1 }), right: act(conn, 'stepNdVariable', { delta: 1 }) }))

    // row 4: rec + zoom + WB switch
    put(4, 0, button({ text: 'REC', bg: RED, size: 18, down: [act(conn, 'record', { mode: 'toggle' })], feedbacks: [{ feedbackId: 'recording', connectionId: conn, options: {}, style: { bgcolor: RED, color: 16777215 } }] }))
    put(4, 1, button({ text: 'ZOOM\\nWIDE', bg: TEAL, down: [act(conn, 'zoom', { direction: -1, speed: 5 })], up: [act(conn, 'zoomStop', {})] }))
    put(4, 2, button({ text: 'ZOOM\\nTELE', bg: TEAL, down: [act(conn, 'zoom', { direction: 1, speed: 5 })], up: [act(conn, 'zoomStop', {})] }))
    put(4, 3, button({ text: 'WB\\nPRESET', bg: BLUE, down: [act(conn, 'setWbSwitch', { value: 1 })] }))
    put(4, 4, button({ text: 'WB\\nMEM A', bg: BLUE, down: [act(conn, 'setWbSwitch', { value: 2 })] }))
    put(4, 5, button({ text: 'WB\\nMEM B', bg: BLUE, down: [act(conn, 'setWbSwitch', { value: 3 })] }))

    // row 5: iris stops + iris mode
    ;[[280, 'f/2.8'], [400, 'f/4.0'], [560, 'f/5.6'], [800, 'f/8.0']].forEach(([v, l], i) => put(5, i, button({ text: l, bg: BLUE, down: [act(conn, 'setIris', { value: v })] })))
    put(5, 4, button({ text: 'IRIS\\nAUTO', bg: GREY, down: [act(conn, 'setIrisMode', { mode: 1 })] }))
    put(5, 5, button({ text: 'IRIS\\nMAN', bg: GREY, down: [act(conn, 'setIrisMode', { mode: 2 })] }))

    // row 6: shutter + nav
    put(6, 0, button({ text: '180°', bg: 12088064, down: [act(conn, 'setShutterAngle', { value: 180000 })] }))
    put(6, 1, button({ text: '216°', bg: 12088064, down: [act(conn, 'setShutterAngle', { value: 216000 })] }))
    put(6, 2, button({ text: '360°', bg: 12088064, down: [act(conn, 'setShutterAngle', { value: 360000 })] }))
    put(6, 3, button({ text: 'SHUT\\nMAN', bg: GREY, down: [act(conn, 'setShutterMode', { mode: 2 })] }))
    const nav = navButtons(num)
    put(6, 4, nav.prev); put(6, 5, nav.next)

    pages[num] = { id: nid(), name: `${L} Live`, controls: c, _conn: conn }
  })

  // ---- preset category pages, per camera ----
  for (const pg of pageList.filter(p => p.kind === 'preset')) {
    const num = pageNum.get(pg)
    const conn = `conn:${pg.camIdx}`, L = CAMERAS[pg.camIdx].label
    const pc = {}
    pg.list.forEach((p, i) => {
      const row = Math.floor(i / 6), col = i % 6
      if (row > 5) return                                   // leave row 6 for nav
      const down = (p.steps?.[0]?.down || []).map(a => act(conn, a.actionId, a.options || {}))
      const up = (p.steps?.[0]?.up || []).map(a => act(conn, a.actionId, a.options || {}))
      const text = String(p.style.text || '').replace(/sony-pxw:/g, `${L}:`)
      ;(pc[row] = pc[row] || {})[col] = button({ text, bg: p.style.bgcolor ?? 0, fg: p.style.color ?? 16777215, size: Number(p.style.size) || 14, down, up })
    })
    const nav = navButtons(num)
    ;(pc[6] = pc[6] || {})[4] = nav.prev; pc[6][5] = nav.next
    pages[num] = { id: nid(), name: pg.name, controls: pc, _conn: conn }
  }

  // ---- connections + resolve conn:i placeholders ----
  const connIds = CAMERAS.map(() => nid())
  const instances = {}
  CAMERAS.forEach((cfg, i) => {
    instances[connIds[i]] = { moduleInstanceType: 'connection', moduleId: 'sony-pxw', moduleVersionId: '0.5.2', updatePolicy: 'stable', sortOrder: 20 + i, label: cfg.label, isFirstInit: false, config: { user: 'admin', poll: 1000, host: cfg.host, pass: cfg.pass }, secrets: {}, lastUpgradeIndex: -1, enabled: true }
  })
  // walk every action/feedback and swap conn:i -> real id
  const swap = s => JSON.parse(JSON.stringify(s).replace(/"conn:(\d+)"/g, (_, i) => `"${connIds[+i]}"`))
  for (const k of Object.keys(pages)) { delete pages[k]._conn; pages[k] = swap(pages[k]) }

  // ---- one fader trigger per camera, gated on selected_camera ----
  const triggers = {}
  CAMERAS.forEach((cfg, i) => {
    triggers[nid()] = {
      type: 'trigger',
      options: { name: `Fader -> ${cfg.label} iris`, enabled: true, sortOrder: i,
        notes: `Drives ${cfg.label} iris from the CC121MK2 fader (custom:cc1_fader), only while selected_camera == ${i + 1}. Switch cameras with the < / > buttons on the live pages.` },
      actions: [{ id: nid(), definitionId: 'setIrisPercent', connectionId: connIds[i], options: { percent: V('$(internal:custom_cc1_fader)') }, type: 'action', children: {} }],
      condition: [{ id: nid(), type: 'feedback', definitionId: 'check_expression', connectionId: 'internal', options: { expression: X(`$(internal:custom_selected_camera) == ${i + 1}`) } }],
      events: [{ id: nid(), type: 'variable_changed', enabled: true, options: { variableId: 'custom:cc1_fader' } }],
      localVariables: [],
    }
  })

  const out = {
    version: 12, type: 'full', companionBuild: '5.1.0',
    pages,
    triggers, triggerCollections: [],
    custom_variables: {
      cc1_fader: { description: 'CC121MK2 fader position (written by the surface)', defaultValue: '0', persistCurrentValue: false, sortOrder: 0 },
      selected_camera: { description: 'Which camera the fader controls (1..N)', defaultValue: '1', persistCurrentValue: true, sortOrder: 1 },
    },
    customVariablesCollections: [],
    instances,
    connectionCollections: [],
  }
  fs.writeFileSync(__dirname + '/../z300-cc1.companionconfig', JSON.stringify(out))
  const nControls = Object.values(pages).reduce((n, p) => n + Object.values(p.controls).reduce((m, r) => m + Object.keys(r).length, 0), 0)
  console.log(`written: ${CAMERAS.length} camera(s), ${Object.keys(pages).length} pages, ${nControls} controls, ${Object.keys(triggers).length} fader triggers`)
  cam0.stop(); process.exit(0)
})
cam0.start()
