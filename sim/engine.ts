/**
 * Local approximation of the mechfight/1 server (protocol.md sections 2-10), for testing and tuning.
 * It is not the real server: trees are ignored, collisions use the centre point plus four rim points,
 * and NPC drones walk without pathfinding. Practice scores decide; this finds bugs and compares versions.
 */
import type { Hello, Observation } from "../bot/mechfight.ts"
import { aimAt, rng, wrap } from "../bot/world/geom.ts"
import type { World } from "../bot/world/map.ts"
import type { Nav } from "../bot/world/nav.ts"

/** What a controller asks for each decision (the protocol action without `tick`, loosely typed). */
export type Cmd = { move?: number[]; boost?: boolean; jump?: boolean; aim?: number[]; fire?: boolean[]; reload?: boolean; pick?: number; take?: number; drop?: number }

export type Controller = {
  name: string
  /** Called once per decision for every alive mech it drives. Return the action (tick is filled in). */
  act(sim: Sim, m: Mech, obs: Observation | null): Cmd
  /** True when act() needs a full protocol observation (our bot); house AI reads the engine directly. */
  wantsObs: boolean
}

export type WState = { kind: string; cooldown: number; ammo: number; reload: number; charge: number; hold: number }
export type Mech = {
  id: number
  alive: boolean
  pos: number[]
  vel: number[]
  aim: number[]
  cmd: Cmd
  hp: number
  energy: number
  grounded: boolean
  cubes: number
  upg: Map<string, number>
  weapons: (WState | null)[]
  lastDmgT: number
  lastSpendT: number
  deathT: number
  place: number
  kills: number
  shortUntil: number
  offerQ: number
  offer: { id: number; expires: number; choices: { id: string; name: string; desc: string }[] } | null
  offerSeq: number
  events: any[]
  memory: Map<number, number>
  ctl: Controller
  tier: number
  joined: boolean
  stats: Record<string, number>
  wstats: Record<string, Record<string, number>>
  deathCause: string
  missed: number
  aux: any // controller scratch
  stat: Record<string, number> // counters for diagnostics
}
type Proj = { id: number; kind: "gun" | "mortar" | "npc"; owner: number; pos: number[]; vel: number[]; travel: number; range: number; dmg: number; ttl: number }
type Npc = { id: number; pos: number[]; home: number[]; hp: number; target: number; cooldown: number; wander: number[]; alive: boolean }
type Item = { id: number; pos: number[]; kind?: string; hp?: number }
type Drop = { id: number; pos: number[]; landT: number; holder: number | null; progress: number }
type Sound = { kind: string; pos: number[]; t: number; by: number }
type Beam = { by: number; kind: string; path: number[][]; t: number }

export class Sim {
  cfg: any
  world: World
  nav: Nav
  t = 0
  tick = 0
  rand: () => number
  mechs: Mech[] = []
  npcs: Npc[] = []
  crates: Item[] = []
  cubes: Item[] = []
  pickups: Item[] = []
  drops: Drop[] = []
  projs: Proj[] = []
  sounds: Sound[] = []
  beams: Beam[] = []
  nextId = 1
  zone: { center: number[]; radius: number; next_center: number[]; next_radius: number; shrink_start: number; shrink_end: number; dps: number; phase: number }
  over = false
  timing: number[] = []
  log: string[] = []

  constructor(cfg: any, world: World, nav: Nav, seed: number) {
    this.cfg = cfg
    this.world = world
    this.nav = nav
    this.rand = rng(seed)
    const z = cfg.zone
    this.zone = { center: [...z.start_center], radius: z.start_radius, next_center: [0, 0], next_radius: z.phases[0].radius, shrink_start: z.phases[0].hold_s, shrink_end: z.phases[0].hold_s + z.phases[0].shrink_s, dps: z.phases[0].dps, phase: 0 }
    this.zone.next_center = this.innerCenter(this.zone.center, this.zone.radius, this.zone.next_radius)
  }

  // ------------------------------------------------------------------ setup
  gauss() {
    let u = 0, v = 0
    while (u === 0) u = this.rand()
    while (v === 0) v = this.rand()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }
  innerCenter(c: number[], r: number, r2: number): number[] {
    for (let i = 0; i < 50; i++) {
      const a = this.rand() * Math.PI * 2, d = Math.sqrt(this.rand()) * Math.max(0, r - r2)
      const p = [c[0] + Math.cos(a) * d, c[1] + Math.sin(a) * d]
      if (p[0] > this.world.minX + 40 && p[0] < this.world.maxX - 40 && p[1] > this.world.minY + 40 && p[1] < this.world.maxY - 40) return p
    }
    return [...c]
  }
  /** Random open ground point (not a roof), optionally inside a circle. */
  groundPoint(c?: number[], r?: number): number[] {
    for (let i = 0; i < 400; i++) {
      let x: number, y: number
      if (c && r !== undefined) {
        const a = this.rand() * Math.PI * 2, d = Math.sqrt(this.rand()) * r
        x = c[0] + Math.cos(a) * d
        y = c[1] + Math.sin(a) * d
      } else {
        x = this.world.minX + 40 + this.rand() * (this.world.maxX - this.world.minX - 80)
        y = this.world.minY + 40 + this.rand() * (this.world.maxY - this.world.minY - 80)
      }
      const k = this.nav.cell(x, y)
      if (this.nav.roof[k] || this.nav.blocked[k] || this.nav.wall[k]) continue
      return [x, y, this.nav.h[k]]
    }
    return [0, 0, this.world.ground(0, 0)]
  }
  roofPoint(): number[] {
    for (let i = 0; i < 2000; i++) {
      const x = this.world.minX + 40 + this.rand() * (this.world.maxX - this.world.minX - 80)
      const y = this.world.minY + 40 + this.rand() * (this.world.maxY - this.world.minY - 80)
      const k = this.nav.cell(x, y)
      if (this.nav.roof[k] && !this.nav.wall[k] && this.nav.h[k] - this.world.ground(x, y) < 55) return [x, y, this.nav.h[k]]
    }
    return this.groundPoint()
  }

  addMech(ctl: Controller, tier = 0): Mech {
    const id = this.mechs.length
    const m: Mech = {
      id, alive: true, pos: [0, 0, 0], vel: [0, 0, 0], aim: [0, 0], cmd: {}, hp: 0, energy: 0, grounded: true, cubes: 0,
      upg: new Map(), weapons: [null, null], lastDmgT: -99, lastSpendT: -99, deathT: -1, place: 0, kills: 0, shortUntil: -1,
      offerQ: 0, offer: null, offerSeq: 0, events: [], memory: new Map(), ctl, tier, joined: false, stats: {}, wstats: {},
      deathCause: "", missed: 0, aux: {}, stat: {},
    }
    this.recompute(m)
    m.hp = m.stats.hp
    m.energy = m.stats.energy
    m.weapons[0] = this.newWeapon(m, "gun")
    this.mechs.push(m)
    return m
  }

