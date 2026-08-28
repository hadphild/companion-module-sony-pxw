'use strict'
const { InstanceBase, InstanceStatus, Regex } = require('@companion-module/base')
const { Camera } = require('./camera')
const { buildPresets } = require('./presets')
const { P, C, fmt, AVAILABILITY } = require('./props')

const VARS = [
  ['model', 'Camera model'], ['iris', 'Iris'], ['iris_mode', 'Iris mode'],
  ['shutter_angle', 'Shutter angle'], ['colour_temp', 'Colour temperature'],
  ['focus_distance', 'Focus distance'], ['focus_mode', 'Focus mode'], ['focus_unit', 'Focus distance unit'],
  ['zoom', 'Zoom (focal length)'], ['battery', 'Battery'],
  ['slot1_status', 'Slot 1 status'], ['slot1_time', 'Slot 1 remaining'],
  ['slot2_status', 'Slot 2 status'], ['slot2_time', 'Slot 2 remaining'],
  ['recording', 'Recording (Yes/No)'],
  ['tint', 'Tint'], ['wb_switch', 'WB switch position'],
  ['wb_r_gain', 'WB red gain'], ['wb_b_gain', 'WB blue gain'],
  ['ai_focus', 'Subject Recognition AF mode'],
  ['nd_on', 'ND filter on/off'], ['nd_preset', 'ND preset position'],
  ['offset_white', 'Offset White on/off'], ['offset_amount', 'Offset White amount'],
  ['auto_framing', 'AI Auto Framing on/off'], ['tracking_mode', 'Tracking start mode'],
  ['iris_state', 'Iris: camera-reported state (Off/Locked/Active)'],
  ['focus_state', 'Focus: camera-reported state'],
  ['wb_state', 'White balance: camera-reported state'],
]

class PxwInstance extends InstanceBase {
  async init (config) {
    this.config = config
    this.setVariableDefinitions(VARS.map(([variableId, name]) => ({ variableId, name })))
    this.updateStatus(InstanceStatus.Connecting)
    this.connect()
  }

  connect () {
    this.cam?.stop()
    if (!this.config.host) return this.updateStatus(InstanceStatus.BadConfig, 'No camera address')
    this.cam = new Camera({
      host: this.config.host,
      user: this.config.user || 'admin',
      pass: this.config.pass,
      pollInterval: Number(this.config.poll) || 1000,
    })
    this.cam.on('up', model => {
      this.updateStatus(InstanceStatus.Ok)
      this.log('info', `connected to ${model}`)
      this.setVariableValues({ model })
    })
    this.cam.on('down', reason => {
      this.updateStatus(InstanceStatus.ConnectionFailure, reason)
      this.log('warn', `camera connection lost: ${reason}`)
      this.checkFeedbacks()
    })
    this.cam.on('props', () => {
      this.updateVariables()
      this.checkFeedbacks()
      if (!this.presetsBuilt) { this.setPresetDefinitions(buildPresets(this.cam)); this.presetsBuilt = true }
    })
    this.setActionDefinitions(this.actions())
    this.setFeedbackDefinitions(this.feedbacks())
    this.cam.start()
  }

