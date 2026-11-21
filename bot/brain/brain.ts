/**
 * The bot's decision loop: remember what was seen, pick a behaviour, then move, aim and fire.
 * Survival first: stay ahead of the zone, fight only from health, break line of sight to regenerate.
 */
import type { Action, ActorObs, Hello, Observation, ZoneObs } from "../mechfight.ts"
import { draw } from "../mechfight.ts"
import { aimAt, aimError, ballisticPitch, ballisticTime, clamp, interceptTime, rng, wrap } from "../world/geom.ts"
import type { World } from "../world/map.ts"
import type { Nav } from "../world/nav.ts"
import type { Params } from "../params.ts"

type Track = {
  id: number
  kind: "mech" | "npc"
  pos: number[]
  vel: number[]
  hp: number
  maxHp: number
  cubes: number
  weapons: string[]
  aim: number[]
  charging: boolean
  seen: number
}
type Item = { id: number; pos: number[]; kind?: string; hp?: number; seen: number }
type Target = { id: number; pos: number[]; vel: number[]; height: number; radius: number; kind: "mech" | "npc" | "crate"; hp: number }

export type Circle = { x: number; y: number; r: number }

/** The zone circle at match time t (protocol.md section 9). */
export function zoneAt(z: ZoneObs, t: number): Circle {
  if (t <= z.shrink_start) return { x: z.center[0], y: z.center[1], r: z.radius }
  if (t >= z.shrink_end) return { x: z.next_center[0], y: z.next_center[1], r: z.next_radius }
  const f = (t - z.shrink_start) / Math.max(1e-6, z.shrink_end - z.shrink_start)
  return {
    x: z.center[0] + (z.next_center[0] - z.center[0]) * f,
    y: z.center[1] + (z.next_center[1] - z.center[1]) * f,
    r: z.radius + (z.next_radius - z.radius) * f,
  }
}

/** Index of the offered upgrade we like best. */
export function pickUpgrade(order: string[], ids: string[]): number {
  let best = 0, bestRank = Infinity
  ids.forEach((id, i) => {
    const r = order.indexOf(id)
    const rank = r < 0 ? 1000 + i : r
    if (rank < bestRank) {
      bestRank = rank
      best = i
    }
  })
  return best
}

export class Brain {
  name = "mech-royale"
  cfg: Hello["config"]
  me: number
  rand: () => number
  tracks = new Map<number, Track>()
  pickups = new Map<number, Item>()
  crates = new Map<number, Item>()
  // situation
  state = "start"
  lastHitT = -99 // last time we took damage
  lastHitBearing = 0
  lastHitBy: number | null = null
  heardT = -99
  heardBearing = 0
  kills = 0
  ffa = false
  // movement
  path: number[] | null = null
  pathIdx = 0
  pathGoal: number[] = [0, 0]
  pathT = -99
  hist: number[][] = []
  stuckUntil = -1
  stuckCount = 0
  blacklist: { k: number; until: number }[] = []
  strafeDir = 1
  strafeUntil = 0
  boosting = false
  // cover
  cover: number[] | null = null
  peek: number[] | null = null
  peekT = -99
  pathsThisTick = 0
  tickStart = 0
  coverT = -99
  camp: number[] | null = null
  campT = -99
  // laser
  laserHeld = 0
  curTarget = -1

  world: World
  nav: Nav
  P: Params

  constructor(hello: Hello, world: World, nav: Nav, P: Params) {
    this.world = world
    this.nav = nav
    this.P = P
    this.cfg = hello.config
    this.me = hello.slot
    this.rand = rng(hello.seed)
  }

  // ------------------------------------------------------------------ memory
  private remember(obs: Observation) {
    const t = obs.t
    for (const m of obs.mechs) {
      if (m.id === this.me) continue
      this.tracks.set(m.id, {
        id: m.id,
        kind: m.kind,
        pos: m.pos,
        vel: m.vel,
        hp: m.hp ?? this.tracks.get(m.id)?.hp ?? 1400,
        maxHp: m.max_hp ?? 1400,
        cubes: m.cubes ?? 0,
        weapons: m.weapons ?? [],
        aim: m.aim,
        charging: !!m.charging,
        seen: t,
      })
    }
    for (const [id, tr] of this.tracks) if (t - tr.seen > 12) this.tracks.delete(id)
    for (const p of obs.pickups) this.pickups.set(p.id, { id: p.id, pos: p.pos, kind: p.kind, seen: t })
    for (const c of obs.crates) this.crates.set(c.id, { id: c.id, pos: c.pos, hp: c.hp, seen: t })
    const [x, y] = obs.self.pos
    // forget loot we should be seeing but don't (taken or destroyed)
    const visP = new Set(obs.pickups.map((p) => p.id))
    for (const [id, p] of this.pickups) if (!visP.has(id) && Math.hypot(p.pos[0] - x, p.pos[1] - y) < 30) this.pickups.delete(id)
    const visC = new Set(obs.crates.map((c) => c.id))
    for (const [id, c] of this.crates) if (!visC.has(id) && Math.hypot(c.pos[0] - x, c.pos[1] - y) < 30) this.crates.delete(id)
    for (const e of obs.events) {
      if (e.type === "damaged" && e.weapon !== "zone") {
        this.lastHitT = t
        if (e.bearing !== null) this.lastHitBearing = e.bearing
        this.lastHitBy = e.by
      } else if (e.type === "kill") this.kills++
      else if (e.type === "take_failed" && (e.reason === "gone" || e.reason === "have")) this.pickups.delete(e.id)
      else if (e.type === "took") this.pickups.delete(e.id)
    }
    for (const s of obs.sounds) {
      if (s.dist === "far") continue
      if (["gun", "laser", "laser_charge", "lightning", "step", "boost", "jet", "reload"].includes(s.kind)) {
        this.heardT = t
        this.heardBearing = s.bearing
      }
    }
    // other mechs died that we did not kill: a free-for-all, not the practice squad
    if (16 - obs.alive > this.kills + 1) this.ffa = true
  }