  setup() {
    const n = this.mechs.length
    const spawns: number[][] = []
    const zc = this.zone.center, zr = this.zone.radius * this.cfg.match.spawn_zone_fraction
    for (let i = 0; i < n; i++) {
      let best = this.groundPoint(zc, zr), bestD = 0
      for (let k = 0; k < 30; k++) {
        const p = this.groundPoint(zc, zr)
        const d = Math.min(...spawns.map((s) => Math.hypot(s[0] - p[0], s[1] - p[1])), 1e9)
        if (d > bestD) {
          bestD = d
          best = p
        }
        if (d >= this.cfg.match.spawn_min_separation) break
      }
      spawns.push(best)
      this.mechs[i].pos = [...best]
      this.mechs[i].aim = [this.rand() * Math.PI * 2 - Math.PI, 0]
    }
    for (let i = 0; i < this.cfg.npc.count; i++) {
      const p = this.groundPoint()
      this.npcs.push({ id: 100 + i, pos: [...p], home: [...p], hp: this.cfg.npc.hp, target: -1, cooldown: 0, wander: [...p], alive: true })
    }
    for (let i = 0; i < this.cfg.crates.count; i++) {
      const p = this.rand() < this.cfg.crates.roof_fraction ? this.roofPoint() : this.groundPoint()
      this.crates.push({ id: 1000 + i, pos: p, hp: this.cfg.crates.hp })
    }
    for (let i = 0; i < this.cfg.loot.floor_count; i++) {
      const p = this.rand() < this.cfg.loot.floor_roof_fraction ? this.roofPoint() : this.groundPoint()
      this.addPickup(this.randomKind(), p)
    }
  }
  randomKind(): string {
    const w = this.cfg.loot.weights
    const kinds = Object.keys(w).filter((k) => w[k] > 0)
    const tot = kinds.reduce((s, k) => s + w[k], 0)
    let r = this.rand() * tot
    for (const k of kinds) if ((r -= w[k]) <= 0) return k
    return kinds[0]
  }
  pickupSeq = 8000
  cubeSeq = 5000
  addPickup(kind: string, pos: number[]): Item {
    const it = { id: this.pickupSeq++, kind, pos: [...pos] }
    this.pickups.push(it)
    return it
  }
  addCube(pos: number[]) {
    this.cubes.push({ id: this.cubeSeq++, pos: [pos[0] + (this.rand() - 0.5) * 2, pos[1] + (this.rand() - 0.5) * 2, pos[2]] })
  }

  hello(m: Mech): Hello {
    return { type: "hello", protocol: "mechfight/1", slot: m.id, seed: (m.id * 7919 + 13) >>> 0, map: { dir: "", files: ["v2/world.json", "v2/terrain.i16"] }, config: this.cfg }
  }

  // ------------------------------------------------------------------ stats
  newWeapon(m: Mech, kind: string): WState {
    const s = m.wstats[kind]
    return { kind, cooldown: 0, ammo: kind === "gun" ? s.mag : 0, reload: 0, charge: 0, hold: 0 }
  }
  recompute(m: Mech) {
    const st: Record<string, number> = { ...this.cfg.mech }
    const ws: Record<string, Record<string, number>> = {}
    for (const k of Object.keys(this.cfg.weapons)) ws[k] = { ...this.cfg.weapons[k] }
    for (const u of this.cfg.upgrades) {
      const n = m.upg.get(u.id) ?? 0
      for (let i = 0; i < n; i++)
        for (const e of u.effects) {
          const [root, a, b] = e.path.split(".")
          const obj = root === "mech" ? st : ws[a]
          const key = root === "mech" ? a : b
          if (e.mul !== undefined) obj[key] *= e.mul
          if (e.add !== undefined) obj[key] += e.add
        }
    }
    const scale = 1 + this.cfg.cubes.size_per_cube * m.cubes
    st.radius = this.cfg.mech.radius * scale
    st.height = this.cfg.mech.height * scale
    st.eye_height = this.cfg.mech.eye_height * scale
    st.muzzle_height = this.cfg.mech.muzzle_height * scale
    const hpMul = 1 + this.cfg.cubes.hp_per_cube * Math.min(m.cubes, this.cfg.cubes.stat_cap)
    const oldMax = m.stats.hp ?? st.hp * hpMul
    st.hp = st.hp * hpMul
    if (m.alive && st.hp > oldMax) m.hp += st.hp - oldMax
    m.stats = st
    m.wstats = ws
  }
  dmgMul(m: Mech) {
    return 1 + this.cfg.cubes.damage_per_cube * Math.min(m.cubes, this.cfg.cubes.stat_cap)
  }

  // ------------------------------------------------------------------ geometry
  support(x: number, y: number, z: number, stepUp: number): number {
    let s = this.world.ground(x, y)
    for (const idx of this.world.prismsAt(x, y)) {
      const p = this.world.prisms[idx]
      if (p.top <= z + stepUp && p.top > s) s = p.top
    }
    return s
  }
  /** Would a mech with feet at z, radius r and height h overlap a solid at (x, y)? */
  blockedAt(x: number, y: number, z: number, r: number, h: number, stepUp: number): boolean {
    const pts = [[x, y], [x + r * 0.9, y], [x - r * 0.9, y], [x, y + r * 0.9], [x, y - r * 0.9]]
    for (const [px, py] of pts) {
      for (const idx of this.world.prismsAt(px, py)) {
        const p = this.world.prisms[idx]
        if (p.base < z + h && p.top > z + stepUp) return true
      }
      if (px < this.world.minX + 1 || px > this.world.maxX - 1 || py < this.world.minY + 1 || py > this.world.maxY - 1) return true
    }
    return false
  }
  /** Ray against world and other mechs/npcs/crates; returns first hit. */
  trace(a: number[], b: number[], ignore: number, radiusPad: number): { t: number; kind: "world" | "mech" | "npc" | "crate" | null; id: number } {
    let best = this.world.rayHit(a, b, 1.5)
    let kind: any = best <= 1 ? "world" : null
    let id = -1
    const test = (pos: number[], r: number, h: number, k: string, i: number) => {
      const t = segCyl(a, b, pos, r + radiusPad, h)
      if (t >= 0 && t < best) {
        best = t
        kind = k
        id = i
      }
    }
    for (const m of this.mechs) if (m.alive && m.id !== ignore) test(m.pos, m.stats.radius, m.stats.height, "mech", m.id)
    for (const n of this.npcs) if (n.alive && n.id !== ignore) test(n.pos, this.cfg.npc.radius, this.cfg.npc.height, "npc", n.id)
    for (const c of this.crates) test(c.pos, this.cfg.crates.radius, this.cfg.crates.height, "crate", c.id)
    return { t: best, kind, id }
  }

