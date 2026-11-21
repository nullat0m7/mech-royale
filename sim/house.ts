/**
 * Simulated opponents. The practice squad follows the track page: 15 house bots (4 easy, 4 medium,
 * 4 hard, 3 expert) share vision, never fight each other, and hunt the one outside mech. One joins
 * early, more join with each house bot it kills, and all come late. Every number is a guess to be
 * calibrated against real practice scores (docs/bot.md).
 */
import type { Hello, Observation } from "../bot/mechfight.ts"
import { aimAt, interceptTime, wrap } from "../bot/world/geom.ts"
import type { Cmd, Controller, Mech, Sim } from "./engine.ts"

export type HouseTuning = {
  joinStart: number // s, first hunter joins
  joinPerKill: number // hunters added per house bot killed
  lateAll: number // s, everyone hunts
  intelEvery: number // s, hunters learn the target's true position this often
  aimSigmaDeg: number[] // per tier: easy, medium, hard, expert
  lead: number[] // fraction of the true lead used
  strafe: number[] // strafing amplitude
  fireRange: number[] // gun engagement range
}

export const HOUSE: HouseTuning = {
  joinStart: 20,
  joinPerKill: 1,
  lateAll: 240,
  intelEvery: 8,
  aimSigmaDeg: [1.5, 0.9, 0.5, 0.3],
  lead: [0.6, 0.9, 1, 1],
  strafe: [0, 0.4, 0.8, 1],
  // full gun range for every tier: the real FFA recording (check stream) shows a bot gunning and lasering at 150 m
  fireRange: [230, 230, 230, 230],
}
// HOUSE_PARAMS (JSON) overrides any field above, for calibration sweeps
if (typeof process !== "undefined" && process.env.HOUSE_PARAMS) Object.assign(HOUSE, JSON.parse(process.env.HOUSE_PARAMS))

export const LOADOUTS: string[][][] = [
  [["gun"]],
  [["gun", "mortar"], ["gun", "lightning"], ["gun", "laser"]],
  [["gun", "laser"], ["gun", "lightning"]],
  [["laser", "lightning"], ["gun", "laser"]],
]

type Squad = { target: number; lastPos: number[] | null; lastSeen: number; lastIntel: number; kills0: number }
const squads = new WeakMap<Sim, Squad>()

function squadOf(sim: Sim): Squad {
  let s = squads.get(sim)
  if (!s) {
    const target = sim.mechs.find((m) => !m.ctl.name.startsWith("house"))?.id ?? 0
    s = { target, lastPos: null, lastSeen: -99, lastIntel: -99, kills0: 0 }
    squads.set(sim, s)
  }
  return s
}

function giveLoadout(sim: Sim, m: Mech) {
  const opts = LOADOUTS[m.tier]
  const pick = opts[Math.floor(sim.rand() * opts.length)]
  m.weapons = [null, null]
  pick.forEach((k, i) => (m.weapons[i] = sim.newWeapon(m, k)))
}

/** Walk along a nav path toward a point; caches the path on the mech. */
function walk(sim: Sim, m: Mech, goal: number[]): number[] {
  const a = m.aux
  if (!a.path || sim.t - a.pathT > 2.5 || Math.hypot(goal[0] - a.goal[0], goal[1] - a.goal[1]) > 10) {
    a.path = sim.nav.path(m.pos[0], m.pos[1], goal[0], goal[1], 20000, 1.6)
    a.pathT = sim.t
    a.goal = goal
    a.idx = 0
  }
  const p: number[] | null = a.path
  const nav = sim.nav
  if (!p || p.length < 2) {
    const d = Math.hypot(goal[0] - m.pos[0], goal[1] - m.pos[1]) || 1
    return [(goal[0] - m.pos[0]) / d, (goal[1] - m.pos[1]) / d]
  }
  while (a.idx < p.length - 1 && Math.hypot(nav.cx(nav.ci(p[a.idx])) - m.pos[0], nav.cy(nav.cj(p[a.idx])) - m.pos[1]) < 3) a.idx++
  const k = p[Math.min(p.length - 1, a.idx + 1)]
  const tx = nav.cx(nav.ci(k)), ty = nav.cy(nav.cj(k))
  const d = Math.hypot(tx - m.pos[0], ty - m.pos[1])
  if (d < 0.5) return [0, 0]
  return [(tx - m.pos[0]) / d, (ty - m.pos[1]) / d]
}