  private hostiles(t: number): Track[] {
    const out: Track[] = []
    for (const tr of this.tracks.values()) if (tr.kind === "mech" && t - tr.seen < 0.3) out.push(tr)
    return out
  }

  // ------------------------------------------------------------------ helpers
  private eye(obs: Observation): number[] {
    const s = obs.self
    return [s.pos[0], s.pos[1], s.pos[2] + (s.stats.eye_height ?? 8)]
  }
  private muzzle(obs: Observation): [number, number, number] {
    const s = obs.self
    return [s.pos[0], s.pos[1], s.pos[2] + (s.stats.muzzle_height ?? 7)]
  }
  private weapon(obs: Observation, kind: string): number {
    const w = obs.self.weapons
    return w[0]?.kind === kind ? 0 : w[1]?.kind === kind ? 1 : -1
  }
  private targetOf(tr: Track): Target {
    const s = 1 + (this.cfg.cubes.size_per_cube as number) * tr.cubes
    return tr.kind === "mech"
      ? { id: tr.id, pos: tr.pos, vel: tr.vel, height: 9 * s, radius: 2.5 * s, kind: "mech", hp: tr.hp }
      : { id: tr.id, pos: tr.pos, vel: tr.vel, height: 3.5, radius: 1.8, kind: "npc", hp: tr.hp }
  }
  private center(tg: Target): [number, number, number] {
    return [tg.pos[0], tg.pos[1], tg.pos[2] + tg.height * 0.5]
  }
  private canHit(obs: Observation, tg: Target): boolean {
    return this.world.clear(this.muzzle(obs), this.center(tg))
  }