  // ------------------------------------------------------------------ damage
  damage(targetKind: string, id: number, amount: number, by: number, weapon: string, from: number[] | null, effect?: string) {
    const att = by >= 0 && by < 16 ? this.mechs[by] : null
    if (targetKind === "mech") {
      const m = this.mechs[id]
      if (!m.alive) return
      let amt = amount
      let rear = false
      if (weapon !== "zone") {
        amt *= 1 - Math.min(0.9, m.stats.armor ?? 0)
        if (from) {
          const yaw = Math.atan2(from[1] - m.pos[1], from[0] - m.pos[0])
          if (Math.abs(wrap(yaw - m.aim[0])) > ((m.stats.front_arc_deg ?? 180) * Math.PI) / 360) {
            amt *= m.stats.rear_mult ?? 1.5
            rear = true
          }
        }
      }
      if (weapon === "laser" && m.weapons.some((w) => w?.kind === "mortar")) {
        amt *= 1 + this.cfg.weapons.laser.cookoff
        effect = "cookoff"
        m.events.push({ type: "effect", effect: "cookoff", by })
      }
      m.hp -= amt
      m.lastDmgT = this.t
      const key = weapon === "zone" ? "takenZone" : weapon === "npc" ? "takenNpc" : "takenMech"
      m.stat[key] = (m.stat[key] ?? 0) + amt
      if (att && att !== m) att.stat.dealtMech = (att.stat.dealtMech ?? 0) + amt
      const bearing = from ? Math.atan2(from[1] - m.pos[1], from[0] - m.pos[0]) : null
      m.events.push({ type: "damaged", amount: Math.round(amt), weapon, bearing, by: weapon === "zone" ? null : by, ...(rear ? { rear: true } : {}) })
      if (att && att !== m) {
        att.lastDmgT = this.t
        att.events.push({ type: "hit", target: id, amount: Math.round(amt), weapon, ...(effect ? { effect } : {}), ...(rear ? { rear: true } : {}) })
      }
      if (m.hp <= 0) this.kill(m, att, weapon)
    } else if (targetKind === "npc") {
      const n = this.npcs.find((q) => q.id === id)
      if (!n || !n.alive) return
      n.hp -= amount
      if (by >= 0 && by < 16) n.target = by
      if (att) att.events.push({ type: "hit", target: id, amount: Math.round(amount), weapon })
      if (n.hp <= 0) {
        n.alive = false
        for (let i = 0; i < this.cfg.npc.cubes; i++) this.addCube(n.pos)
      }
    } else if (targetKind === "crate") {
      const c = this.crates.find((q) => q.id === id)
      if (!c) return
      c.hp! -= amount
      if (att) att.events.push({ type: "hit", target: id, amount: Math.round(amount), weapon })
      if (c.hp! <= 0) {
        this.crates = this.crates.filter((q) => q !== c)
        this.sounds.push({ kind: "crate", pos: c.pos, t: this.t, by: -1 })
        for (let i = 0; i < this.cfg.crates.cubes; i++) this.addCube(c.pos)
        if (this.rand() < this.cfg.loot.crate_weapon_chance) this.addPickup(this.randomKind(), c.pos)
      }
    }
  }
  pendingDeaths: Mech[] = []
  kill(m: Mech, att: Mech | null, weapon: string) {
    m.alive = false
    m.deathT = this.t
    m.deathCause = weapon === "zone" ? "zone" : weapon === "npc" ? "npc" : att === m ? "self" : `mech:${weapon}`
    this.pendingDeaths.push(m)
    if (att && att !== m) {
      att.kills++
      att.events.push({ type: "kill", target: m.id })
    }
    for (let i = 0; i < m.cubes + this.cfg.cubes.death_drop_extra; i++) this.addCube(m.pos)
    for (const w of m.weapons) if (w && w.kind !== "gun") this.addPickup(w.kind, m.pos)
    this.sounds.push({ kind: "death", pos: m.pos, t: this.t, by: m.id })
  }

  // ------------------------------------------------------------------ main loop
  run(maxT = this.cfg.match.duration_s) {
    this.setup()
    const dt = 1 / this.cfg.match.tick_hz
    while (!this.over) {
      if (this.tick % this.cfg.match.decide_every === 0) this.decide()
      this.step(dt)
      this.tick++
      this.t = this.tick * dt
      if (this.t >= maxT) this.finish()
    }
  }

  decide() {
    for (const m of this.mechs) {
      if (!m.alive) continue
      const obs = m.ctl.wantsObs ? this.observe(m) : null
      const t0 = performance.now()
      let a: Cmd
      try {
        a = m.ctl.act(this, m, obs)
      } catch (e) {
        this.log.push(`act threw for ${m.id}: ${e}`)
        a = {}
      }
      if (m.ctl.wantsObs && this.tick > 0) this.timing.push(performance.now() - t0)
      // continuous parts carry over; one-shot parts apply once
      m.cmd = { move: a.move ?? [0, 0], boost: a.boost ?? false, aim: a.aim ?? m.cmd.aim ?? m.aim, fire: a.fire ?? [false, false], jump: a.jump, reload: a.reload, pick: a.pick, take: a.take, drop: a.drop }
      m.events = []
      this.applyOneShots(m)
    }
  }

  applyOneShots(m: Mech) {
    const c = m.cmd
    if (c.pick !== undefined && m.offer) {
      const ch = m.offer.choices[c.pick] ?? m.offer.choices[0]
      this.applyUpgrade(m, ch.id)
    }
    if (c.reload) {
      const g = m.weapons.find((w) => w?.kind === "gun")
      if (g && g.reload <= 0 && g.ammo < m.wstats.gun.mag) g.reload = m.wstats.gun.reload
    }
    if (c.take !== undefined) {
      const p = this.pickups.find((q) => q.id === c.take)
      const fail = (reason: string) => m.events.push({ type: "take_failed", id: c.take, reason })
      if (!p) fail("gone")
      else if (Math.hypot(p.pos[0] - m.pos[0], p.pos[1] - m.pos[1]) > this.cfg.loot.pickup_radius || Math.abs(p.pos[2] - m.pos[2]) > 4) fail("range")
      else if (m.weapons.some((w) => w?.kind === p.kind)) fail("have")
      else {
        let slot = m.weapons[0] === null ? 0 : m.weapons[1] === null ? 1 : -1
        if (slot < 0 && (c.drop === 0 || c.drop === 1)) {
          const old = m.weapons[c.drop]!
          if (old.kind === "laser" && old.charge > 0) {
            fail("busy")
            return
          }
          const dp = this.addPickup(old.kind, m.pos)
          m.events.push({ type: "dropped", id: dp.id, kind: old.kind, slot: c.drop })
          slot = c.drop
        }
        if (slot < 0) fail("full")
        else {
          this.pickups = this.pickups.filter((q) => q !== p)
          const w = this.newWeapon(m, p.kind!)
          w.cooldown = Math.max(this.cfg.loot.equip_s, m.wstats[p.kind!].cooldown ?? 0)
          m.weapons[slot] = w
          m.events.push({ type: "took", id: p.id, kind: p.kind, slot })
        }
      }
    } else if (c.drop === 0 || c.drop === 1) {
      const old = m.weapons[c.drop]
      if (old && !(old.kind === "laser" && old.charge > 0)) {
        const dp = this.addPickup(old.kind, m.pos)
        m.weapons[c.drop] = null
        m.events.push({ type: "dropped", id: dp.id, kind: old.kind, slot: c.drop })
      }
    }
  }