/** Move toward the next circle when it matters; returns a move or null. */
function zoneMove(sim: Sim, m: Mech): number[] | null {
  const z = sim.zone
  const d = Math.hypot(m.pos[0] - z.next_center[0], m.pos[1] - z.next_center[1])
  const want = z.next_radius * 0.7
  if (d <= want && sim.inZone(m.pos)) return null
  const timeLeft = z.shrink_end - sim.t
  if (sim.inZone(m.pos) && (d - want) / 11 + 15 < timeLeft) return null
  const g = d < 1 ? z.next_center : [z.next_center[0] + ((m.pos[0] - z.next_center[0]) / d) * want, z.next_center[1] + ((m.pos[1] - z.next_center[1]) / d) * want]
  return walk(sim, m, g)
}

/** Fire control shared by house and FFA bots: aim with tier noise and partial lead, fire what fits. */
function shoot(sim: Sim, m: Mech, tgt: Mech, act: Cmd) {
  const tier = m.tier
  const muzzle = [m.pos[0], m.pos[1], m.pos[2] + m.stats.muzzle_height]
  const c = [tgt.pos[0], tgt.pos[1], tgt.pos[2] + tgt.stats.height / 2]
  const d = Math.hypot(c[0] - muzzle[0], c[1] - muzzle[1])
  const los = sim.world.clear(muzzle, c)
  const hasGun = m.weapons.findIndex((w) => w?.kind === "gun")
  const sp = m.wstats.gun.speed
  const tt = interceptTime(muzzle, c, tgt.vel, sp)
  const lead = (tt > 0 ? tt : d / sp) * HOUSE.lead[tier]
  if (!m.aux.noise || sim.t - m.aux.noiseT > 0.4) {
    const s = (HOUSE.aimSigmaDeg[tier] * Math.PI) / 180
    m.aux.noise = [sim.gauss() * s, sim.gauss() * s]
    m.aux.noiseT = sim.t
  }
  const aim = aimAt(muzzle, [c[0] + tgt.vel[0] * lead, c[1] + tgt.vel[1] * lead, c[2]])
  act.aim = [aim[0] + m.aux.noise[0], aim[1] + m.aux.noise[1]]
  const err = Math.abs(wrap(m.aim[0] - act.aim[0])) + Math.abs(m.aim[1] - act.aim[1])
  const fire: [boolean, boolean] = [false, false]
  if (!los) {
    const mortar = m.weapons.findIndex((w) => w?.kind === "mortar")
    if (mortar >= 0 && d > 25 && d < 220) {
      const v = m.wstats.mortar.speed, g = m.wstats.mortar.gravity
      const disc = v ** 4 - g * (g * d * d + 2 * (c[2] - muzzle[2] - 2) * v * v)
      if (disc > 0) {
        act.aim = [aim[0] + m.aux.noise[0], Math.atan((v * v + Math.sqrt(disc)) / (g * d))]
        if (err < 0.1) fire[mortar] = true
      }
    }
    act.fire = fire
    return
  }
  m.weapons.forEach((w, s) => {
    if (!w) return
    if (w.kind === "gun" && d < HOUSE.fireRange[tier] && err < 0.06) fire[s] = true
    if (w.kind === "lightning" && d < 43 && err < 0.2) fire[s] = true
    if (w.kind === "laser") {
      if (w.charge > 0) fire[s] = !(w.charge >= m.wstats.laser.charge - 0.01 && err < 0.03)
      else fire[s] = d < m.wstats.laser.range * 0.97 && err < 0.2
    }
    if (w.kind === "mortar" && d > 25 && d < 200 && err < 0.05) {
      const v = m.wstats.mortar.speed, g = m.wstats.mortar.gravity
      const disc = v ** 4 - g * (g * d * d + 2 * (c[2] - muzzle[2] - 2) * v * v)
      if (disc > 0 && hasGun < 0) {
        act.aim = [aim[0], Math.atan((v * v - Math.sqrt(disc)) / (g * d))]
        fire[s] = true
      }
    }
  })
  act.fire = fire
}