  // ------------------------------------------------------------------ main
  act(obs: Observation): Action {
    const act: Action = { tick: obs.tick }
    this.pathsThisTick = 0
    this.tickStart = performance.now()
    const me = obs.self
    const t = obs.t
    this.remember(obs)
    const P = this.P
    if (obs.offer) act.pick = pickUpgrade(P.upgradeOrder, obs.offer.choices.map((c) => c.id))

    const hpFrac = me.hp / me.max_hp
    const hostiles = this.hostiles(t)
    const zNow = zoneAt(obs.zone, t)
    const [x, y] = me.pos

    // ---------------- choose a combat target among mechs we can see
    let target: Target | null = null
    let bestScore = Infinity
    for (const h of hostiles) {
      const tg = this.targetOf(h)
      const d = Math.hypot(h.pos[0] - x, h.pos[1] - y)
      const los = this.canHit(obs, tg)
      const score =
        d * 0.6 + h.hp * this.P.targetHpWeight - (los ? 120 : 0) - (h.id === this.lastHitBy && t - this.lastHitT < 3 ? 40 : 0) - (h.id === this.curTarget && los ? this.P.targetStick : 0)
      if (score < bestScore) {
        bestScore = score
        target = tg
      }
    }
    this.curTarget = target ? target.id : -1
    const hostileCount = hostiles.filter((h) => Math.hypot(h.pos[0] - x, h.pos[1] - y) < 220).length
    const recentlyHit = t - this.lastHitT < 4

    // ---------------- zone pressure
    const next: Circle = { x: obs.zone.next_center[0], y: obs.zone.next_center[1], r: obs.zone.next_radius }
    const dNext = Math.hypot(x - next.x, y - next.y)
    const speed = me.stats.walk_speed ?? 11.7
    const want = next.r * P.zoneFrac
    const toSafe = Math.max(0, dNext - want)
    const timeLeft = obs.zone.shrink_end - t
    const zoneTarget =
      dNext <= want ? null : [next.x + ((x - next.x) / (dNext || 1)) * want, next.y + ((y - next.y) / (dNext || 1)) * want]
    const outside = !me.in_zone || Math.hypot(x - zNow.x, y - zNow.y) > zNow.r - 3
    const zoneUrgent = outside || (zoneTarget !== null && (toSafe * 1.4) / speed + P.zoneSlack > timeLeft)

    // ---------------- pick a behaviour
    let goal: number[] | null = null
    let face: number[] | null = null // yaw-only facing target (x, y)
    let fightTarget: Target | null = null
    let silent = false
    let wantBoost = false
    let mode = "roam"

    // hostiles that can shoot us right now raise the bar for staying in a fight
    const exposed = hostiles.filter((h) => this.world.clear([h.pos[0], h.pos[1], h.pos[2] + 7], [x, y, me.pos[2] + 4.5])).length
    const canFight =
      hpFrac >= P.retreatHp + P.retreatPerExtra * Math.max(0, exposed - 1) && (hostileCount < P.outnumbered || hpFrac >= P.outnumberedHp)
    if (zoneUrgent && zoneTarget) {
      mode = "zone"
      goal = zoneTarget
      fightTarget = target
      wantBoost = true
    } else if (target && canFight && !(this.state === "regen" && hpFrac < P.reengageHp && !recentlyHit)) {
      mode = "fight"
      fightTarget = target
    } else if ((target || recentlyHit) && !canFight) {
      mode = "retreat"
      const cov = this.findCover(obs, hostiles, zNow, next)
      goal = cov
      fightTarget = target
      wantBoost = true
    } else if (hpFrac < P.reengageHp && (this.state === "retreat" || this.state === "regen")) {
      mode = "regen"
      silent = true
      face = [x + Math.cos(this.lastHitBearing) * 50, y + Math.sin(this.lastHitBearing) * 50]
    }

    if (mode === "roam") {
      const loot = this.chooseLoot(obs)
      const drop = this.chooseDrop(obs, hostileCount)
      const cube = this.nearestCube(obs)
      const npc = !this.ffa || hostileCount === 0 ? this.chooseNpc(obs, hpFrac) : null
      const crate = this.chooseCrate(obs, hpFrac)
      if (cube) {
        mode = "cube"
        goal = cube
      } else if (loot && loot.d < 25) {
        mode = "loot"
        goal = loot.pos
      } else if (drop) {
        mode = "drop"
        goal = drop
        wantBoost = true
      } else if (loot) {
        mode = "loot"
        goal = loot.pos
      } else if (npc) {
        mode = "farm"
        fightTarget = npc
      } else if (crate) {
        mode = "crate"
        fightTarget = crate
      } else if (zoneTarget) {
        mode = "rotate"
        goal = zoneTarget
      } else {
        mode = "hold"
        goal = this.campSpot(obs, next)
        silent = true
      }
    }
    this.state = mode

    // ---------------- movement
    let move: number[] = [0, 0]
    if (fightTarget && !goal) {
      move = this.fightMove(obs, fightTarget)
      // grab cubes lying close by while fighting (kill drops)
      const cube = this.nearestCube(obs)
      if (cube && Math.hypot(cube[0] - x, cube[1] - y) < P.fightCubeRange && hpFrac > P.retreatHp) {
        goal = cube
        move = this.follow(obs, cube)
      }
    } else if (goal) {
      const d = Math.hypot(goal[0] - x, goal[1] - y)
      move = d < 1.5 ? [0, 0] : this.follow(obs, goal)
      if (d > P.boostDist) wantBoost = true
      if (silent && d < 6) move = [move[0] * 0.4, move[1] * 0.4]
    }
    const dodge = this.dodge(obs)
    if (dodge[0] || dodge[1]) move = [move[0] + dodge[0] * 1.6, move[1] + dodge[1] * 1.6]
    const ml = Math.hypot(move[0], move[1])
    if (ml > 1) move = [move[0] / ml, move[1] / ml]

    // energy hysteresis for boosting; keep some energy for unsticking
    if (this.boosting && me.energy < P.boostOff) this.boosting = false
    else if (!this.boosting && me.energy > P.boostOn) this.boosting = true
    act.boost = wantBoost && this.boosting && ml > 0.3

    // unstick: commanded to move but barely moved for a second
    this.hist.push([x, y, t, ml])
    if (this.hist.length > 11) this.hist.shift()
    if (t < this.stuckUntil) {
      act.jump = me.grounded
      act.boost = true
    } else if (this.hist.length === 11 && this.hist.every((h) => h[3] > 0.5)) {
      const h0 = this.hist[0]
      if (Math.hypot(x - h0[0], y - h0[1]) < 1.0) {
        this.stuckCount++
        this.stuckUntil = t + 0.6
        act.jump = true
        act.boost = true
        this.hist.length = 0
        if (this.stuckCount % 2 === 0 && this.path) {
          // blacklist the cell we were heading into and replan
          const k = this.path[Math.min(this.path.length - 1, this.pathIdx + 1)]
          if (k !== undefined) {
            this.nav.blocked[k] = 1
            this.blacklist.push({ k, until: t + 20 })
          }
          this.pathT = -99
        }
      }
    }
    this.blacklist = this.blacklist.filter((b) => {
      if (t < b.until) return true
      this.nav.blocked[b.k] = 0
      return false
    })
    act.move = [move[0], move[1]]

    // ---------------- aim and fire
    this.aimAndFire(obs, act, fightTarget, face, move)

    // ---------------- loot actions
    this.takeNearby(obs, act)
    if (!fightTarget) {
      const gun = this.weapon(obs, "gun")
      const g = gun >= 0 ? me.weapons[gun] : null
      if (g && g.ammo !== undefined && g.reload === 0 && g.ammo < (g.stats.mag ?? 12) * 0.5) act.reload = true
    }

    // ---------------- debug
    draw.label(`${mode}${this.ffa ? " ffa" : ""} hp ${Math.round(me.hp)}/${Math.round(me.max_hp)} e ${Math.round(me.energy)}${fightTarget ? ` → ${fightTarget.id}` : ""}`)
    if (goal) draw.point([goal[0], goal[1], me.pos[2] + 1], "#40c0ff", 5)
    if (fightTarget) draw.line(this.muzzle(obs), this.center(fightTarget), "#ff5040")
    return act
  }

