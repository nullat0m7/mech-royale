import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { aimError, ballisticPitch, ballisticTime, interceptTime, pointInRing, wrap } from "../bot/world/geom.ts"
import { World } from "../bot/world/map.ts"
import { Nav } from "../bot/world/nav.ts"
import { pickUpgrade, zoneAt } from "../bot/brain/brain.ts"

const ARENA = new URL("../mechfight-kit/arena", import.meta.url).pathname
const world = World.load(ARENA)
const nav = new Nav(world)

test("wrap keeps angles in [-pi, pi)", () => {
  assert.ok(Math.abs(wrap(3 * Math.PI) - -Math.PI) < 1e-9)
  assert.ok(Math.abs(wrap(-0.5) + 0.5) < 1e-12)
  assert.ok(aimError([0, 0], [Math.PI / 2, 0]) - Math.PI / 2 < 1e-9)
})

test("pointInRing on a square, with a hole via World.inPrism2D", () => {
  const sq = [0, 0, 10, 0, 10, 10, 0, 10]
  assert.equal(pointInRing(sq, 5, 5), true)
  assert.equal(pointInRing(sq, 11, 5), false)
  const holed = world.prisms.find((p) => p.holes.length > 0)!
  const h = holed.holes[0]
  // centroid of the hole's vertices is (for these convex courtyards) inside the hole, so not inside the prism
  let cx = 0, cy = 0
  for (let i = 0; i < h.length; i += 2) {
    cx += h[i]
    cy += h[i + 1]
  }
  cx /= h.length / 2
  cy /= h.length / 2
  if (pointInRing(h, cx, cy)) assert.equal(world.inPrism2D(holed, cx, cy), false)
})

test("terrain matches raw samples at grid vertices", () => {
  const raw = readFileSync(`${ARENA}/v2/terrain.i16`)
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
  for (const [i, j] of [[10, 10], [500, 300], [1000, 700]]) {
    const want = dv.getInt16((j * world.nx + i) * 2, true) / 100
    assert.ok(Math.abs(world.ground(world.tMinX + i, world.tMinY + j) - want) < 1e-3)
  }
})

test("rays through a building are blocked, rays over it are clear", () => {
  const b = world.prisms.find((p) => p.kind === "building" && p.top - p.base > 12 && p.maxX - p.minX > 20)!
  // find an interior point
  let cx = 0, cy = 0
  for (let y = b.minY; y <= b.maxY && !cx; y += 1)
    for (let x = b.minX; x <= b.maxX; x += 1)
      if (world.inPrism2D(b, x, y)) {
        cx = x
        cy = y
        break
      }
  const z = b.base + 2
  assert.ok(world.solidAt(cx, cy, z))
  const a = [b.minX - 40, cy, z], c = [b.maxX + 40, cy, z]
  assert.ok(world.rayHit(a, c) <= 1, "a horizontal ray through the building must hit it")
  const up = b.top + 30
  assert.ok(world.clear([b.minX - 5, cy, up], [b.maxX + 5, cy, up]), "a ray above the roof is clear")
})

test("intercept solver leads a moving target exactly", () => {
  const from = [0, 0, 0], p = [100, 0, 0], v = [0, 10, 0]
  const t = interceptTime(from, p, v, 252)
  assert.ok(t > 0)
  const hit = [p[0] + v[0] * t, p[1] + v[1] * t]
  assert.ok(Math.abs(Math.hypot(hit[0], hit[1]) - 252 * t) < 1e-6)
})

test("ballistic pitch lands the shell on target (numerical integration)", () => {
  for (const [d, h, high] of [[120, 0, false], [120, 5, true], [60, -4, false]] as const) {
    const v = 72, g = 22
    const pitch = ballisticPitch(d, h, v, g, high)
    const T = ballisticTime(d, pitch, v)
    let x = 0, z = 0, vx = v * Math.cos(pitch), vz = v * Math.sin(pitch)
    const dt = 1 / 2000
    for (let s = 0; s < T / dt; s++) {
      x += vx * dt
      vz -= g * dt
      z += vz * dt
    }
    assert.ok(Math.abs(x - d) < 0.5 && Math.abs(z - h) < 0.5, `d=${d} h=${h}: landed at ${x.toFixed(2)}, ${z.toFixed(2)}`)
  }
  assert.ok(Number.isNaN(ballisticPitch(400, 0, 72, 22, false)), "out of range gives NaN")
})

test("nav finds a path between open points that never enters a tall building", () => {
  const p = nav.path(-217, -22, 41, -72)!
  assert.ok(p.length > 10)
  const end = p[p.length - 1]
  assert.ok(Math.hypot(nav.cx(nav.ci(end)) - 41, nav.cy(nav.cj(end)) - -72) < 4)
  for (const k of p) assert.equal(nav.roof[k], 0, "path cell on a roof")
  for (let i = 1; i < p.length; i++) assert.ok(nav.h[p[i]] - nav.h[p[i - 1]] <= nav.stepUp + 2 * Math.tan((50 * Math.PI) / 180) * 1.42)
})

test("zone interpolates linearly through the shrink", () => {
  const z = { center: [0, 0], radius: 100, next_center: [10, 0], next_radius: 50, shrink_start: 10, shrink_end: 20, dps: 20 } as any
  assert.deepEqual(zoneAt(z, 5), { x: 0, y: 0, r: 100 })
  assert.deepEqual(zoneAt(z, 15), { x: 5, y: 0, r: 75 })
  assert.deepEqual(zoneAt(z, 25), { x: 10, y: 0, r: 50 })
})

test("upgrade pick follows the priority list", () => {
  assert.equal(pickUpgrade(["plating", "armor"], ["gun_rate", "armor", "sensors"]), 1)
  assert.equal(pickUpgrade(["plating", "armor"], ["sensors", "gyros", "plating"]), 2)
  assert.equal(pickUpgrade([], ["a", "b", "c"]), 0)
})
