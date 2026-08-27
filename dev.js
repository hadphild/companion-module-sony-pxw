// Exercises the module's camera + preset code outside Companion.
//   node dev.js            -> connect, show variables, count presets
const { Camera } = require('./src/camera')
const { buildPresets } = require('./src/presets')
const { P, fmt, AVAILABILITY } = require('./src/props')
const requireEnv = (n) => {
  const v = process.env[n]
  if (!v) { console.error(`set ${n} (e.g. CAM=192.168.0.10 CAM_PASS=secret node ${process.argv[1].split('/').pop()})`); process.exit(1) }
  return v
}


const cam = new Camera({
  host: requireEnv('CAM'),
  user: process.env.CAM_USER || 'admin',
  pass: requireEnv('CAM_PASS'),
  pollInterval: 1000,
})
cam.on('up', m => console.log('connected:', m))
cam.on('down', r => console.log('down:', r))
cam.on('strings', g => console.log('display string groups:', Object.keys(g).length))
cam.once('props', () => {
  const unit = cam.value(P.FOCUS_UNIT) === 2 ? 'ft' : 'm'
  console.log('\n--- variables ---')
  console.log('  iris           ', fmt.iris(cam.value(P.IRIS)), `(${AVAILABILITY[cam.availability(P.IRIS)]})`)
  console.log('  iris_mode      ', fmt.onOff(cam.value(P.IRIS_MODE)))
  console.log('  shutter_angle  ', fmt.angle(cam.value(P.SHUTTER_ANGLE)))
  console.log('  colour_temp    ', fmt.kelvin(cam.value(P.COLOUR_TEMP)), `(${AVAILABILITY[cam.availability(P.COLOUR_TEMP)]})`)
  console.log('  focus_distance ', unit === 'ft' ? fmt.feet(cam.value(P.FOCUS_FT)) : fmt.metres(cam.value(P.FOCUS_M)))
  console.log('  focus_mode     ', fmt.onOff(cam.value(P.FOCUS_MODE)))
  console.log('  battery        ', fmt.percent(cam.value(P.BATTERY)))
  console.log('  slot1          ', fmt.slot(cam.value(P.SLOT1_STATUS)), fmt.minutes(cam.value(P.SLOT1_TIME)))
  console.log('  slot2          ', fmt.slot(cam.value(P.SLOT2_STATUS)), fmt.minutes(cam.value(P.SLOT2_TIME)))

  const presets = buildPresets(cam)
  const byCat = {}
  for (const p of Object.values(presets)) byCat[p.category] = (byCat[p.category] || 0) + 1
  console.log(`\n--- presets: ${Object.keys(presets).length} total ---`)
  for (const [c, n] of Object.entries(byCat).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${c}`)
  cam.stop(); process.exit(0)
})
cam.start()