  applyUpgrade(m: Mech, id: string) {
    m.upg.set(id, (m.upg.get(id) ?? 0) + 1)
    m.offer = null
    m.events.push({ type: "upgrade", id })
    this.recompute(m)
  }
  makeOffer(m: Mech) {
    const held = m.weapons.map((w) => w?.kind)
    const ok = this.cfg.upgrades.filter((u: any) => (m.upg.get(u.id) ?? 0) < u.max && (!u.requires || held.includes(u.requires)))
    const choices: any[] = []
    while (choices.length < 3 && ok.length) choices.push(ok.splice(Math.floor(this.rand() * ok.length), 1)[0])
    if (!choices.length) return
    m.offer = { id: ++m.offerSeq, expires: this.t + this.cfg.bot.offer_timeout_s, choices: choices.map((u) => ({ id: u.id, name: u.name, desc: u.desc })) }
  }
  gainCubes(m: Mech, n: number) {
    for (let i = 0; i < n; i++) {
      m.cubes++
      if (this.cfg.cubes.upgrade_thresholds.includes(m.cubes)) m.offerQ++
    }
    this.recompute(m)
  }

  step(dt: number) {
    const t = this.t
    // offers
    for (const m of this.mechs) {
      if (!m.alive) continue
      if (m.offer && t >= m.offer.expires) this.applyUpgrade(m, m.offer.choices[0].id)
      if (!m.offer && m.offerQ > 0) {
        m.offerQ--
        this.makeOffer(m)
      }
    }
    for (const m of this.mechs) if (m.alive) this.moveMech(m, dt)
    // push apart
    for (let i = 0; i < this.mechs.length; i++)
      for (let j = i + 1; j < this.mechs.length; j++) {
        const a = this.mechs[i], b = this.mechs[j]
        if (!a.alive || !b.alive) continue
        const dx = b.pos[0] - a.pos[0], dy = b.pos[1] - a.pos[1]
        const d = Math.hypot(dx, dy), min = a.stats.radius + b.stats.radius
        if (d < min && d > 1e-6 && Math.abs(a.pos[2] - b.pos[2]) < 9) {
          const push = (min - d) / 2
          a.pos[0] -= (dx / d) * push
          a.pos[1] -= (dy / d) * push
          b.pos[0] += (dx / d) * push
          b.pos[1] += (dy / d) * push
        }
      }
    for (const m of this.mechs) if (m.alive) this.weaponsTick(m, dt)
    this.projTick(dt)
    this.npcTick(dt)
    this.zoneTick(dt)
    this.itemsTick(dt)
    // regen and energy
    for (const m of this.mechs) {
      if (!m.alive) continue
      const inZone = this.inZone(m.pos)
      if (inZone && t - m.lastDmgT >= m.stats.regen_delay && m.hp < m.stats.hp) m.hp = Math.min(m.stats.hp, m.hp + m.stats.regen_per_s * dt)
      if (t - m.lastSpendT >= m.stats.energy_regen_delay) m.energy = Math.min(m.stats.energy, m.energy + m.stats.energy_regen * dt)
    }
    this.resolveDeaths()
    this.sounds = this.sounds.filter((s) => t - s.t < 0.5)
    this.beams = this.beams.filter((b) => t - b.t < 0.3)
  }

  resolveDeaths() {
    if (!this.pendingDeaths.length) return
    const aliveBefore = this.mechs.filter((m) => m.alive).length + this.pendingDeaths.length
    for (const m of this.pendingDeaths) m.place = aliveBefore
    this.pendingDeaths = []
    if (this.mechs.filter((m) => m.alive).length <= 1) this.finish()
  }

  finish() {
    if (this.over) return
    this.over = true
    const alive = this.mechs.filter((m) => m.alive).sort((a, b) => b.hp - a.hp)
    alive.forEach((m, i) => (m.place = i + 1))
  }

  inZone(p: number[]): boolean {
    const c = this.circle()
    return Math.hypot(p[0] - c[0], p[1] - c[1]) <= c[2]
  }
  circle(): number[] {
    const z = this.zone, t = this.t
    if (t <= z.shrink_start) return [z.center[0], z.center[1], z.radius]
    if (t >= z.shrink_end) return [z.next_center[0], z.next_center[1], z.next_radius]
    const f = (t - z.shrink_start) / (z.shrink_end - z.shrink_start)
    return [z.center[0] + (z.next_center[0] - z.center[0]) * f, z.center[1] + (z.next_center[1] - z.center[1]) * f, z.radius + (z.next_radius - z.radius) * f]
  }

  moveMech(m: Mech, dt: number) {
    const st = m.stats
    const c = m.cmd
    // aim slews toward the command
    const want = c.aim ?? m.aim
    const dyaw = wrap(want[0] - m.aim[0])
    const maxY = st.turn_rate * dt
    m.aim[0] = wrap(m.aim[0] + Math.max(-maxY, Math.min(maxY, dyaw)))
    const pitch = Math.max(st.min_pitch, Math.min(st.max_pitch, want[1]))
    const maxP = st.pitch_rate * dt
    m.aim[1] += Math.max(-maxP, Math.min(maxP, pitch - m.aim[1]))
    let mv = c.move ?? [0, 0]
    const ml = Math.hypot(mv[0], mv[1])
    if (ml > 1) mv = [mv[0] / ml, mv[1] / ml]
    const charging = m.weapons.some((w) => w?.kind === "laser" && w.charge > 0)
    let speed = st.walk_speed
    if (c.boost && m.grounded && ml > 0.1 && m.energy > 0) {
      speed = st.boost_speed
      m.energy -= st.boost_drain * dt
      m.lastSpendT = this.t
    }
    if (charging) speed *= st.charge_move_mult
    const acc = m.grounded ? st.ground_accel : st.air_accel
    for (let i = 0; i < 2; i++) {
      const dv = mv[i] * speed - m.vel[i]
      const lim = acc * dt
      m.vel[i] += Math.max(-lim, Math.min(lim, dv))
    }
    if (c.jump && m.grounded) {
      m.vel[2] = st.jump_speed
      m.grounded = false
      c.jump = false
    }
    if (!m.grounded) {
      if (c.boost && m.energy > 0) {
        m.vel[2] = Math.min(st.max_rise_speed, m.vel[2] + st.jet_accel * dt)
        m.energy -= st.jet_drain * dt
        m.lastSpendT = this.t
        if (this.tick % 6 === 0) this.sounds.push({ kind: "jet", pos: [...m.pos], t: this.t, by: m.id })
      }
      m.vel[2] -= st.gravity * dt
    }
    // horizontal with wall sliding
    const nx = m.pos[0] + m.vel[0] * dt, ny = m.pos[1] + m.vel[1] * dt
    const r = st.radius, h = st.height
    const stepTo = (x: number, y: number) => {
      if (this.blockedAt(x, y, m.pos[2], r, h, st.step_up)) return false
      if (m.grounded) {
        const g = this.world.ground(x, y)
        const d = Math.hypot(x - m.pos[0], y - m.pos[1])
        if (g - m.pos[2] > st.step_up && (g - m.pos[2]) / Math.max(d, 1e-3) > Math.tan((st.max_slope_deg * Math.PI) / 180)) return false
      }
      return true
    }
    if (stepTo(nx, ny)) {
      m.pos[0] = nx
      m.pos[1] = ny
    } else if (stepTo(nx, m.pos[1])) {
      m.pos[0] = nx
      m.vel[1] = 0
    } else if (stepTo(m.pos[0], ny)) {
      m.pos[1] = ny
      m.vel[0] = 0
    } else {
      m.vel[0] = 0
      m.vel[1] = 0
    }
    // vertical
    m.pos[2] += m.vel[2] * dt
    const floor = this.support(m.pos[0], m.pos[1], m.pos[2], st.step_up)
    if (m.pos[2] <= floor + 0.02 && m.vel[2] <= 0) {
      m.pos[2] = floor
      m.vel[2] = 0
      m.grounded = true
    } else if (m.grounded && m.pos[2] - floor < st.step_up + 0.3 && m.vel[2] <= 0) {
      m.pos[2] = floor // walk down small steps
    } else m.grounded = false
    // steps make sound
    const hs = Math.hypot(m.vel[0], m.vel[1])
    if (m.grounded && hs > this.cfg.sound.step_speed) {
      m.aux.stepT = (m.aux.stepT ?? 0) + dt
      if (m.aux.stepT >= this.cfg.sound.step_every) {
        m.aux.stepT = 0
        this.sounds.push({ kind: c.boost ? "boost" : "step", pos: [...m.pos], t: this.t, by: m.id })
      }
    }
  }