  // ------------------------------------------------------------------ behaviours
  private chooseLoot(obs: Observation): { pos: number[]; d: number } | null {
    const P = this.P
    const held = obs.self.weapons.map((w) => w?.kind ?? null)
    const worst = held.some((h) => h === null) ? 0 : Math.min(...held.map((h) => P.weaponPref[h!] ?? 0))
    const [x, y] = obs.self.pos
    let best: { pos: number[]; d: number } | null = null
    let bestV = 0
    for (const p of this.pickups.values()) {
      if (held.includes(p.kind as any)) continue
      const gain = (P.weaponPref[p.kind!] ?? 0) - worst
      if (gain < P.swapGain) continue
      const d = Math.hypot(p.pos[0] - x, p.pos[1] - y)
      if (d > P.lootRange) continue
      if (Math.abs(p.pos[2] - this.nav.h[this.nav.nearestGround(p.pos[0], p.pos[1], 0)]) > 3 && this.nav.roof[this.nav.cell(p.pos[0], p.pos[1])]) continue // on a roof
      const v = gain / (1 + d / 50)
      if (v > bestV) {
        bestV = v
        best = { pos: p.pos, d }
      }
    }
    return best
  }

  private takeNearby(obs: Observation, act: Action) {
    const P = this.P
    const me = obs.self
    const held = me.weapons.map((w) => w?.kind ?? null)
    for (const w of me.weapons) if (w?.kind === "laser" && (w.charge ?? 0) > 0) return
    const reach = (this.cfg.loot.pickup_radius ?? 4) - 0.4
    for (const p of obs.pickups) {
      if (Math.hypot(p.pos[0] - me.pos[0], p.pos[1] - me.pos[1]) > reach || Math.abs(p.pos[2] - me.pos[2]) > 3.8) continue
      if (held.includes(p.kind)) continue
      const v = P.weaponPref[p.kind] ?? 0
      if (held[1] === null) {
        act.take = p.id
        return
      }
      if (held[0] === null) {
        act.take = p.id
        return
      }
      const w0 = P.weaponPref[held[0]!] ?? 0, w1 = P.weaponPref[held[1]!] ?? 0
      const slot = w0 <= w1 ? 0 : 1
      if (v - Math.min(w0, w1) >= P.swapGain) {
        act.take = p.id
        act.drop = slot
        return
      }
    }
  }

  private nearestCube(obs: Observation): number[] | null {
    const [x, y] = obs.self.pos
    let best: number[] | null = null
    let bd = this.P.cubeRange
    for (const c of obs.cubes) {
      const d = Math.hypot(c.pos[0] - x, c.pos[1] - y)
      if (d < bd) {
        bd = d
        best = c.pos
      }
    }
    return best
  }

  private chooseNpc(obs: Observation, hpFrac: number): Target | null {
    if (obs.t > this.P.farmUntil || hpFrac < this.P.farmHp) return null
    const [x, y] = obs.self.pos
    let best: Target | null = null
    let bd = this.P.npcRange
    for (const tr of this.tracks.values()) {
      if (tr.kind !== "npc" || obs.t - tr.seen > 0.3) continue
      const d = Math.hypot(tr.pos[0] - x, tr.pos[1] - y)
      if (d < bd) {
        bd = d
        best = this.targetOf(tr)
      }
    }
    return best
  }

  private chooseCrate(obs: Observation, hpFrac: number): Target | null {
    if (obs.t > this.P.farmUntil || hpFrac < this.P.farmHp) return null
    const [x, y] = obs.self.pos
    let best: Target | null = null
    let bd = this.P.crateRange
    for (const c of obs.crates) {
      const d = Math.hypot(c.pos[0] - x, c.pos[1] - y)
      if (d < bd) {
        const tg: Target = { id: c.id, pos: c.pos, vel: [0, 0, 0], height: 2.4, radius: 1.4, kind: "crate", hp: c.hp ?? 300 }
        if (!this.canHit(obs, tg)) continue
        bd = d
        best = tg
      }
    }
    return best
  }

  private chooseDrop(obs: Observation, hostileCount: number): number[] | null {
    if (hostileCount > 0) return null
    const [x, y] = obs.self.pos
    const speed = obs.self.stats.walk_speed ?? 11.7
    for (const d of obs.drops) {
      if (d.holder !== null && d.holder !== this.me) continue
      const dist = Math.hypot(d.pos[0] - x, d.pos[1] - y)
      if (dist > this.P.dropMaxDist) continue
      if (dist / speed > d.lands_in + this.P.dropSlack) continue
      return d.pos
    }
    return null
  }

