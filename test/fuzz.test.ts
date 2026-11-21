/**
 * Feeds the brain 10 000 randomized observations built from the recorded check stream: positions all
 * over (and off) the map, every weapon combination, empty and crowded lists, offers, drops, projectiles,
 * unknown fields. The brain must never throw and must always send a well-formed action.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { World } from "../bot/world/map.ts"
import { Nav } from "../bot/world/nav.ts"
import { Brain } from "../bot/brain/brain.ts"
import { P } from "../bot/params.ts"
import { rng } from "../bot/world/geom.ts"

const ROOT = new URL("..", import.meta.url).pathname
const msgs = gunzipSync(readFileSync(ROOT + "mechfight-kit/check/stream.jsonl.gz")).toString().split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l))
const hello = msgs[0]
const recorded = msgs.filter((m: any) => m.type === "obs")
const world = World.load(ROOT + "mechfight-kit/arena")
const nav = new Nav(world)
const KINDS = ["gun", "mortar", "laser", "lightning"]

function weapon(r: () => number, kind: string) {
  const stats = { ...hello.config.weapons[kind] }
  if (kind === "gun") stats.mag = 12
  return { kind, cooldown: r() < 0.5 ? 0 : r() * 3, ...(kind === "gun" ? { ammo: Math.floor(r() * 13), reload: r() < 0.7 ? 0 : r() * 2.4 } : {}), ...(kind === "laser" ? { charge: r() < 0.5 ? 0 : r() * 0.9 } : {}), stats }
}

function randomObs(r: () => number, tick: number): any {
  const o = structuredClone(recorded[Math.floor(r() * recorded.length)])
  o.tick = tick
  o.t = tick / 20
  const W = world
  const x = W.minX - 20 + r() * (W.maxX - W.minX + 40), y = W.minY - 20 + r() * (W.maxY - W.minY + 40)
  o.self.pos = [x, y, W.ground(x, y) + (r() < 0.2 ? r() * 40 : 0)]
  o.self.hp = Math.floor(r() * 1400) + 1
  o.self.energy = Math.floor(r() * 100)
  o.self.cubes = Math.floor(r() * 30)
  const w0 = r() < 0.1 ? null : weapon(r, KINDS[Math.floor(r() * 4)])
  let k1 = KINDS[Math.floor(r() * 4)]
  if (w0 && k1 === w0.kind) k1 = KINDS[(KINDS.indexOf(k1) + 1) % 4]
  o.self.weapons = [w0, r() < 0.4 ? null : weapon(r, k1)]
  o.self.in_zone = r() < 0.7
  const n = Math.floor(r() * 16)
  o.mechs = Array.from({ length: n }, (_, i) => {
    const px = x + (r() - 0.5) * 400, py = y + (r() - 0.5) * 400
    const npc = r() < 0.3
    return { id: npc ? 100 + i : (i + 4) % 16, kind: npc ? "npc" : "mech", pos: [px, py, W.ground(px, py)], vel: [(r() - 0.5) * 30, (r() - 0.5) * 30, 0], aim: [r() * 6 - 3, r() - 0.5], hp: Math.floor(r() * 1400), max_hp: 1400, cubes: Math.floor(r() * 12), weapons: [KINDS[Math.floor(r() * 4)]], charging: r() < 0.2, extra_field: 1 }
  })
  o.projectiles = Array.from({ length: Math.floor(r() * 10) }, (_, i) => ({ id: i, kind: ["gun", "mortar", "npc"][i % 3], pos: [x + (r() - 0.5) * 100, y + (r() - 0.5) * 100, 5 + r() * 30], vel: [(r() - 0.5) * 300, (r() - 0.5) * 300, (r() - 0.5) * 60] }))
  o.pickups = Array.from({ length: Math.floor(r() * 6) }, (_, i) => ({ id: 8000 + i, kind: KINDS[Math.floor(r() * 4)], pos: [x + (r() - 0.5) * 10, y + (r() - 0.5) * 10, o.self.pos[2]] }))
  o.cubes = Array.from({ length: Math.floor(r() * 5) }, (_, i) => ({ id: 5000 + i, pos: [x + (r() - 0.5) * 80, y + (r() - 0.5) * 80, o.self.pos[2]] }))
  o.crates = Array.from({ length: Math.floor(r() * 5) }, (_, i) => ({ id: 1000 + i, pos: [x + (r() - 0.5) * 120, y + (r() - 0.5) * 120, o.self.pos[2]], hp: 300 }))
  o.drops = r() < 0.3 ? [{ id: 20000, pos: [x + 50, y, 0], radius: 8, lands_in: r() * 25, capture_s: 4, progress: r() * 4, holder: r() < 0.5 ? null : 3 }] : []
  o.events = r() < 0.3 ? [{ type: "damaged", amount: 45, weapon: r() < 0.2 ? "zone" : "gun", bearing: r() < 0.2 ? null : r() * 6 - 3, by: r() < 0.2 ? null : 5 }, { type: "kill", target: 5 }, { type: "take_failed", id: 8000, reason: "gone" }] : []
  o.sounds = r() < 0.5 ? [{ kind: "gun", bearing: r() * 6 - 3, dist: ["near", "mid", "far"][Math.floor(r() * 3)], age: 0.1 }] : []
  o.offer = r() < 0.2 ? { id: 1, expires: o.t + 5, choices: [{ id: "armor", name: "a", desc: "" }, { id: "plating", name: "p", desc: "" }, { id: "newthing", name: "n", desc: "" }] } : null
  const zr = r() * 560
  o.zone = { center: [x + (r() - 0.5) * 200, y], radius: zr, next_center: [x, y + (r() - 0.5) * 200], next_radius: zr * r(), shrink_start: o.t + (r() - 0.5) * 60, shrink_end: o.t + r() * 60, dps: 20 }
  o.alive = 1 + Math.floor(r() * 16)
  return o
}

test("brain survives 10 000 random observations with well-formed actions", () => {
  const r = rng(12345)
  let brain = new Brain(hello, world, nav, P)
  for (let i = 0; i < 10000; i++) {
    if (i % 500 === 0) brain = new Brain(hello, world, nav, P) // fresh memory now and then
    const o = randomObs(r, i * 2)
    let a: any
    assert.doesNotThrow(() => (a = brain.act(o)), `tick ${i}`)
    assert.equal(a.tick, o.tick)
    for (const k of ["move", "aim"]) if (a[k]) assert.ok(a[k].length === 2 && a[k].every(Number.isFinite), `${k} ${JSON.stringify(a[k])} at ${i}`)
    if (a.move) assert.ok(Math.hypot(a.move[0], a.move[1]) <= 1.0001)
    if (a.fire) assert.ok(a.fire.length === 2 && a.fire.every((f: unknown) => typeof f === "boolean"))
    if (a.pick !== undefined) assert.ok([0, 1, 2].includes(a.pick))
    if (a.drop !== undefined) assert.ok([0, 1].includes(a.drop))
    if (a.take !== undefined) assert.ok(Number.isInteger(a.take))
    assert.ok(JSON.stringify(a).length < 60000)
  }
})