  updateVariables () {
    const c = this.cam
    const unit = c.value(P.FOCUS_UNIT) === 2 ? 'feet' : 'metres'
    this.setVariableValues({
      iris: fmt.iris(c.value(P.IRIS)),
      iris_mode: fmt.onOff(c.value(P.IRIS_MODE)),
      shutter_angle: fmt.angle(c.value(P.SHUTTER_ANGLE)),
      colour_temp: fmt.kelvin(this.pendingValue(P.COLOUR_TEMP) ?? c.value(P.COLOUR_TEMP)),
      focus_distance: unit === 'feet' ? fmt.feet(c.value(P.FOCUS_FT)) : fmt.metres(c.value(P.FOCUS_M)),
      focus_mode: fmt.onOff(c.value(P.FOCUS_MODE)),
      focus_unit: unit === 'feet' ? 'ft' : 'm',
      zoom: String(c.value(P.ZOOM) ?? '—'),
      battery: fmt.percent(c.value(P.BATTERY)),
      slot1_status: fmt.slot(c.value(P.SLOT1_STATUS)),
      slot1_time: fmt.minutes(c.value(P.SLOT1_TIME)),
      slot2_status: fmt.slot(c.value(P.SLOT2_STATUS)),
      slot2_time: fmt.minutes(c.value(P.SLOT2_TIME)),
      recording: c.value(P.REC_STATE) === 0 ? 'Yes' : 'No',
      tint: String(this.pendingValue(P.TINT) ?? c.value(P.TINT) ?? '—'),
      wb_r_gain: String(this.pendingValue(P.WB_R_GAIN) ?? c.value(P.WB_R_GAIN) ?? '—'),
      wb_b_gain: String(this.pendingValue(P.WB_B_GAIN) ?? c.value(P.WB_B_GAIN) ?? '—'),
      ai_focus: c.strings?.[21]?.[c.value(P.AI_AF_STATE)] ?? String(c.value(P.AI_AF_STATE) ?? '—'),
      nd_on: c.value(P.ND_ON) === 2 ? 'On' : c.value(P.ND_ON) === 1 ? 'Off' : '—',
      nd_preset: ({ 3: 'Clear', 4: '1', 5: '2', 1: '3', 2: 'Auto' }[c.value(P.ND_PRESET)] ?? String(c.value(P.ND_PRESET) ?? '—')),
      offset_white: c.value(P.OFFSET_WHITE) === 2 ? 'On' : c.value(P.OFFSET_WHITE) === 1 ? 'Off' : '—',
      offset_amount: String(this.pendingValue(P.OFFSET_AMOUNT) ?? c.value(P.OFFSET_AMOUNT) ?? '—'),
      auto_framing: c.value(P.AUTO_FRAMING) === 2 ? 'On' : c.value(P.AUTO_FRAMING) === 1 ? 'Off' : '—',
      tracking_mode: String(c.value(P.TRACKING_MODE) ?? '—'),
      wb_switch: { 1: 'PRESET', 2: 'Memory A', 3: 'Memory B' }[c.value(P.WB_SWITCH)] ?? '—',
      iris_state: AVAILABILITY[c.availability(P.IRIS)],
      focus_state: AVAILABILITY[c.availability(P.FOCUS_M)],
      wb_state: AVAILABILITY[c.availability(P.COLOUR_TEMP)],
    })
  }

  /** RCP-style nudge: accumulate on a local shadow target so rapid encoder
   *  ticks never read a stale polled value (which loses ticks), write
   *  coalesced (only the latest target once the in-flight PTP op finishes),
   *  and display the target optimistically until the poll catches up. */
  async nudgeProp (prop, delta, min, max) {
    this._nudge = this._nudge || {}
    const n = this._nudge[prop] = this._nudge[prop] || {}
    const live = n.busy || Date.now() < (n.hold || 0)
    const base = live ? n.target : this.cam.value(prop)
    if (base === undefined) return
    n.target = Math.min(max, Math.max(min, base + delta))
    n.hold = Date.now() + 1500
    this.updateVariables()                      // optimistic display
    if (n.busy) return
    n.busy = true
    try {
      let sent
      while (sent !== n.target) { sent = n.target; await this.cam.setProp(prop, sent) }
    } catch (e) { this.log('error', `nudge 0x${prop.toString(16)}: ${e.message}`) } finally { n.busy = false }
  }

  /** Encoder-driven zoom: each tick (re)drives the lens and re-arms a stop
   *  timer, so turning feels like a rocker - spin faster to zoom faster, stop
   *  turning and the lens stops. Sends coalesce like the property nudges. */
  zoomNudge (direction, base) {
    const now = Date.now()
    this._zoomTicks = (this._zoomTicks || []).filter(t => now - t < 500)
    this._zoomTicks.push(now)
    const speed = Math.min(8, Number(base) + Math.floor(this._zoomTicks.length / 3))
    this._zoomWant = direction * speed
    clearTimeout(this._zoomStopTimer)
    this._zoomStopTimer = setTimeout(() => { this._zoomWant = 0; this._zoomPump() }, 300)
    this._zoomPump()
  }

  async _zoomPump () {
    if (this._zoomBusy) return
    this._zoomBusy = true
    try {
      let sent
      while (sent !== this._zoomWant) { sent = this._zoomWant; await this.cam.control(C.ZOOM_OP, sent, 1) }
    } catch (e) { this.log('error', `zoom: ${e.message}`) } finally { this._zoomBusy = false }
  }

  /** The optimistic value while a nudge is in flight, else undefined. */
  pendingValue (prop) {
    const n = this._nudge?.[prop]
    return n && (n.busy || Date.now() < (n.hold || 0)) ? n.target : undefined
  }