  /** A quiet spot next to a wall inside the next circle; re-picked every 15 s. */
  private campSpot(obs: Observation, next: Circle): number[] {
    const [x, y] = obs.self.pos
    if (this.camp && obs.t - this.campT < 15 && Math.hypot(this.camp[0] - next.x, this.camp[1] - next.y) < next.r * this.P.zoneFrac) return this.camp
    const nav = this.nav
    const k0 = nav.cell(x, y)
    const i0 = nav.ci(k0), j0 = nav.cj(k0)
    let best: number[] = [x, y]
    let bd = Infinity
    for (let dj = -12; dj <= 12; dj++)
      for (let di = -12; di <= 12; di++) {
        const i = i0 + di, j = j0 + dj
        if (i < 0 || j < 0 || i >= nav.nx || j >= nav.ny) continue
        const k = j * nav.nx + i
        if (!nav.wall[k] || nav.roof[k] || nav.blocked[k]) continue
        const cx = nav.cx(i), cy = nav.cy(j)
        if (Math.hypot(cx - next.x, cy - next.y) > next.r * this.P.zoneFrac) continue
        const d = Math.hypot(di, dj)
        if (d < bd) {
          bd = d
          best = [cx, cy]
        }
      }
    this.camp = best
    this.campT = obs.t
    return best
  }

  /** Nearest reachable point that the tracked hostiles cannot see, staying in the zone. */
  private findCover(obs: Observation, hostiles: Track[], zNow: Circle, next: Circle): number[] {
    const t = obs.t
    if (this.cover && t - this.coverT < 1.0) return this.cover
    const [x, y] = obs.self.pos
    const threats: number[][] = []
    for (const tr of this.tracks.values()) if (tr.kind === "mech" && t - tr.seen < 5) threats.push([tr.pos[0], tr.pos[1], tr.pos[2] + 8])
    threats.sort((a, b) => Math.hypot(a[0] - x, a[1] - y) - Math.hypot(b[0] - x, b[1] - y))
    threats.length = Math.min(threats.length, 4)
    if (!threats.length && t - this.lastHitT < 5) threats.push([x + Math.cos(this.lastHitBearing) * 80, y + Math.sin(this.lastHitBearing) * 80, obs.self.pos[2] + 8])
    let best: number[] = [x - Math.cos(this.lastHitBearing) * 30, y - Math.sin(this.lastHitBearing) * 30]
    let bestS = Infinity
    const safeR = Math.max(zNow.r, next.r)
    for (const r of [8, 16, 26, 40, 56]) {
      for (let a = 0; a < 16; a++) {
        const ang = (a / 16) * Math.PI * 2
        const px = x + Math.cos(ang) * r, py = y + Math.sin(ang) * r
        const k = this.nav.cell(px, py)
        if (this.nav.roof[k] || this.nav.blocked[k]) continue
        if (Math.hypot(px - zNow.x, py - zNow.y) > zNow.r - 5 && Math.hypot(px - next.x, py - next.y) > safeR) continue
        const pz = this.nav.h[k] + 4.5
        let seen = 0
        for (const th of threats) {
          if (r + seen * 200 >= bestS) break
          if (this.world.clear(th, [px, py, pz])) seen++
        }
        // moving toward a threat is worse than away
        let toward = 0
        for (const th of threats) {
          const dOld = Math.hypot(th[0] - x, th[1] - y), dNew = Math.hypot(th[0] - px, th[1] - py)
          if (dNew < dOld) toward += (dOld - dNew) * 0.8
        }
        const s = r + seen * 200 + toward
        if (s < bestS) {
          bestS = s
          best = [px, py]
        }
      }
    }
    if (bestS >= 200 && threats.length) {
      // nowhere hidden nearby: run directly away from the threats' centre, toward the zone
      let ax = 0, ay = 0
      for (const th of threats) {
        const d = Math.hypot(x - th[0], y - th[1]) || 1
        ax += (x - th[0]) / d
        ay += (y - th[1]) / d
      }
      const zx = next.x - x, zy = next.y - y, zd = Math.hypot(zx, zy) || 1
      ax += (zx / zd) * 0.5
      ay += (zy / zd) * 0.5
      const al = Math.hypot(ax, ay) || 1
      best = [x + (ax / al) * 40, y + (ay / al) * 40]
    }
    this.cover = best
    this.coverT = t
    return best
  }

