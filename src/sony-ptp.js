'use strict'
const { Client } = require('ssh2')
const crypto = require('crypto')

const PTP_PORT = 15740

function utf16z (s) { return Buffer.concat([Buffer.from(s, 'utf16le'), Buffer.from([0, 0])]) }

/** One PTP-IP channel tunnelled over SSH direct-tcpip to localhost:15740 */
class Channel {
  constructor (stream) {
    this.s = stream
    this.buf = Buffer.alloc(0)
    this.waiters = []
    stream.on('data', d => { this.buf = Buffer.concat([this.buf, d]); this._drain() })
  }
  _drain () {
    while (this.waiters.length) {
      if (this.buf.length < 8) return
      const len = this.buf.readUInt32LE(0)
      if (this.buf.length < len) return
      const type = this.buf.readUInt32LE(4)
      const body = this.buf.subarray(8, len)
      this.buf = this.buf.subarray(len)
      this.waiters.shift().resolve({ type, body })
    }
  }
  send (type, body) {
    const h = Buffer.alloc(8)
    h.writeUInt32LE(body.length + 8, 0); h.writeUInt32LE(type, 4)
    this.s.write(Buffer.concat([h, body]))
  }
  recv (timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('PTP recv timeout')), timeoutMs)
      this.waiters.push({ resolve: v => { clearTimeout(t); resolve(v) }, reject })
      this._drain()
    })
  }
  end () { try { this.s.end() } catch {} }
}

class SonyPTP {
  constructor (opts) {
    this.host = opts.host; this.user = opts.user; this.pass = opts.pass
    this.name = opts.name || 'Companion'
    this.txid = 0
    this._queue = Promise.resolve()
  }
  _ssh () {
    return new Promise((resolve, reject) => {
      const c = new Client()
      c.on('ready', () => resolve(c))
      c.on('error', reject)
      c.connect({
        host: this.host, port: 22, username: this.user,
        tryKeyboard: true,
        password: this.pass,
        readyTimeout: 20000,
        // camera runs OpenSSH 7.9 — allow its older algorithms
        algorithms: { serverHostKey: ['ssh-ed25519', 'ecdsa-sha2-nistp256', 'rsa-sha2-512', 'rsa-sha2-256', 'ssh-rsa'] }
      })
      c.on('keyboard-interactive', (n, i, il, prompts, cb) => cb(prompts.map(() => this.pass)))
    })
  }
  _tunnel (client) {
    return new Promise((resolve, reject) => {
      client.forwardOut('127.0.0.1', 12345, 'localhost', PTP_PORT, (err, stream) => {
        if (err) return reject(err)
        resolve(new Channel(stream))
      })
    })
  }
  async connect () {
    this.cmdClient = await this._ssh()
    this.cmd = await this._tunnel(this.cmdClient)
    const guid = crypto.randomBytes(16)
    const ver = Buffer.alloc(4); ver.writeUInt32LE(0x00010000, 0)
    this.cmd.send(1, Buffer.concat([guid, utf16z(this.name), ver]))
    const ack = await this.cmd.recv()
    if (ack.type !== 2) throw new Error(`InitCommandAck failed (type ${ack.type})`)
    this.connNo = ack.body.readUInt32LE(0)
    let o = 20, chars = []
    while (o + 1 < ack.body.length) {
      const c = ack.body.readUInt16LE(o); o += 2
      if (c === 0) break
      chars.push(String.fromCharCode(c))
    }
    this.model = chars.join('')
    this.evtClient = await this._ssh()
    this.evt = await this._tunnel(this.evtClient)
    const cn = Buffer.alloc(4); cn.writeUInt32LE(this.connNo, 0)
    this.evt.send(3, cn)
    const eack = await this.evt.recv()
    if (eack.type !== 4) throw new Error(`InitEventAck failed (type ${eack.type})`)
    return this.model
  }
  /**
   * PTP allows exactly one transaction in flight per channel, but the poll loop
   * and button presses both issue operations. Serialise them so a press during
   * a poll cannot interleave and desynchronise the stream.
   */
  op (opcode, params = [], payload = null) {
    const run = this._queue.then(
      () => this._op(opcode, params, payload),
      () => this._op(opcode, params, payload)
    )
    this._queue = run.then(() => {}, () => {})
    return run
  }