function preferredRange(m: Mech): number {
  const k = m.weapons.map((w) => w?.kind)
  if (k.includes("lightning") && !k.includes("gun")) return 30
  if (k.includes("laser")) return 110
  return 70
}

function fightMove(sim: Sim, m: Mech, tgt: Mech): number[] {
  const dx = tgt.pos[0] - m.pos[0], dy = tgt.pos[1] - m.pos[1], d = Math.hypot(dx, dy) || 1
  const ux = dx / d, uy = dy / d
  const muzzle = [m.pos[0], m.pos[1], m.pos[2] + m.stats.muzzle_height]
  if (!sim.world.clear(muzzle, [tgt.pos[0], tgt.pos[1], tgt.pos[2] + 4.5])) return walk(sim, m, tgt.pos)
  if (!m.aux.strafeT || sim.t > m.aux.strafeT) {
    m.aux.strafe = sim.rand() < 0.5 ? -1 : 1
    m.aux.strafeT = sim.t + 0.8 + sim.rand() * 1.5
  }
  const radial = Math.max(-1, Math.min(1, (d - preferredRange(m)) / 25))
  const s = HOUSE.strafe[m.tier] * m.aux.strafe
  return [ux * radial - uy * s, uy * radial + ux * s]
}

/** The practice squad. */
export function houseController(): Controller {
  return {
    name: "house",
    wantsObs: false,
    act(sim, m) {
      const sq = squadOf(sim)
      if (!m.aux.armed) {
        giveLoadout(sim, m)
        m.aux.armed = true
      }
      if (m.offer) m.cmd.pick = 0
      const tgt = sim.mechs[sq.target]
      // shared vision: any house bot seeing the target tells all of them
      if (tgt.alive && sim.canSee(m, [tgt.pos[0], tgt.pos[1], tgt.pos[2] + 4.5], 9)) {
        sq.lastPos = [...tgt.pos]
        sq.lastSeen = sim.t
      }
      // who hunts: weakest first
      const killed = sim.mechs.filter((q) => q.ctl.name === "house" && !q.alive).length
      let n = sim.t >= HOUSE.joinStart ? 1 + HOUSE.joinPerKill * killed : 0
      if (sim.t >= HOUSE.lateAll) n = 15
      const order = sim.mechs.filter((q) => q.ctl.name === "house" && q.alive).sort((a, b) => a.tier - b.tier || a.id - b.id)
      const rank = order.indexOf(m)
      m.joined = rank >= 0 && rank < Math.max(0, n - killed)
      const act: Cmd = { aim: m.cmd.aim ?? m.aim, ...(m.offer ? { pick: 0 } : {}) }
      const zm = zoneMove(sim, m)
      if (m.joined && tgt.alive && sim.t - sq.lastIntel > HOUSE.intelEvery && sim.t - sq.lastSeen > HOUSE.intelEvery) {
        sq.lastIntel = sim.t
        sq.lastPos = [tgt.pos[0] + (sim.rand() - 0.5) * 40, tgt.pos[1] + (sim.rand() - 0.5) * 40, tgt.pos[2]]
      }
      const fresh = tgt.alive && sim.t - sq.lastSeen < sim.cfg.vision.memory_s
      if (m.joined && tgt.alive) {
        if (fresh) {
          shoot(sim, m, tgt, act)
          act.move = zm ?? fightMove(sim, m, tgt)
        } else if (sq.lastPos) {
          act.move = zm ?? walk(sim, m, sq.lastPos)
          act.aim = [Math.atan2(sq.lastPos[1] - m.pos[1], sq.lastPos[0] - m.pos[0]), 0]
        }
        act.boost = !sim.inZone(m.pos)
      } else {
        // idle: hold a spot inside the next circle; defend if the target is close and visible
        if (fresh && Math.hypot(tgt.pos[0] - m.pos[0], tgt.pos[1] - m.pos[1]) < 60) shoot(sim, m, tgt, act)
        if (zm) act.move = zm
        else {
          if (!m.aux.spot || sim.t - m.aux.spotT > 40) {
            m.aux.spot = sim.groundPoint(sim.zone.next_center, sim.zone.next_radius * 0.6)
            m.aux.spotT = sim.t
          }
          act.move = Math.hypot(m.aux.spot[0] - m.pos[0], m.aux.spot[1] - m.pos[1]) > 3 ? walk(sim, m, m.aux.spot) : [0, 0]
          if (!act.fire) act.aim = [m.aim[0] + 0.3, 0]
        }
        act.boost = !sim.inZone(m.pos)
      }
      // unstick
      const h = (m.aux.hist ??= [])
      h.push([m.pos[0], m.pos[1]])
      if (h.length > 12) h.shift()
      if (h.length === 12 && Math.hypot(h[0][0] - m.pos[0], h[0][1] - m.pos[1]) < 1 && act.move && Math.hypot(act.move[0], act.move[1]) > 0.5) {
        act.jump = true
        act.boost = true
        m.aux.path = null
      }
      return act
    },
  }
}