  // ------------------------------------------------------------------ movement
  private follow(obs: Observation, goal: number[]): number[] {
    const [x, y] = obs.self.pos
    const t = obs.t
    const nav = this.nav
    const moved = Math.hypot(goal[0] - this.pathGoal[0], goal[1] - this.pathGoal[1])
    const budgetOk = this.pathsThisTick === 0 && performance.now() - this.tickStart < this.P.pathBudgetMs
    if ((!this.path || moved > 6 || t - this.pathT > 3) && !budgetOk && (!this.path || moved > 30)) return this.dirTo(x, y, goal[0], goal[1])
    if ((!this.path || moved > 6 || t - this.pathT > 3) && budgetOk) {
      this.pathsThisTick++
      this.path = nav.path(x, y, goal[0], goal[1], this.P.pathExpand)
      this.pathIdx = 0
      this.pathGoal = goal
      this.pathT = t
    }
    const path = this.path
    if (!path || path.length < 2) return this.dirTo(x, y, goal[0], goal[1])
    // drop passed waypoints: the closest path cell to us within the next few
    let bi = this.pathIdx, bd = Infinity
    for (let i = this.pathIdx; i < Math.min(path.length, this.pathIdx + 12); i++) {
      const d = Math.hypot(nav.cx(nav.ci(path[i])) - x, nav.cy(nav.cj(path[i])) - y)
      if (d < bd) {
        bd = d
        bi = i
      }
    }
    this.pathIdx = bi
    if (bd > 8) {
      this.pathT = -99 // off the path: replan next time
    }
    // look ahead to the farthest cell we can walk straight to
    let li = Math.min(path.length - 1, bi + 1)
    for (let i = Math.min(path.length - 1, bi + 10); i > bi + 1; i--) {
      if (nav.lineWalkable(x, y, nav.cx(nav.ci(path[i])), nav.cy(nav.cj(path[i])))) {
        li = i
        break
      }
    }
    const k = path[li]
    if (li === path.length - 1) return this.dirTo(x, y, goal[0], goal[1])
    return this.dirTo(x, y, nav.cx(nav.ci(k)), nav.cy(nav.cj(k)))
  }

  private dirTo(x: number, y: number, tx: number, ty: number): number[] {
    const d = Math.hypot(tx - x, ty - y)
    return d < 1e-6 ? [0, 0] : [(tx - x) / d, (ty - y) / d]
  }

  /**
   * A nearby point with line of fire to `tg` that the fewest other hostiles can see, near our
   * preferred range. Re-chosen every 0.5 s. Null when standing here is as good as any.
   */
  private peekSpot(obs: Observation, tg: Target, pref: number): number[] | null {
    const t = obs.t
    if (t - this.peekT < 0.5) return this.peek
    this.peekT = t
    const [x, y] = obs.self.pos
    const others: number[][] = []
    for (const tr of this.tracks.values()) if (tr.kind === "mech" && tr.id !== tg.id && t - tr.seen < 5) others.push([tr.pos[0], tr.pos[1], tr.pos[2] + 7])
    others.sort((a, b) => Math.hypot(a[0] - x, a[1] - y) - Math.hypot(b[0] - x, b[1] - y))
    others.length = Math.min(others.length, 4)
    const c = this.center(tg)
    const score = (px: number, py: number, pz: number): number => {
      if (!this.world.clear([px, py, pz + 7], c)) return Infinity
      let s = 0
      for (const o of others) if (this.world.clear(o, [px, py, pz + 4.5])) s += 100
      const d = Math.hypot(c[0] - px, c[1] - py)
      return s + Math.abs(d - pref) * 0.3 + Math.hypot(px - x, py - y) * 0.5
    }
    const here = score(x, y, obs.self.pos[2])
    if (!others.length && here < Infinity) {
      this.peek = null
      return null
    }
    let best: number[] | null = null
    let bestS = here - 20
    for (const r of [6, 12, 20, 30]) {
      for (let a = 0; a < 12; a++) {
        const ang = (a / 12) * Math.PI * 2 + r
        const px = x + Math.cos(ang) * r, py = y + Math.sin(ang) * r
        const k = this.nav.cell(px, py)
        if (this.nav.roof[k] || this.nav.blocked[k]) continue
        const s = score(px, py, this.nav.h[k])
        if (s < bestS) {
          bestS = s
          best = [px, py]
        }
      }
    }
    this.peek = best
    return best
  }

  /** Keep the preferred range for our weapons and strafe across the line of fire. */
  private fightMove(obs: Observation, tg: Target): number[] {
    const P = this.P
    const [x, y] = obs.self.pos
    const dx = tg.pos[0] - x, dy = tg.pos[1] - y
    const d = Math.hypot(dx, dy) || 1
    const ux = dx / d, uy = dy / d
    const kinds = obs.self.weapons.map((w) => w?.kind)
    let pref = P.rangeGun
    if (kinds.includes("laser")) pref = P.rangeLaser
    if (kinds.includes("mortar") && !kinds.includes("gun") && !kinds.includes("laser")) pref = P.rangeMortar
    if (kinds.includes("lightning") && (tg.kind !== "mech" || d < 70 || !kinds.includes("laser"))) pref = P.rangeLightning
    if (tg.kind === "npc") pref = Math.max(pref, 50)
    if (tg.kind === "crate") pref = Math.min(Math.max(pref, 20), 40)
    // fight from a spot where the target can be shot but other hostiles can't see us
    if (tg.kind === "mech") {
      const spot = this.peekSpot(obs, tg, pref)
      if (spot && Math.hypot(spot[0] - x, spot[1] - y) > 2) return this.follow(obs, spot)
    }
    // can't shoot it from here: walk to it
    if (!this.canHit(obs, tg)) return this.follow(obs, tg.pos)
    if (obs.t > this.strafeUntil) {
      this.strafeDir = this.rand() < 0.5 ? -1 : 1
      this.strafeUntil = obs.t + 0.6 + this.rand() * 1.2
    }
    const radial = clamp((d - pref) / 25, -1, 1)
    let mx = ux * radial - uy * this.strafeDir * 0.9
    let my = uy * radial + ux * this.strafeDir * 0.9
    // don't strafe into walls
    const ahead = this.nav.cell(x + mx * 4, y + my * 4)
    if (!this.nav.passable(this.nav.cell(x, y), ahead, 4) || this.nav.wall[ahead]) {
      this.strafeDir = -this.strafeDir
      mx = ux * radial - uy * this.strafeDir * 0.9
      my = uy * radial + ux * this.strafeDir * 0.9
    }
    if (tg.kind === "crate") return d > pref ? this.follow(obs, tg.pos) : [0, 0]
    return [mx, my]
  }

