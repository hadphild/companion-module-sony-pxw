// node tools/baseline.js save   -> snapshot current camera state
// node tools/baseline.js diff   -> show what changed since the snapshot
const fs = require('fs')
const { SonyPTP } = require('../src/sony-ptp')
const requireEnv = (n) => {
  const v = process.env[n]
  if (!v) { console.error(`set ${n} (e.g. CAM=192.168.0.10 CAM_PASS=secret node ${process.argv[1].split('/').pop()})`); process.exit(1) }
  return v
}

const F = '/tmp/claude-501/baseline.json'
;(async () => {
  const cam = new SonyPTP({ host: requireEnv('CAM'), user: 'admin', pass: requireEnv('CAM_PASS') })
  await cam.connect(); await cam.handshake()
  const { props } = await cam.getAllProps()
  if (process.argv[2] === 'save') {
    fs.writeFileSync(F, JSON.stringify(props))
    console.log(`baseline saved (${props.length} props)`)
  } else {
    const old = new Map(JSON.parse(fs.readFileSync(F)).map(p => [p.code, p]))
    let n = 0
    for (const p of props) {
      const q = old.get(p.code); if (!q) continue
      if (JSON.stringify(q.current) !== JSON.stringify(p.current)) { console.log(`  0x${p.code.toString(16)}  ${q.current} -> ${p.current}`); n++ }
      else if (q.enable !== p.enable) { console.log(`  0x${p.code.toString(16)}  enable ${q.enable} -> ${p.enable}`); n++ }
    }
    console.log(n ? `${n} changed` : 'no change')
  }
  cam.close(); process.exit(0)
})().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
