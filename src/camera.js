'use strict'
const { EventEmitter } = require('events')
const { SonyPTP } = require('./sony-ptp')
const { parseDisplayStrings } = require('./strings')

/**
 * Keeps one PTP-IP session to the camera alive and polls its property table.
 * Emits: 'up' (model), 'down' (reason), 'props' (Map code -> prop), 'strings' (groups)
 */
class Camera extends EventEmitter {
  constructor (opts) {
    super()
    this.opts = opts
    this.props = new Map()
    this.strings = {}
    this.connected = false
    this.stopped = false
  }

  async start () {
    this.stopped = false
    await this._connect()
  }

  async _connect () {
    if (this.stopped) return
    try {
      this.ptp = new SonyPTP({ host: this.opts.host, user: this.opts.user, pass: this.opts.pass, name: 'Companion' })
      const model = await this.ptp.connect()
      await this.ptp.handshake()
      try {
        const r = await this.ptp.op(0x9215, [0])
        if (r.rc === 0x2001 && r.data.length) { this.strings = parseDisplayStrings(r.data); this.emit('strings', this.strings) }
      } catch { /* display strings are a nicety, not required */ }
      this.connected = true
      this.emit('up', model)
      this._poll()
    } catch (e) {
      this.connected = false
      this.emit('down', e.message)
      this._retry()
    }
  }

  _retry () {
    if (this.stopped || this.retryTimer) return
    this.retryTimer = setTimeout(() => { this.retryTimer = null; this._connect() }, 5000)
  }

  async _poll () {
    if (this.stopped || !this.connected) return
    try {
      const { props } = await this.ptp.getAllProps()
      this.props = new Map(props.map(p => [p.code, p]))
      this.emit('props', this.props)
    } catch (e) {
      this.connected = false
      try { this.ptp.close() } catch {}
      this.emit('down', e.message)
      return this._retry()
    }
    this.pollTimer = setTimeout(() => this._poll(), this.opts.pollInterval || 1000)
  }

  get (code) { return this.props.get(code) }
  value (code) { return this.props.get(code)?.current }
  /** 0 unavailable, 1 locked by a physical switch, 2 settable */
  availability (code) { return this.props.get(code)?.enable ?? 0 }

  async setProp (code, value) {
    const p = this.props.get(code)
    if (!p) throw new Error(`property 0x${code.toString(16)} not present`)
    await this.ptp.op(0x9205, [code], SonyPTP.encode(p.dt, value))
  }

  /** Momentary control. dt defaults to u16, which is what the camera expects. */
  async control (code, value, dt = 4) {
    await this.ptp.op(0x9207, [code], SonyPTP.encode(dt, value))
  }

  /** Step through a property's own list of legal values. */
  async step (code, delta) {
    const p = this.props.get(code)
    if (!p?.setValues?.length) throw new Error(`property 0x${code.toString(16)} has no value list`)
    const vals = p.setValues
    let i = vals.indexOf(p.current)
    if (i < 0) i = 0
    const next = vals[Math.min(vals.length - 1, Math.max(0, i + delta))]
    await this.setProp(code, next)
    return next
  }

  stop () {
    this.stopped = true
    clearTimeout(this.pollTimer); clearTimeout(this.retryTimer)
    this.retryTimer = null
    try { this.ptp?.close() } catch {}
    this.connected = false
  }
}

module.exports = { Camera }