/** A free-for-all opponent: hunts whatever it sees, stays in the zone. */
export function ffaController(): Controller {
  return {
    name: "ffa",
    wantsObs: false,
    act(sim, m) {
      if (!m.aux.armed) {
        giveLoadout(sim, m)
        m.aux.armed = true
      }
      let tgt: Mech | null = null, bd = 160
      for (const o of sim.mechs) {
        if (!o.alive || o === m) continue
        const d = Math.hypot(o.pos[0] - m.pos[0], o.pos[1] - m.pos[1])
        if (d < bd && sim.canSee(m, [o.pos[0], o.pos[1], o.pos[2] + 4.5], 9)) {
          bd = d
          tgt = o
        }
      }
      const act: Cmd = { aim: m.cmd.aim ?? m.aim, ...(m.offer ? { pick: 0 } : {}) }
      const zm = zoneMove(sim, m)
      if (tgt) {
        shoot(sim, m, tgt, act)
        act.move = zm ?? fightMove(sim, m, tgt)
      } else {
        if (!m.aux.spot || sim.t - m.aux.spotT > 30) {
          m.aux.spot = sim.groundPoint(sim.zone.next_center, sim.zone.next_radius * 0.7)
          m.aux.spotT = sim.t
        }
        act.move = zm ?? walk(sim, m, m.aux.spot)
        act.aim = [m.aim[0] + 0.35, 0]
      }
      act.boost = !sim.inZone(m.pos)
      return act
    },
  }
}

/** Wrap a protocol bot (hello → act(obs)) as an in-process controller. */
export function botController(name: string, factory: (h: Hello) => { act(o: Observation): any }, mapDir: string): Controller {
  const ctl: Controller & { bot: { act(o: Observation): any } | null } = {
    name,
    wantsObs: true,
    bot: null,
    act(sim, m, obs) {
      if (!ctl.bot) {
        const h = sim.hello(m)
        h.map.dir = mapDir
        ctl.bot = factory(h)
      }
      return ctl.bot.act(obs!)
    },
  }
  return ctl
}

/** The kit's example bot (baseline 1.15 on the real practice board), for calibration. */
export function exampleFactory(hello: Hello) {
  return {
    act(obs: Observation) {
      const me = obs.self
      const [x, y, z] = me.pos
      const goal = obs.zone.next_center
      const act: any = {}
      if (obs.offer) act.pick = 0
      const near = obs.pickups.filter((p) => Math.hypot(p.pos[0] - x, p.pos[1] - y) < hello.config.loot.pickup_radius)
      if (me.weapons[1] === null && near.length && near[0].kind !== "gun") act.take = near[0].id
      const enemies = obs.mechs.filter((m) => m.kind === "mech").sort((a, b) => Math.hypot(a.pos[0] - x, a.pos[1] - y, a.pos[2] - z) - Math.hypot(b.pos[0] - x, b.pos[1] - y, b.pos[2] - z))
      const yaw = Math.atan2(goal[1] - y, goal[0] - x)
      Object.assign(act, { move: [Math.cos(yaw), Math.sin(yaw)], aim: [yaw, 0], boost: !me.in_zone, jump: obs.tick % 40 === 0 })
      if (enemies.length) {
        const t = enemies[0].pos
        act.aim = [Math.atan2(t[1] - y, t[0] - x), Math.atan2(t[2] - z - 2.5, Math.hypot(t[0] - x, t[1] - y, t[2] - z))]
        act.fire = [true, true]
      }
      return act
    },
  }
}