  /** Remote iris needs the direct-menu iris mode on Manual (and the physical
   *  IRIS switch on AUTO - only then is the mode property writable at all). */
  async ensureIrisManual () {
    if (this.cam.value(P.IRIS_MODE_SETTING) === 2) return
    await this.cam.setProp(P.IRIS_MODE_SETTING, 2)
    await new Promise(r => setTimeout(r, 800))
  }

  /** Same gate as iris: shutter values only stick with the mode on Manual
   *  (and the physical SHUTTER switch ON). */
  async ensureShutterManual () {
    if (this.cam.value(P.SHUTTER_MODE) === 2) return
    await this.cam.setProp(P.SHUTTER_MODE, 2)
    await new Promise(r => setTimeout(r, 800))
  }

  /** Warn once when the camera silently ignores a write — the usual cause is
   *  [Network] > Wired LAN > Camera Remote Control being set to Disable. */
  async guardedSet (code, value) {
    const before = this.cam.value(code)
    try { await this.cam.setProp(code, value) } catch (e) { return this.log('error', e.message) }
    setTimeout(() => {
      if (this.cam.value(code) === before && before !== value) {
        this.log('warn', `camera ignored the change to 0x${code.toString(16)} — check [Network] > Wired LAN > [Camera Remote Control] is Enabled, and that the relevant switch is in manual`)
      }
    }, 1500)
  }

