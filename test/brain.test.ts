/** Brain behaviours checked against the recorded real match (mechfight-kit/check) and small hand-made observations. */
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { World } from "../bot/world/map.ts"
import { Nav } from "../bot/world/nav.ts"
import { Brain } from "../bot/brain/brain.ts"
import { loadParams, P } from "../bot/params.ts"

const ROOT = new URL("..", import.meta.url).pathname
const msgs = gunzipSync(readFileSync(ROOT + "mechfight-kit/check/stream.jsonl.gz")).toString().split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l))
const hello = msgs[0]
const recorded = msgs.filter((m: any) => m.type === "obs")
const world = World.load(ROOT + "mechfight-kit/arena")
const nav = new Nav(world)

test("loadParams copies the defaults and never mutates them", () => {
  const a = loadParams('{"retreatHp":0.5,"weaponPref":{"gun":9}}', { mode: "ffa" })
  assert.equal(a.retreatHp, 0.5)
  assert.equal(a.weaponPref.gun, 9)
  assert.equal(a.weaponPref.laser, P.weaponPref.laser)
  assert.equal(a.mode, "ffa")
  assert.notEqual(P.retreatHp, 0.5)
  assert.notEqual(P.weaponPref.gun, 9)
  assert.equal(P.mode, "auto")
})

test("free-for-all is detected on the recorded match (3 deaths we did not cause by 24.9 s)", () => {
  const brain = new Brain(hello, world, nav, loadParams(undefined))
  let firstT = -1
  for (const o of recorded) {
    brain.act(structuredClone(o))
    if (brain.ghost && firstT < 0) firstT = o.t
  }
  assert.ok(firstT > 0 && firstT <= 23, `ghost at ${firstT}`)
})

test("deaths we caused never switch to free-for-all; practice mode never does", () => {
  const brain = new Brain(hello, world, nav, loadParams(undefined))
  const forced = new Brain(hello, world, nav, loadParams(undefined, { mode: "practice" }))
  let alive = 16
  for (let i = 0; i < 200; i++) {
    const o = structuredClone(recorded[i])
    o.events = []
    if (i % 20 === 19) {
      alive--
      o.events = [{ type: "kill", target: 4 }]
    }
    o.alive = alive
    brain.act(o)
    const f = structuredClone(o)
    f.alive = alive - 3
    forced.act(f)
  }
  assert.equal(brain.ghost, false)
  assert.equal(forced.ghost, false)
})

test("a weapon valued below zero is never taken and is dropped when held", () => {
  const brain = new Brain(hello, world, nav, loadParams(undefined, { weaponPref: { mortar: -1 } }))
  const o = structuredClone(recorded[0])
  const gun = o.self.weapons[0]
  o.self.weapons = [gun, null]
  o.pickups = [{ id: 8001, kind: "mortar", pos: [...o.self.pos] }]
  assert.equal(brain.act(o).take, undefined)
  const o2 = structuredClone(recorded[1])
  o2.self.weapons = [gun, { kind: "mortar", cooldown: 0, stats: hello.config.weapons.mortar }]
  o2.pickups = []
  assert.equal(brain.act(o2).drop, 1)
})

test("in a free-for-all a mortar is left on the ground; in practice it is taken", () => {
  const ffa = new Brain(hello, world, nav, loadParams(undefined, { mode: "ffa" }))
  const practice = new Brain(hello, world, nav, loadParams(undefined, { mode: "practice" }))
  const o = structuredClone(recorded[0])
  o.self.weapons = [o.self.weapons[0], null]
  o.pickups = [{ id: 8001, kind: "mortar", pos: [...o.self.pos] }]
  assert.equal(ffa.act(structuredClone(o)).take, undefined)
  assert.equal(practice.act(structuredClone(o)).take, 8001)
})