  muzzle(m: Mech): number[] {
    const a = m.aim
    const d = [Math.cos(a[1]) * Math.cos(a[0]), Math.cos(a[1]) * Math.sin(a[0]), Math.sin(a[1])]
    const base = [m.pos[0], m.pos[1], m.pos[2] + m.stats.muzzle_height]
    const off = m.stats.radius + 0.5
    const tip = [base[0] + d[0] * off, base[1] + d[1] * off, base[2] + d[2] * off]
    const hit = this.world.rayHit(base, tip, 0.5)
    return hit <= 1 ? [base[0] + (tip[0] - base[0]) * hit * 0.9, base[1] + (tip[1] - base[1]) * hit * 0.9, base[2] + (tip[2] - base[2]) * hit * 0.9] : tip
  }

  weaponsTick(m: Mech, dt: number) {
    const fire = m.cmd.fire ?? [false, false]
    for (let s = 0; s < 2; s++) {
      const w = m.weapons[s]
      if (!w) continue
      const ws = m.wstats[w.kind]
      w.cooldown = Math.max(0, w.cooldown - dt)
      if (w.kind === "gun") {
        if (w.reload > 0) {
          w.reload -= dt
          if (w.reload <= 0) {
            w.reload = 0
            w.ammo = ws.mag
          }
          continue
        }
        if (fire[s] && w.cooldown <= 0 && w.ammo > 0) {
          const sp = (ws.spread_deg * Math.PI) / 180
          const yaw = m.aim[0] + this.gauss() * sp, pitch = m.aim[1] + this.gauss() * sp
          const dir = [Math.cos(pitch) * Math.cos(yaw), Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch)]
          this.projs.push({ id: this.nextId++, kind: "gun", owner: m.id, pos: this.muzzle(m), vel: dir.map((d) => d * ws.speed), travel: 0, range: ws.range, dmg: ws.damage * this.dmgMul(m), ttl: 5 })
          w.ammo--
          w.cooldown = ws.cooldown
          m.stat.gunShots = (m.stat.gunShots ?? 0) + 1
          this.sounds.push({ kind: "gun", pos: [...m.pos], t: this.t, by: m.id })
          if (w.ammo <= 0) {
            w.reload = ws.reload
            this.sounds.push({ kind: "reload", pos: [...m.pos], t: this.t, by: m.id })
          }
        }
      } else if (w.kind === "mortar") {
        if (fire[s] && w.cooldown <= 0) {
          const a = m.aim
          const dir = [Math.cos(a[1]) * Math.cos(a[0]), Math.cos(a[1]) * Math.sin(a[0]), Math.sin(a[1])]
          const base = [m.pos[0] + dir[0] * (m.stats.radius + 0.5), m.pos[1] + dir[1] * (m.stats.radius + 0.5), m.pos[2] + m.stats.height + 0.5]
          this.projs.push({ id: this.nextId++, kind: "mortar", owner: m.id, pos: base, vel: dir.map((d) => d * ws.speed), travel: 0, range: 1e9, dmg: ws.damage * this.dmgMul(m), ttl: ws.ttl })
          w.cooldown = ws.cooldown
          this.sounds.push({ kind: "mortar", pos: [...m.pos], t: this.t, by: m.id })
        }
      } else if (w.kind === "laser") {
        const shorted = this.t < m.shortUntil
        if (w.charge > 0) {
          w.charge = Math.min(ws.charge, w.charge + dt)
          if (w.charge >= ws.charge) w.hold += dt
          const release = (!fire[s] && w.charge >= ws.min_charge) || w.hold >= ws.hold_s
          if (release) this.fireLaser(m, w, ws)
          else if (this.tick % 4 === 0) this.sounds.push({ kind: "laser_charge", pos: [...m.pos], t: this.t, by: m.id })
        } else if (fire[s] && w.cooldown <= 0 && !shorted) {
          w.charge = dt
        }
      } else if (w.kind === "lightning") {
        if (fire[s] && w.cooldown <= 0 && m.energy >= ws.energy) {
          m.energy -= ws.energy
          m.lastSpendT = this.t
          w.cooldown = ws.cooldown
          this.fireLightning(m, ws)
        }
      }
    }
  }

  fireLaser(m: Mech, w: WState, ws: Record<string, number>) {
    const frac = ws.min_frac + (1 - ws.min_frac) * Math.min(1, w.charge / ws.charge)
    w.charge = 0
    w.hold = 0
    w.cooldown = ws.cooldown
    const a = m.aim
    const dir = [Math.cos(a[1]) * Math.cos(a[0]), Math.cos(a[1]) * Math.sin(a[0]), Math.sin(a[1])]
    const from = this.muzzle(m)
    const to = from.map((v, i) => v + dir[i] * ws.range)
    let pierce = ws.pierce ?? 0
    let ignore = m.id
    let start = from
    for (let k = 0; k <= pierce; k++) {
      const hit = this.trace(start, to, ignore, 0)
      if (hit.kind === null || hit.kind === "world") {
        this.beams.push({ by: m.id, kind: "laser", path: [from, hit.kind ? lerp(start, to, hit.t) : to], t: this.t })
        break
      }
      this.damage(hit.kind, hit.id, ws.damage * frac * this.dmgMul(m), m.id, "laser", from)
      this.beams.push({ by: m.id, kind: "laser", path: [from, lerp(start, to, hit.t)], t: this.t })
      ignore = hit.id
      start = lerp(start, to, hit.t)
    }
    this.sounds.push({ kind: "laser", pos: [...m.pos], t: this.t, by: m.id })
  }

  fireLightning(m: Mech, ws: Record<string, number>) {
    const from = [m.pos[0], m.pos[1], m.pos[2] + m.stats.muzzle_height]
    const cands: { kind: string; id: number; pos: number[] }[] = []
    for (const o of this.mechs) if (o.alive && o.id !== m.id) cands.push({ kind: "mech", id: o.id, pos: [o.pos[0], o.pos[1], o.pos[2] + o.stats.height / 2] })
    for (const n of this.npcs) if (n.alive) cands.push({ kind: "npc", id: n.id, pos: [n.pos[0], n.pos[1], n.pos[2] + 1.75] })
    for (const c of this.crates) cands.push({ kind: "crate", id: c.id, pos: [c.pos[0], c.pos[1], c.pos[2] + 1.2] })
    const half = (ws.cone_deg * Math.PI) / 360
    let first: (typeof cands)[0] | null = null, fd = ws.range
    for (const c of cands) {
      const d = Math.hypot(c.pos[0] - from[0], c.pos[1] - from[1])
      if (d > fd) continue
      if (Math.abs(wrap(Math.atan2(c.pos[1] - from[1], c.pos[0] - from[0]) - m.aim[0])) > half) continue
      if (!this.world.clear(from, c.pos)) continue
      fd = d
      first = c
    }
    this.sounds.push({ kind: "lightning", pos: [...m.pos], t: this.t, by: m.id })
    if (!first) {
      const a = m.aim
      this.beams.push({ by: m.id, kind: "lightning", path: [from, [from[0] + Math.cos(a[0]) * ws.range, from[1] + Math.sin(a[0]) * ws.range, from[2]]], t: this.t })
      return
    }
    const path = [from, first.pos]
    const hit = new Set([first.kind + first.id])
    let cur = first, dmg = ws.damage * this.dmgMul(m)
    this.zap(m, cur, dmg, from)
    for (let k = 0; k < ws.chain; k++) {
      let nxt: (typeof cands)[0] | null = null, nd = ws.chain_range
      for (const c of cands) {
        if (hit.has(c.kind + c.id)) continue
        const d = Math.hypot(c.pos[0] - cur.pos[0], c.pos[1] - cur.pos[1], c.pos[2] - cur.pos[2])
        if (d < nd && this.world.clear(cur.pos, c.pos)) {
          nd = d
          nxt = c
        }
      }
      if (!nxt) break
      dmg *= ws.chain_falloff
      hit.add(nxt.kind + nxt.id)
      this.zap(m, nxt, dmg, cur.pos)
      path.push(nxt.pos)
      cur = nxt
    }
    this.beams.push({ by: m.id, kind: "lightning", path, t: this.t })
  }
  zap(m: Mech, c: { kind: string; id: number }, dmg: number, from: number[]) {
    if (c.id === m.id && c.kind === "mech") return
    this.damage(c.kind, c.id, dmg, m.id, "lightning", from, c.kind === "mech" && this.mechs[c.id].weapons.some((w) => w?.kind === "laser") ? "short" : undefined)
    if (c.kind === "mech") {
      const o = this.mechs[c.id]
      const lw = o.weapons.find((w) => w?.kind === "laser")
      if (lw) {
        lw.charge = 0
        lw.hold = 0
        o.shortUntil = this.t + this.cfg.weapons.lightning.short_s
        o.events.push({ type: "effect", effect: "short", by: m.id })
      }
    }
  }

  projTick(dt: number) {
    const g = this.cfg.weapons.mortar.gravity
    const keep: Proj[] = []
    for (const p of this.projs) {
      const a = p.pos
      const v = p.vel
      if (p.kind === "mortar") v[2] -= g * dt
      const b = [a[0] + v[0] * dt, a[1] + v[1] * dt, a[2] + v[2] * dt]
      p.ttl -= dt
      const pad = p.kind === "mortar" ? 0.2 : this.cfg.projectile.gun_radius
      const hit = this.trace(a, b, p.owner, pad)
      if (hit.kind) {
        const at = lerp(a, b, hit.t)
        if (p.kind === "mortar") this.explode(p, at, hit.kind === "mech" || hit.kind === "npc" || hit.kind === "crate" ? hit : null)
        else if (hit.kind !== "world") {
          if (p.owner < 16 && hit.kind === "mech") this.mechs[p.owner].stat.gunHits = (this.mechs[p.owner].stat.gunHits ?? 0) + 1
          this.damage(hit.kind, hit.id, p.dmg, p.owner, p.kind === "npc" ? "npc" : "gun", a)
        }
        continue
      }
      p.travel += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
      p.pos = b
      if (p.travel > p.range || p.ttl <= 0) {
        if (p.kind === "mortar") this.explode(p, b, null)
        continue
      }
      keep.push(p)
    }
    this.projs = keep
  }

  explode(p: Proj, at: number[], direct: { kind: string | null; id: number } | null) {
    const ws = this.mechs[p.owner]?.wstats.mortar ?? this.cfg.weapons.mortar
    const mul = p.dmg / this.cfg.weapons.mortar.damage
    this.sounds.push({ kind: "explosion", pos: at, t: this.t, by: p.owner })
    if (direct && direct.kind) this.damage(direct.kind, direct.id, p.dmg, p.owner, "mortar", at)
    const R = ws.splash_radius
    for (const m of this.mechs) {
      if (!m.alive) continue
      if (direct && direct.kind === "mech" && direct.id === m.id) continue
      const c = [m.pos[0], m.pos[1], m.pos[2] + m.stats.height / 2]
      const d = Math.max(0, Math.hypot(c[0] - at[0], c[1] - at[1], c[2] - at[2]) - m.stats.radius)
      if (d > R) continue
      const lift = [at[0], at[1], at[2] + 0.3]
      if (!this.world.clear(lift, c)) continue
      const f = 1 - (1 - ws.splash_edge) * (d / R)
      let dmg = ws.splash * mul * f
      if (m.id === p.owner) dmg *= this.cfg.mech.self_damage_mult
      this.damage("mech", m.id, dmg, p.owner, "mortar", at, "concuss")
      const dx = m.pos[0] - at[0], dy = m.pos[1] - at[1], dl = Math.hypot(dx, dy) || 1
      m.vel[0] += (dx / dl) * ws.knock * f
      m.vel[1] += (dy / dl) * ws.knock * f
      m.vel[2] += ws.knock_up * f
      m.grounded = false
      m.energy = Math.max(0, m.energy - ws.drain * f)
      m.events.push({ type: "effect", effect: "concuss", by: p.owner })
    }
    for (const n of this.npcs) {
      if (!n.alive || (direct && direct.kind === "npc" && direct.id === n.id)) continue
      const d = Math.hypot(n.pos[0] - at[0], n.pos[1] - at[1], n.pos[2] + 1.75 - at[2])
      if (d < R) this.damage("npc", n.id, ws.splash * mul * (1 - (1 - ws.splash_edge) * (d / R)), p.owner, "mortar", at)
    }
    for (const c of [...this.crates]) {
      if (direct && direct.kind === "crate" && direct.id === c.id) continue
      const d = Math.hypot(c.pos[0] - at[0], c.pos[1] - at[1], c.pos[2] + 1.2 - at[2])
      if (d < R) this.damage("crate", c.id, ws.splash * mul * (1 - (1 - ws.splash_edge) * (d / R)), p.owner, "mortar", at)
    }
  }

  npcTick(dt: number) {
    const N = this.cfg.npc
    for (const n of this.npcs) {
      if (!n.alive) continue
      n.cooldown = Math.max(0, n.cooldown - dt)
      const homeD = Math.hypot(n.pos[0] - n.home[0], n.pos[1] - n.home[1])
      let tgt = n.target >= 0 ? this.mechs[n.target] : null
      if (tgt && (!tgt.alive || Math.hypot(tgt.pos[0] - n.pos[0], tgt.pos[1] - n.pos[1]) > N.deaggro_range || homeD > N.chase_leash)) {
        n.target = -1
        tgt = null
      }
      if (!tgt && homeD <= N.leash && this.tick % 4 === 0) {
        let bd = N.aggro_range
        for (const m of this.mechs) {
          if (!m.alive) continue
          const d = Math.hypot(m.pos[0] - n.pos[0], m.pos[1] - n.pos[1])
          if (d < bd && this.world.clear([n.pos[0], n.pos[1], n.pos[2] + 3], [m.pos[0], m.pos[1], m.pos[2] + 4.5])) {
            bd = d
            n.target = m.id
            tgt = m
          }
        }
      }
      let goal = n.wander
      if (tgt) goal = Math.hypot(tgt.pos[0] - n.pos[0], tgt.pos[1] - n.pos[1]) > 25 ? tgt.pos : n.pos
      else if (homeD > N.leash) goal = n.home
      else if (Math.hypot(goal[0] - n.pos[0], goal[1] - n.pos[1]) < 2) {
        const a = this.rand() * Math.PI * 2, r = this.rand() * N.leash
        n.wander = [n.home[0] + Math.cos(a) * r, n.home[1] + Math.sin(a) * r]
      }
      const dx = goal[0] - n.pos[0], dy = goal[1] - n.pos[1], d = Math.hypot(dx, dy)
      if (d > 1) {
        const x = n.pos[0] + (dx / d) * N.speed * dt, y = n.pos[1] + (dy / d) * N.speed * dt
        const k = this.nav.cell(x, y)
        if (!this.nav.roof[k] && !this.nav.blocked[k] && Math.abs(this.nav.h[k] - n.pos[2]) < 1.5) {
          n.pos = [x, y, this.world.ground(x, y)]
        } else n.wander = [...n.pos]
      }
      if (tgt && n.cooldown <= 0) {
        const from = [n.pos[0], n.pos[1], n.pos[2] + 3]
        const c = [tgt.pos[0], tgt.pos[1], tgt.pos[2] + tgt.stats.height / 2]
        if (Math.hypot(c[0] - from[0], c[1] - from[1]) < N.deaggro_range && this.world.clear(from, c)) {
          const a = aimAt(from, c)
          const sp = (N.spread_deg * Math.PI) / 180
          const yaw = a[0] + this.gauss() * sp, pitch = a[1] + this.gauss() * sp
          const dir = [Math.cos(pitch) * Math.cos(yaw), Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch)]
          this.projs.push({ id: this.nextId++, kind: "npc", owner: n.id, pos: from.map((v, i) => v + dir[i] * 2.3), vel: dir.map((v) => v * N.projectile_speed), travel: 0, range: 200, dmg: N.damage, ttl: 3 })
          n.cooldown = N.cooldown
          this.sounds.push({ kind: "npc_gun", pos: [...n.pos], t: this.t, by: n.id })
        }
      }
    }
  }

  zoneTick(dt: number) {
    const z = this.zone
    const phases = this.cfg.zone.phases
    if (this.t >= z.shrink_end && z.phase < phases.length - 1) {
      z.phase++
      z.center = [...z.next_center]
      z.radius = z.next_radius
      const ph = phases[z.phase]
      z.next_radius = ph.radius
      z.next_center = this.innerCenter(z.center, z.radius, z.next_radius)
      z.shrink_start = z.shrink_end + ph.hold_s
      z.shrink_end = z.shrink_start + ph.shrink_s
      z.dps = ph.dps
    } else if (this.t >= z.shrink_end && z.phase === phases.length - 1) {
      z.center = [...z.next_center]
      z.radius = z.next_radius
    }
    for (const m of this.mechs) if (m.alive && !this.inZone(m.pos)) this.damage("mech", m.id, z.dps * dt, -1, "zone", null)
  }

  itemsTick(dt: number) {
    const C = this.cfg.cubes
    if (this.cubes.length) {
      const keep: Item[] = []
      for (const c of this.cubes) {
        let best: Mech | null = null, bd = C.pickup_radius
        for (const m of this.mechs) {
          if (!m.alive) continue
          const d = Math.hypot(m.pos[0] - c.pos[0], m.pos[1] - c.pos[1])
          if (d <= bd && Math.abs(m.pos[2] - c.pos[2]) <= 4) {
            bd = d
            best = m
          }
        }
        if (best) {
          this.gainCubes(best, 1)
          best.events.push({ type: "pickup", cubes: best.cubes })
        } else keep.push(c)
      }
      this.cubes = keep
    }
    const D = this.cfg.drops
    if (D) {
      for (const callT of D.times)
        if (Math.abs(this.t - callT) < dt / 2) {
          const pos = this.groundPoint(this.zone.next_center, this.zone.next_radius * D.spread)
          this.drops.push({ id: 20000 + this.drops.length, pos, landT: this.t + D.fall_s, holder: null, progress: 0 })
        }
      for (const d of [...this.drops]) {
        if (this.t < d.landT) continue
        const inside = this.mechs.filter((m) => m.alive && Math.hypot(m.pos[0] - d.pos[0], m.pos[1] - d.pos[1]) <= D.radius)
        if (inside.length === 1) {
          if (d.holder !== inside[0].id) {
            d.holder = inside[0].id
            d.progress = 0
          }
          d.progress += dt
          if (d.progress >= D.capture_s) {
            const m = inside[0]
            this.gainCubes(m, D.cubes)
            m.hp = m.stats.hp
            m.energy = m.stats.energy
            m.events.push({ type: "drop", id: d.id, cubes: m.cubes })
            this.drops = this.drops.filter((q) => q !== d)
            this.sounds.push({ kind: "drop", pos: d.pos, t: this.t, by: m.id })
          }
        } else if (inside.length === 0) {
          d.holder = null
          d.progress = 0
        }
      }
    }
  }

  // ------------------------------------------------------------------ observation
  canSee(m: Mech, p: number[], top: number): boolean {
    const eye = [m.pos[0], m.pos[1], m.pos[2] + m.stats.eye_height]
    const d = Math.hypot(p[0] - eye[0], p[1] - eye[1])
    const V = this.cfg.vision
    const near = V.near_range + (m.stats.near_range_bonus ?? 0)
    if (d > near) {
      if (d > V.range + (m.stats.vision_bonus ?? 0)) return false
      if (Math.abs(wrap(Math.atan2(p[1] - eye[1], p[0] - eye[0]) - m.aim[0])) > (V.fov_deg * Math.PI) / 360) return false
    }
    // proximity sensors see through canopy; trunks and buildings still block (protocol.md section 8)
    const crowns = d > near
    return this.world.sightClear(eye, p, crowns) || this.world.sightClear(eye, [p[0], p[1], p[2] + top / 2], crowns)
  }

  observe(m: Mech): Observation {
    const t = this.t
    const mechs: any[] = []
    for (const o of this.mechs) {
      if (!o.alive || o.id === m.id) continue
      const c = [o.pos[0], o.pos[1], o.pos[2] + o.stats.height / 2]
      if (this.canSee(m, c, o.stats.height)) m.memory.set(o.id, t)
      const last = m.memory.get(o.id)
      if (last === undefined || t - last > this.cfg.vision.memory_s) continue
      mechs.push({ id: o.id, kind: "mech", pos: [...o.pos], vel: [...o.vel], aim: [...o.aim], hp: Math.round(o.hp), max_hp: Math.round(o.stats.hp), cubes: o.cubes, weapons: o.weapons.filter((w) => w).map((w) => w!.kind), charging: o.weapons.some((w) => w?.kind === "laser" && w.charge > 0) })
    }
    for (const n of this.npcs) {
      if (!n.alive) continue
      if (Math.hypot(n.pos[0] - m.pos[0], n.pos[1] - m.pos[1]) > 250) continue
      if (this.canSee(m, [n.pos[0], n.pos[1], n.pos[2] + 1.75], 3.5)) m.memory.set(n.id, t)
      const last = m.memory.get(n.id)
      if (last === undefined || t - last > this.cfg.vision.memory_s) continue
      mechs.push({ id: n.id, kind: "npc", pos: [...n.pos], vel: [0, 0, 0], aim: [0, 0], hp: Math.round(n.hp), max_hp: this.cfg.npc.hp })
    }
    const vis = (p: number[], h: number) => Math.hypot(p[0] - m.pos[0], p[1] - m.pos[1]) < 230 && this.canSee(m, [p[0], p[1], p[2] + h / 2], h)
    const self = {
      id: m.id, pos: [...m.pos], vel: [...m.vel], aim: [...m.aim], hp: Math.max(0, Math.round(m.hp)), max_hp: Math.round(m.stats.hp), energy: Math.round(m.energy), max_energy: m.stats.energy,
      grounded: m.grounded, cubes: m.cubes, upgrades: [...m.upg.keys()], in_zone: this.inZone(m.pos),
      weapons: m.weapons.map((w) => (w ? { kind: w.kind, cooldown: w.cooldown, ...(w.kind === "gun" ? { ammo: w.ammo, reload: w.reload } : {}), ...(w.kind === "laser" ? { charge: w.charge } : {}), stats: { ...m.wstats[w.kind] } } : null)),
      stats: { ...m.stats },
    }
    const noise = (this.cfg.sound.bearing_noise_deg * Math.PI) / 180 * (m.stats.hearing ?? 1)
    const sounds = this.sounds
      .filter((s) => s.by !== m.id && t - s.t < 0.11 && t - s.t >= 0)
      .filter((s) => Math.hypot(s.pos[0] - m.pos[0], s.pos[1] - m.pos[1]) <= (this.cfg.sound.range[s.kind] ?? 100))
      .map((s) => {
        const d = Math.hypot(s.pos[0] - m.pos[0], s.pos[1] - m.pos[1])
        return { kind: s.kind, bearing: wrap(Math.atan2(s.pos[1] - m.pos[1], s.pos[0] - m.pos[0]) + this.gauss() * noise), dist: d < this.cfg.sound.near ? "near" : d < this.cfg.sound.mid ? "mid" : "far", age: +(t - s.t).toFixed(2) }
      })
    const z = this.zone
    const obs: Observation = {
      type: "obs", tick: this.tick, t: +t.toFixed(2), alive: this.mechs.filter((q) => q.alive).length,
      self: self as any,
      mechs,
      projectiles: this.projs.filter((p) => p.owner !== m.id && Math.hypot(p.pos[0] - m.pos[0], p.pos[1] - m.pos[1]) < 200).map((p) => ({ id: p.id, kind: p.kind, pos: [...p.pos] as any, vel: [...p.vel] as any })),
      crates: this.crates.filter((c) => vis(c.pos, 2.4)).map((c) => ({ id: c.id, pos: [...c.pos] as any, hp: Math.round(c.hp!) })),
      cubes: this.cubes.filter((c) => vis(c.pos, 1)).map((c) => ({ id: c.id, pos: [...c.pos] as any })),
      pickups: this.pickups.filter((p) => vis(p.pos, 1)).map((p) => ({ id: p.id, kind: p.kind as any, pos: [...p.pos] as any })),
      sounds: sounds as any,
      beams: this.beams.filter((b) => b.by !== m.id && t - b.t < 0.11).map((b) => ({ by: b.by, kind: b.kind as any, path: b.path as any, age: +(t - b.t).toFixed(2) })),
      events: m.events,
      drops: this.drops.map((d) => ({ id: d.id, pos: [...d.pos] as any, radius: this.cfg.drops.radius, lands_in: Math.max(0, +(d.landT - t).toFixed(2)), capture_s: this.cfg.drops.capture_s, progress: d.progress, holder: d.holder })),
      zone: { center: [...z.center] as any, radius: z.radius, next_center: [...z.next_center] as any, next_radius: z.next_radius, shrink_start: z.shrink_start, shrink_end: z.shrink_end, dps: z.dps },
      offer: m.offer,
    }
    return obs
  }
}