  actions () {
    const cam = () => this.cam
    return {
      record: {
        name: 'Record',
        options: [{ id: 'mode', type: 'dropdown', label: 'Mode', default: 'toggle',
          choices: [{ id: 'toggle', label: 'Toggle' }, { id: 'start', label: 'Start' }, { id: 'stop', label: 'Stop' }] }],
        // CONFIRMED on a Z300: 0xD2C8 as u16, 2 = start, 1 = stop. Latching, not
        // momentary — a start stays recording until an explicit stop is sent.
        // Needs recordable media in a slot; with none it is accepted and ignored.
        callback: async ({ options }) => {
          const recording = cam().value(P.REC_STATE) === 0
          const want = options.mode === 'toggle' ? !recording : options.mode === 'start'
          await cam().control(C.MOVIE_REC, want ? 2 : 1)
        },
      },
      setIris: {
        name: 'Iris: set f-stop',
        options: [{ id: 'value', type: 'number', label: 'f-number x100 (800 = f/8.0)', default: 560, min: 100, max: 3200 }],
        callback: async ({ options }) => {
          await this.ensureIrisManual()
          await this.guardedSet(P.IRIS, Number(options.value))
        },
      },
      stepIris: {
        name: 'Iris: step',
        options: [{ id: 'delta', type: 'number', label: 'Steps (negative opens up)', default: 1, min: -10, max: 10 }],
        callback: async ({ options }) => {
          try { await this.ensureIrisManual(); await cam().step(P.IRIS, Number(options.delta)) } catch (e) { this.log('error', e.message) }
        },
      },
      setIrisPercent: {
        name: 'Iris: set from percent (fader)',
        options: [{ id: 'percent', type: 'textinput', label: 'Percent 0-100 (100 = wide open); variables allowed', default: '50', useVariables: true }],
        // Maps percent onto the f-stop list the camera reports. Coalesces
        // bursts: a moving fader fires many events, but only the latest
        // target is sent once the in-flight PTP write finishes.
        callback: async (event, context) => {
          const txt = await context.parseVariablesInString(String(event.options.percent))
          const pct = Math.max(0, Math.min(100, parseFloat(txt)))
          if (isNaN(pct)) return
          const p = cam().get(P.IRIS)
          const stops = (p?.setValues || []).filter(v => v < 4000).sort((a, b) => a - b)
          if (!stops.length) return
          this._faderTarget = stops[Math.round((1 - pct / 100) * (stops.length - 1))]
          if (this._faderBusy) return
          this._faderBusy = true
          try {
            await this.ensureIrisManual()
            while (this._faderSent !== this._faderTarget) {
              const t = this._faderTarget
              await cam().setProp(P.IRIS, t)
              this._faderSent = t
            }
          } catch (e) { this.log('error', `iris fader: ${e.message}`) } finally { this._faderBusy = false }
        },
      },
      setIrisMode: {
        name: 'Iris: auto / manual',
        options: [{ id: 'mode', type: 'dropdown', label: 'Mode', default: 2,
          choices: [{ id: 1, label: 'Auto' }, { id: 2, label: 'Manual' }] }],
        callback: async ({ options }) => this.guardedSet(P.IRIS_MODE_SETTING, Number(options.mode)),
      },
      setShutterAngle: {
        name: 'Shutter: set angle',
        options: [{ id: 'value', type: 'number', label: 'Degrees x1000 (180000 = 180°)', default: 180000, min: 1000, max: 360000 }],
        callback: async ({ options }) => {
          await this.ensureShutterManual()
          await this.guardedSet(P.SHUTTER_ANGLE, Number(options.value))
        },
      },
      setShutterMode: {
        name: 'Shutter: auto / manual',
        options: [{ id: 'mode', type: 'dropdown', label: 'Mode', default: 2,
          choices: [{ id: 1, label: 'Auto' }, { id: 2, label: 'Manual' }] }],
        callback: async ({ options }) => this.guardedSet(P.SHUTTER_MODE, Number(options.mode)),
      },
      setColourTemp: {
        name: 'White balance: set colour temperature',
        options: [{ id: 'value', type: 'number', label: 'Kelvin', default: 5600, min: 2000, max: 15000 }],
        callback: async ({ options }) => this.guardedSet(P.COLOUR_TEMP, Number(options.value)),
      },
      nudgeColourTemp: {
        name: 'White balance: nudge colour temperature',
        options: [{ id: 'delta', type: 'number', label: 'Kelvin change', default: 100, min: -2000, max: 2000 }],
        callback: async ({ options }) => this.nudgeProp(P.COLOUR_TEMP, Number(options.delta), 2000, 15000),
      },
      setOffsetWhite: {
        name: 'Offset White on / off',
        options: [{ id: 'state', type: 'dropdown', label: 'Offset White', default: 2,
          choices: [{ id: 1, label: 'Off' }, { id: 2, label: 'On' }] }],
        callback: async ({ options }) => this.guardedSet(P.OFFSET_WHITE, Number(options.state)),
      },
      nudgeOffsetWhite: {
        name: 'Offset White: nudge amount',
        options: [{ id: 'delta', type: 'number', label: 'Change (-99..99)', default: 1, min: -20, max: 20 }],
        callback: async ({ options }) => this.nudgeProp(P.OFFSET_AMOUNT, Number(options.delta), -99, 99),
      },
      setTint: {
        name: 'White balance: set tint',
        options: [{ id: 'value', type: 'number', label: 'Tint (-99 to 99)', default: 0, min: -99, max: 99 }],
        callback: async ({ options }) => this.guardedSet(P.TINT, Number(options.value)),
      },
      nudgeTint: {
        name: 'White balance: nudge tint',
        options: [{ id: 'delta', type: 'number', label: 'Change', default: 5, min: -50, max: 50 }],
        callback: async ({ options }) => this.nudgeProp(P.TINT, Number(options.delta), -99, 99),
      },
      setWbGain: {
        name: 'White balance: set R/B gain',
        options: [
          { id: 'channel', type: 'dropdown', label: 'Channel', default: 'r',
            choices: [{ id: 'r', label: 'Red' }, { id: 'b', label: 'Blue' }] },
          { id: 'value', type: 'number', label: 'Gain (-990 to 990)', default: 0, min: -990, max: 990 },
        ],
        callback: async ({ options }) => this.guardedSet(options.channel === 'r' ? P.WB_R_GAIN : P.WB_B_GAIN, Number(options.value)),
      },
      setAutoFraming: {
        name: 'AI Auto Framing on / off',
        options: [{ id: 'state', type: 'dropdown', label: 'Auto Framing', default: 2,
          choices: [{ id: 1, label: 'Off' }, { id: 2, label: 'On' }] }],
        callback: async ({ options }) => this.guardedSet(P.AUTO_FRAMING, Number(options.state)),
      },
      setTrackingMode: {
        name: 'Auto Framing: tracking start mode',
        options: [{ id: 'mode', type: 'number', label: 'Mode (1-3)', default: 1, min: 1, max: 3 }],
        callback: async ({ options }) => this.guardedSet(P.TRACKING_MODE, Number(options.mode)),
      },
      aiFocusCycle: {
        name: 'AI focus: cycle mode (Off / Human Only / Human Priority)',
        options: [],
        callback: async () => {
          await cam().control(C.AI_AF_CYCLE, 2)
          setTimeout(() => cam().control(C.AI_AF_CYCLE, 1).catch(() => {}), 300)
        },
      },
      nudgeWbGain: {
        name: 'White balance: nudge R/B gain',
        options: [
          { id: 'channel', type: 'dropdown', label: 'Channel', default: 'r',
            choices: [{ id: 'r', label: 'Red' }, { id: 'b', label: 'Blue' }] },
          { id: 'delta', type: 'number', label: 'Change', default: 10, min: -200, max: 200 },
        ],
        callback: async ({ options }) => this.nudgeProp(options.channel === 'r' ? P.WB_R_GAIN : P.WB_B_GAIN, Number(options.delta), -990, 990),
      },
      setNd: {
        name: 'ND filter on / off',
        options: [{ id: 'state', type: 'dropdown', label: 'ND filter', default: 2,
          choices: [{ id: 1, label: 'Off (Clear)' }, { id: 2, label: 'On' }] }],
        callback: async ({ options }) => this.guardedSet(P.ND_ON, Number(options.state)),
      },
      stepNdVariable: {
        name: 'ND variable: step density (encoder)',
        options: [{ id: 'delta', type: 'number', label: 'Steps (+ denser, - lighter)', default: 1, min: -20, max: 20 }],
        callback: async ({ options }) => {
          const p = cam().get(P.ND_VARIABLE)
          if (!p?.setValues?.length) return
          let i = p.setValues.indexOf(p.current)
          if (i < 0) i = 0
          const next = p.setValues[Math.min(p.setValues.length - 1, Math.max(0, i + Number(options.delta)))]
          await this.guardedSet(P.ND_VARIABLE, next)
        },
      },
      setWbSwitch: {
        name: 'White balance: switch position',
        options: [{ id: 'value', type: 'dropdown', label: 'Position', default: 1,
          choices: [{ id: 1, label: 'PRESET' }, { id: 2, label: 'Memory A' }, { id: 3, label: 'Memory B' }] }],
        callback: async ({ options }) => this.guardedSet(P.WB_SWITCH, Number(options.value)),
      },
      toggleProperty: {
        name: 'Toggle a two-state property',
        options: [{ id: 'prop', type: 'textinput', label: 'Property code (decimal)', default: String(P.FOCUS_MODE) }],
        callback: async ({ options }) => {
          const code = Number(options.prop)
          const p = cam().get(code)
          if (!p?.setValues?.length) return this.log('error', `property ${code} has no value list`)
          const next = p.setValues.find(v => v !== p.current) ?? p.current
          await this.guardedSet(code, next)
        },
      },
      zoom: {
        name: 'Zoom (runs until stopped)',
        options: [
          { id: 'direction', type: 'dropdown', label: 'Direction', default: 1,
            choices: [{ id: 1, label: 'Tele (in)' }, { id: -1, label: 'Wide (out)' }] },
          { id: 'speed', type: 'number', label: 'Speed (1 slow — 8 fast)', default: 5, min: 1, max: 8 },
        ],
        // i8: sign is direction, magnitude is speed.
        callback: async ({ options }) => cam().control(C.ZOOM_OP, Number(options.direction) * Number(options.speed), 1),
      },
      zoomNudge: {
        name: 'Zoom: encoder tick (auto-stops when turning stops)',
        options: [
          { id: 'direction', type: 'dropdown', label: 'Direction', default: 1,
            choices: [{ id: 1, label: 'Tele (in)' }, { id: -1, label: 'Wide (out)' }] },
          { id: 'speed', type: 'number', label: 'Base speed (accelerates as you spin faster)', default: 2, min: 1, max: 8 },
        ],
        callback: async ({ options }) => this.zoomNudge(Number(options.direction), Number(options.speed)),
      },
      zoomStop: {
        name: 'Zoom stop',
        options: [],
        callback: async () => cam().control(C.ZOOM_OP, 0, 1),
      },
      pressControl: {
        name: 'Press a control opcode (2 then 1, like a button push) - for identification',
        options: [{ id: 'code', type: 'textinput', label: 'Control opcode (decimal)', default: '' }],
        callback: async ({ options }) => {
          const code = Number(options.code)
          await cam().control(code, 2)
          setTimeout(() => cam().control(code, 1).catch(() => {}), 300)
        },
      },
      sendKey: {
        name: 'Send a key / control opcode',
        options: [
          { id: 'code', type: 'textinput', label: 'Control opcode (decimal)', default: String(C.KEY_UP) },
          { id: 'value', type: 'number', label: 'Value', default: 1, min: 0, max: 65535 },
        ],
        callback: async ({ options }) => cam().control(Number(options.code), Number(options.value)),
      },
      setProperty: {
        name: 'Set any property (advanced)',
        options: [
          { id: 'prop', type: 'textinput', label: 'Property code (decimal)', default: '' },
          { id: 'value', type: 'number', label: 'Value', default: 0, min: -2147483648, max: 2147483647 },
        ],
        callback: async ({ options }) => this.guardedSet(Number(options.prop), Number(options.value)),
      },
    }
  }