  async _op (opcode, params = [], payload = null) {
    const tx = ++this.txid
    const b = Buffer.alloc(10 + params.length * 4)
    b.writeUInt32LE(payload ? 2 : 1, 0); b.writeUInt16LE(opcode, 4); b.writeUInt32LE(tx, 6)
    params.forEach((p, i) => b.writeUInt32LE(p >>> 0, 10 + i * 4))
    this.cmd.send(6, b)
    if (payload) {
      const sd = Buffer.alloc(12)
      sd.writeUInt32LE(tx, 0); sd.writeBigUInt64LE(BigInt(payload.length), 4)
      this.cmd.send(9, sd)
      const tb = Buffer.alloc(4); tb.writeUInt32LE(tx, 0)
      this.cmd.send(12, Buffer.concat([tb, payload]))
    }
    let data = Buffer.alloc(0)
    for (;;) {
      const { type, body } = await this.cmd.recv()
      if (type === 9) continue
      if (type === 10 || type === 12) { data = Buffer.concat([data, body.subarray(4)]); continue }
      if (type === 7) return { rc: body.readUInt16LE(0), data }
      throw new Error(`unexpected PTP packet type ${type}`)
    }
  }
  /** Full Sony handshake; 0x012C is the protocol version the Z300 accepts */
  async handshake () {
    await this.op(0x1002, [1])
    await this.op(0x9201, [1, 0, 0])
    await this.op(0x9201, [2, 0, 0])
    await this.op(0x9202, [0x012C])
    await this.op(0x9201, [3, 0, 0])
  }
  /** Encode a JS number into the PTP datatype's little-endian bytes. */
  static encode (dt, value) {
    const SZ = { 1: 1, 2: 1, 3: 2, 4: 2, 5: 4, 6: 4, 7: 8, 8: 8 }
    const SIGNED = new Set([1, 3, 5, 7])
    const sz = SZ[dt]
    if (!sz) throw new Error(`cannot encode datatype 0x${dt.toString(16)}`)
    const b = Buffer.alloc(sz)
    if (sz <= 4) SIGNED.has(dt) ? b.writeIntLE(value, 0, sz) : b.writeUIntLE(value >>> 0, 0, sz)
    else SIGNED.has(dt) ? b.writeBigInt64LE(BigInt(value)) : b.writeBigUInt64LE(BigInt(value))
    return b
  }
  /** SDIO_SetExtDevicePropValue — change a setting (iris, colour temp, …). */
  async setProp (code, dt, value) {
    const { rc } = await this.op(0x9205, [code], SonyPTP.encode(dt, value))
    if (rc !== 0x2001) throw new Error(`setProp 0x${code.toString(16)} rc=0x${rc.toString(16)}`)
  }
  /** SDIO_ControlDevice — momentary actions (record, push-AF, …). */
  async control (code, dt, value) {
    const { rc } = await this.op(0x9207, [code], SonyPTP.encode(dt, value))
    if (rc !== 0x2001) throw new Error(`control 0x${code.toString(16)} rc=0x${rc.toString(16)}`)
  }
  async getAllProps () {
    const { rc, data } = await this.op(0x9209)
    if (rc !== 0x2001) throw new Error(`GetAllExtDevicePropInfo rc=0x${rc.toString(16)}`)
    return parseProps(data)
  }
  close () {
    this.evt?.end(); this.cmd?.end()
    try { this.evtClient?.end() } catch {}
    try { this.cmdClient?.end() } catch {}
  }
}

const SZ = { 1: 1, 2: 1, 3: 2, 4: 2, 5: 4, 6: 4, 7: 8, 8: 8 }
const SIGNED = new Set([1, 3, 5, 7])
function readVal (b, o, dt) {
  if (dt === 0xffff) { const n = b.readUInt8(o); return [b.subarray(o + 1, o + 1 + n * 2).toString('utf16le').replace(/\0+$/, ''), o + 1 + n * 2] }
  if (dt & 0x4000) {
    const base = dt & 0xff; const n = b.readUInt32LE(o); o += 4
    const out = []
    for (let i = 0; i < n; i++) { const [v, no] = readVal(b, o, base); out.push(v); o = no }
    return [out, o]
  }
  const sz = SZ[dt]
  if (!sz) throw new Error(`unknown datatype 0x${dt.toString(16)}`)
  let v
  if (sz <= 4) v = SIGNED.has(dt) ? b.readIntLE(o, sz) : b.readUIntLE(o, sz)
  else v = Number(SIGNED.has(dt) ? b.readBigInt64LE(o) : b.readBigUInt64LE(o))
  return [v, o + sz]
}
function parseProps (b) {
  const n = b.readUInt32LE(0)
  let o = 8
  const out = []
  for (let i = 0; i < n; i++) {
    const code = b.readUInt16LE(o); const dt = b.readUInt16LE(o + 2)
    const writable = !!b.readUInt8(o + 4); const enable = b.readUInt8(o + 5)
    o += 6
    let v
    ;[v, o] = readVal(b, o, dt)          // factory default
    let cur
    ;[cur, o] = readVal(b, o, dt)
    const form = b.readUInt8(o); o += 1
    const p = { code, dt, writable, enable, current: cur, form }
    if (form === 1) {
      ;[p.min, o] = readVal(b, o, dt); [p.max, o] = readVal(b, o, dt); [p.step, o] = readVal(b, o, dt)
    } else if (form === 2) {
      const ng = b.readUInt16LE(o); o += 2; p.getValues = []
      for (let j = 0; j < ng; j++) { let x; [x, o] = readVal(b, o, dt); p.getValues.push(x) }
      const ns = b.readUInt16LE(o); o += 2; p.setValues = []
      for (let j = 0; j < ns; j++) { let x; [x, o] = readVal(b, o, dt); p.setValues.push(x) }
    }
    out.push(p)
  }
  return { props: out, consumed: o, total: b.length }
}

module.exports = { SonyPTP, parseProps }