export function lerp(a: number[], b: number[], t: number): number[] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

/** First t in [0, 1] where segment a→b enters a vertical cylinder (feet at p), or -1. */
export function segCyl(a: number[], b: number[], p: number[], r: number, h: number): number {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const fx = a[0] - p[0], fy = a[1] - p[1]
  const A = dx * dx + dy * dy
  let t0 = 0, t1 = 1
  if (A < 1e-12) {
    if (fx * fx + fy * fy > r * r) return -1
  } else {
    const B = 2 * (fx * dx + fy * dy), C = fx * fx + fy * fy - r * r
    const disc = B * B - 4 * A * C
    if (disc < 0) return -1
    const s = Math.sqrt(disc)
    t0 = Math.max(t0, (-B - s) / (2 * A))
    t1 = Math.min(t1, (-B + s) / (2 * A))
    if (t0 > t1) return -1
  }
  const dz = b[2] - a[2]
  const z0 = p[2], z1 = p[2] + h
  if (Math.abs(dz) < 1e-9) {
    if (a[2] < z0 || a[2] > z1) return -1
  } else {
    const ta = (z0 - a[2]) / dz, tb = (z1 - a[2]) / dz
    t0 = Math.max(t0, Math.min(ta, tb))
    t1 = Math.min(t1, Math.max(ta, tb))
    if (t0 > t1) return -1
  }
  return t0
}