  feedbacks () {
    const cam = () => this.cam
    return {
      connected: {
        type: 'boolean', name: 'Camera connected', defaultStyle: {}, options: [],
        callback: () => !!cam()?.connected,
      },
      recording: {
        type: 'boolean', name: 'Camera is recording', defaultStyle: {}, options: [],
        callback: () => cam()?.value(P.REC_STATE) === 0,
      },
      propertyIs: {
        type: 'boolean', name: 'Property has value', defaultStyle: {},
        options: [
          { id: 'prop', type: 'textinput', label: 'Property code (decimal)', default: '' },
          { id: 'value', type: 'number', label: 'Value', default: 0, min: -2147483648, max: 2147483647 },
        ],
        callback: ({ options }) => cam()?.value(Number(options.prop)) === Number(options.value),
      },
      propertyLocked: {
        type: 'boolean', name: 'Camera reports control not Active (see README)', defaultStyle: {},
        options: [{ id: 'prop', type: 'textinput', label: 'Property code (decimal)', default: String(P.IRIS) }],
        callback: ({ options }) => cam()?.availability(Number(options.prop)) !== 2,
      },
    }
  }

  getConfigFields () {
    return [
      {
        type: 'static-text', id: 'intro', width: 12, label: 'Sony PXW camcorder control',
        value:
          'Controls PXW-Z300 / PXW-Z200 / HXR-NX800 bodies over their "Pro Camera Remote Control" ' +
          'interface (PTP-IP tunnelled through SSH). These are camcorders, not PTZ heads — the lens ' +
          'rings own iris, zoom and focus, so some controls are read-only by design. See Help for detail.',
      },

      { type: 'static-text', id: 'h_conn', width: 12, label: 'Connection', value: '' },
      { type: 'textinput', id: 'host', label: 'Camera IP address', width: 5, regex: Regex.IP },
      { type: 'textinput', id: 'user', label: 'User name', width: 3, default: 'admin' },
      { type: 'textinput', id: 'pass', label: 'Password', width: 4 },
      {
        type: 'static-text', id: 'h_auth', width: 12, label: '',
        value:
          'Set these on the camera under <b>[Network] &gt; [Network Setup] &gt; [Edit Authentication]</b>. ' +
          'The password must be 8–16 characters and mix letters and numbers. ' +
          '<b>[Network] &gt; [Network Setup] &gt; [Show Authentication]</b> displays the current values.',
      },

      { type: 'static-text', id: 'h_poll', width: 12, label: 'Polling', value: '' },
      {
        type: 'number', id: 'poll', label: 'Poll interval (ms)', width: 4,
        default: 1000, min: 250, max: 10000,
      },
      {
        type: 'static-text', id: 'h_pollnote', width: 8, label: '',
        value:
          'The camera has no push notifications, so every variable and feedback comes from polling ' +
          'its full property table. 1000 ms is comfortable; below 500 ms adds load for little gain.',
      },

      {
        type: 'static-text', id: 'h_req', width: 12, label: 'Before controls will respond',
        value:
          '<b>Record</b> needs a card in a slot — with none, the camera accepts the command and ignores it.<br>' +
          '<b>White balance</b> (colour temp, tint, R/B gain) only responds while the WB switch is on ' +
          'memory <b>A</b> or <b>B</b>. On PRESET the camera silently discards the change.<br>' +
          '<b>FULL AUTO</b> overrides the individual switches — turn it off for manual control.<br>' +
          '<b>Iris and shutter</b> cannot currently be set remotely on this body; they are reported ' +
          'as variables only.',
      },
    ]
  }

  async configUpdated (config) { this.config = config; this.presetsBuilt = false; this.connect() }
  async destroy () { this.cam?.stop() }
}

module.exports = { PxwInstance }
