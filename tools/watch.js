// Live property differ: change something on the camera, it prints which code moved.
const { SonyPTP } = require('../src/sony-ptp')
const requireEnv = (n) => {
  const v = process.env[n]
  if (!v) { console.error(`set ${n} (e.g. CAM=192.168.0.10 CAM_PASS=secret node ${process.argv[1].split('/').pop()})`); process.exit(1) }
  return v
}

const HOST = requireEnv('CAM')

const KNOWN = {
  0x5007: 'Iris (f-num x100)', 0xd20f: 'ColorTemp K', 0xd00e: 'Shutter angle x1000',
  0xd004: 'Focus dist m x100', 0xd005: 'Focus dist ft x100', 0xd086: 'WB preset K',
  0xd007: 'FocusMode', 0xd001: 'IrisMode', 0xd006: 'FocusDistUnit'
}
const fmt = v => Array.isArray(v) ? `[${v.length}]` : v

;(async () => {
  const cam = new SonyPTP({ host: HOST, user: process.env.CAM_USER || 'admin', pass: requireEnv('CAM_PASS') })
  console.log('connecting…')
  await cam.connect(); await cam.handshake()
  console.log(`watching ${cam.model} — change a setting on the camera (ctrl-C to stop)\n`)

  let prev = null
  for (;;) {
    const { props } = await cam.getAllProps()
    const now = new Map(props.map(p => [p.code, p]))
    if (prev) {
      for (const [code, p] of now) {
        const q = prev.get(code)
        if (!q) continue
        const label = KNOWN[code] ? ` (${KNOWN[code]})` : ''
        if (JSON.stringify(q.current) !== JSON.stringify(p.current)) {
          console.log(`  0x${code.toString(16)}${label}  ${fmt(q.current)} -> ${fmt(p.current)}`)
        } else if (q.enable !== p.enable) {
          console.log(`  0x${code.toString(16)}${label}  enable ${q.enable} -> ${p.enable}`)
        }
      }
    }
    prev = now
    await new Promise(r => setTimeout(r, 700))
  }
})().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
