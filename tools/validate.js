// Cross-checks that every actionId / feedbackId used by a preset actually exists.
// A typo here fails silently inside Companion, so check it here instead.
const { PxwInstance } = require('../src/instance')
const { buildPresets } = require('../src/presets')

const stubCam = {
  props: new Map(), connected: false,
  get: () => undefined, value: () => undefined, availability: () => 0,
}
const inst = Object.create(PxwInstance.prototype)
inst.cam = stubCam
inst.log = () => {}

const actions = Object.keys(inst.actions())
const feedbacks = Object.keys(inst.feedbacks())
const presets = buildPresets(stubCam)

let bad = 0
for (const [id, p] of Object.entries(presets)) {
  for (const step of p.steps || []) {
    for (const key of ['down', 'up']) {
      for (const a of step[key] || []) {
        if (!actions.includes(a.actionId)) { console.error(`  ✗ preset "${id}" -> unknown action "${a.actionId}"`); bad++ }
      }
    }
  }
  for (const f of p.feedbacks || []) {
    if (!feedbacks.includes(f.feedbackId)) { console.error(`  ✗ preset "${id}" -> unknown feedback "${f.feedbackId}"`); bad++ }
  }
  for (const field of ['type', 'category', 'name', 'style', 'steps']) {
    if (p[field] === undefined) { console.error(`  ✗ preset "${id}" missing "${field}"`); bad++ }
  }
}
console.log(`actions:   ${actions.length}  (${actions.join(', ')})`)
console.log(`feedbacks: ${feedbacks.length}  (${feedbacks.join(', ')})`)
console.log(`presets:   ${Object.keys(presets).length} checked`)
console.log(bad ? `\n${bad} PROBLEM(S)` : '\nall preset references resolve')
process.exit(bad ? 1 : 0)