  /** Sidestep projectiles and mortar impacts heading for us; sidestep a laser aimed at us. */
  private dodge(obs: Observation): number[] {
    const me = obs.self
    const c = [me.pos[0], me.pos[1], me.pos[2] + 4.5]
    let ox = 0, oy = 0
    for (const p of obs.projectiles) {
      if (p.kind === "mortar") {
        const g = (this.cfg.weapons.mortar.gravity as number) ?? 22
        // time to fall to our feet height
        const a = -0.5 * g, b = p.vel[2], cc = p.pos[2] - me.pos[2]
        const disc = b * b - 4 * a * cc
        if (disc < 0) continue
        const tl = (-b - Math.sqrt(disc)) / (2 * a)
        if (tl <= 0 || tl > 4) continue
        const lx = p.pos[0] + p.vel[0] * tl, ly = p.pos[1] + p.vel[1] * tl
        const d = Math.hypot(me.pos[0] - lx, me.pos[1] - ly)
        const R = ((this.cfg.weapons.mortar.splash_radius as number) ?? 7) + 3.5
        if (d < R) {
          ox += (me.pos[0] - lx) / (d || 1)
          oy += (me.pos[1] - ly) / (d || 1)
        }
        continue
      }
      const rx = c[0] - p.pos[0], ry = c[1] - p.pos[1], rz = c[2] - p.pos[2]
      const v2 = p.vel[0] ** 2 + p.vel[1] ** 2 + p.vel[2] ** 2
      if (v2 < 1) continue
      const tc = (rx * p.vel[0] + ry * p.vel[1] + rz * p.vel[2]) / v2
      if (tc <= 0 || tc > 0.8) continue
      const qx = rx - p.vel[0] * tc, qy = ry - p.vel[1] * tc
      const miss = Math.hypot(qx, qy)
      if (miss < 4.5) {
        // move to widen the miss distance; if dead-on, go perpendicular
        if (miss > 0.2) {
          ox += qx / miss
          oy += qy / miss
        } else {
          const vl = Math.hypot(p.vel[0], p.vel[1]) || 1
          ox += -p.vel[1] / vl
          oy += p.vel[0] / vl
        }
      }
    }
    for (const tr of this.tracks.values()) {
      if (tr.kind !== "mech" || !tr.charging || obs.t - tr.seen > 0.3) continue
      const bx = me.pos[0] - tr.pos[0], by = me.pos[1] - tr.pos[1]
      const d = Math.hypot(bx, by) || 1
      const off = Math.abs(wrap(Math.atan2(by, bx) - tr.aim[0]))
      if (off < Math.atan2(6, d)) {
        ox += (-by / d) * this.strafeDir
        oy += (bx / d) * this.strafeDir
      }
    }
    const l = Math.hypot(ox, oy)
    return l > 0 ? [ox / l, oy / l] : [0, 0]
  }

  // ------------------------------------------------------------------ aiming and firing
  private aimAndFire(obs: Observation, act: Action, tg: Target | null, face: number[] | null, move: number[]) {
    const me = obs.self
    const W = me.weapons
    const t = obs.t
    act.fire = [false, false]
    const muzzle = this.muzzle(obs)
    if (!tg) {
      // no target: face whoever hit us or what we heard, else sweep the view around our heading
      let yaw: number
      if (t - this.lastHitT < 3) yaw = this.lastHitBearing
      else if (face) yaw = Math.atan2(face[1] - me.pos[1], face[0] - me.pos[0])
      else if (t - this.heardT < 2) yaw = this.heardBearing
      else {
        const heading = Math.hypot(move[0], move[1]) > 0.2 ? Math.atan2(move[1], move[0]) : me.aim[0]
        yaw = heading + Math.sin(t * 1.3) * 1.2
        if (Math.hypot(move[0], move[1]) <= 0.2) yaw = me.aim[0] + 0.35
      }
      act.aim = [wrap(yaw), 0]
      // a laser charge with nothing to shoot: let it go
      this.laserHeld = 0
      return
    }
    const c = this.center(tg)
    const d = Math.hypot(c[0] - muzzle[0], c[1] - muzzle[1])
    const los = this.world.clear(muzzle, c)
    const tol = Math.atan2(tg.radius * 0.75, Math.max(d, 1)) + 0.002

    const slot = (k: string): number => (W[0]?.kind === k ? 0 : W[1]?.kind === k ? 1 : -1)
    const sLaser = slot("laser"), sLight = slot("lightning"), sGun = slot("gun"), sMortar = slot("mortar")
    const st = (s: number) => W[s]!.stats

    // desired aims per weapon
    let aim: number[] | null = null
    let primary = ""
    if (sLight >= 0 && d <= (st(sLight).range ?? 45) * 0.95 && los && me.energy >= (st(sLight).energy ?? 3) * 2) {
      primary = "lightning"
      aim = aimAt(muzzle, c)
    } else if (sLaser >= 0 && d <= (st(sLaser).range ?? 280) * 0.97 && los && (W[sLaser]!.cooldown < 0.4 || (W[sLaser]!.charge ?? 0) > 0)) {
      primary = "laser"
      aim = aimAt(muzzle, c)
    } else if (sGun >= 0 && d <= (st(sGun).range ?? 230) * 0.95 && los) {
      primary = "gun"
      const sp = st(sGun).speed ?? 252
      const tt = interceptTime(muzzle, c, tg.vel, sp)
      const tl = tt > 0 ? tt : d / sp
      aim = aimAt(muzzle, [c[0] + tg.vel[0] * tl, c[1] + tg.vel[1] * tl, c[2] + (tg.kind === "mech" ? 0 : tg.vel[2] * tl)])
    } else if (sMortar >= 0 && d > 22 && d < 230) {
      primary = "mortar"
      aim = this.mortarAim(obs, tg, !los)
    }
    if (!aim) {
      // nothing can shoot it now: face it, ready
      act.aim = aimAt(muzzle, c)
      if (sLaser >= 0 && (W[sLaser]!.charge ?? 0) > 0) act.fire[sLaser] = true // keep a charge while we close in
      return
    }
    act.aim = [aim[0], clamp(aim[1], me.stats.min_pitch ?? -0.7, me.stats.max_pitch ?? 1.3)]
    const err = aimError(me.aim, act.aim)

    if (sLight >= 0 && primary === "lightning") {
      const cone = ((st(sLight).cone_deg ?? 30) * Math.PI) / 360
      if (Math.abs(wrap(me.aim[0] - aim[0])) < cone * 0.7) act.fire[sLight] = true
    }
    if (sGun >= 0 && los && d <= (st(sGun).range ?? 230)) {
      const sp = st(sGun).speed ?? 252
      const tt = interceptTime(muzzle, c, tg.vel, sp)
      const tl = tt > 0 ? tt : d / sp
      const gAim = aimAt(muzzle, [c[0] + tg.vel[0] * tl, c[1] + tg.vel[1] * tl, c[2]])
      if (aimError(me.aim, gAim) < tol + ((st(sGun).spread_deg ?? 0.6) * Math.PI) / 360 && (W[sGun]!.ammo ?? 1) > 0) act.fire[sGun] = true
    }
    if (sLaser >= 0) {
      const lw = W[sLaser]!
      const full = st(sLaser).charge ?? 0.75
      const charge = lw.charge ?? 0
      if (charge > 0) {
        this.laserHeld++
        const ready = charge >= full - 0.05
        const onTarget = los && aimError(me.aim, aimAt(muzzle, c)) < tol
        // hold while charging; release when full and on target (or when the target is lost and the charge is wasting)
        act.fire[sLaser] = !(ready && onTarget)
        if (ready && !los && this.laserHeld > 25) act.fire[sLaser] = false
      } else {
        this.laserHeld = 0
        if (lw.cooldown <= 0 && los && d <= (st(sLaser).range ?? 280) * 0.97 && primary === "laser" && err < 0.25) act.fire[sLaser] = true
      }
    }
    if (sMortar >= 0 && primary === "mortar" && W[sMortar]!.cooldown <= 0 && err < 0.02) act.fire[sMortar] = true
  }

  private mortarAim(obs: Observation, tg: Target, high: boolean): number[] | null {
    const me = obs.self
    const m = this.cfg.weapons.mortar
    const w = me.weapons.find((x) => x?.kind === "mortar")
    const v = (w?.stats.speed ?? (m.speed as number)) || 72
    const g = (m.gravity as number) ?? 22
    const tube = [me.pos[0], me.pos[1], me.pos[2] + (me.stats.height ?? 9) + 0.5]
    let px = tg.pos[0], py = tg.pos[1]
    let pitch = NaN
    for (let it = 0; it < 3; it++) {
      const d = Math.hypot(px - tube[0], py - tube[1])
      pitch = ballisticPitch(d, tg.pos[2] + 1 - tube[2], v, g, high)
      if (Number.isNaN(pitch)) return null
      const ft = ballisticTime(d, pitch, v)
      px = tg.pos[0] + tg.vel[0] * ft
      py = tg.pos[1] + tg.vel[1] * ft
    }
    return [Math.atan2(py - tube[1], px - tube[0]), pitch]
  }
}
