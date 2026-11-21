/**
 * Run simulated matches and print the bot's placement stats.
 *
 *   node tools/run.ts --matches 48 --mode practice --bot ours --workers 8 --seed 1
 *   node tools/run.ts --bot example                     # the kit baseline (1.15 on the real board)
 *   MECH_PARAMS='{"retreatHp":0.5}' node tools/run.ts   # A/B a parameter (same seeds = paired)
 *   node tools/run.ts --replay runs/m1.jsonl --matches 1 # write a replay for tools/viewer.html
 *
 * League (free-for-all against other copies of our bot and the sim's FFA bots, like the qualifying round and final):
 *   node tools/run.ts --mode league --cand '{"mode":"ffa"}' --base '{"mode":"practice"}' --matches 160
 * The candidate sits in slot seed % 16; the other 15 seats come from LEAGUE (archetypes) in a per-seed order.
 * With --base the same seeds run again with the base bot in that seat, and the paired difference is printed.
 * In league mode leave MECH_PARAMS unset: it would change every copy of our bot, not just the candidate.
 */
import { gunzipSync } from "node:zlib"
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads"
import { availableParallelism } from "node:os"
import { World } from "../bot/world/map.ts"
import { Nav } from "../bot/world/nav.ts"
import { makeBot } from "../bot/main.ts"
import { Sim } from "../sim/engine.ts"
import { botController, exampleFactory, ffaController, houseController } from "../sim/house.ts"
import { rng } from "../bot/world/geom.ts"

const ROOT = new URL("..", import.meta.url).pathname
const ARENA = ROOT + "mechfight-kit/arena"

type Opts = { matches: number; mode: string; bot: string; workers: number; seed: number; replay: string; verbose: boolean; cand: string; base: string }

/**
 * League seats besides the candidate: copies of our bot tuned as other teams' practice bots might be, the sim's
 * FFA bot at expert aim (the "expert house bots" that fill empty final slots), and the kit example.
 */
export const LEAGUE: { name: string; n: number; params?: Record<string, unknown>; ffaTier?: number; example?: boolean; mirror?: boolean }[] = [
  { name: "aggressor", n: 5, params: { mode: "practice" } },
  { name: "sniper", n: 2, params: { mode: "practice", rangeGun: 170, rangeLaser: 220 } },
  { name: "rusher", n: 2, params: { mode: "practice", weaponPref: { lightning: 4, laser: 2, gun: 1.5, mortar: 1 }, rangeLightning: 20, retreatHp: 0.25 } },
  { name: "expertffa", n: 3, ffaTier: 3 },
  { name: "survivor", n: 2, mirror: true },
  { name: "example", n: 1, example: true },
]
type Result = { seed: number; place: number; points: number; cause: string; deathT: number; kills: number; cubes: number; hpEnd: number; times: number[]; errors: string[]; houseDead: number; trace?: string[]; stat?: Record<string, number> }

function parse(argv: string[]): Opts {
  const o: Opts = { matches: 48, mode: "practice", bot: "ours", workers: Math.max(1, availableParallelism() - 1), seed: 1, replay: "", verbose: false, cand: "{}", base: "" }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = argv[i + 1]
    if (a === "--matches") (o.matches = +v), i++
    else if (a === "--mode") (o.mode = v), i++
    else if (a === "--bot") (o.bot = v), i++
    else if (a === "--workers") (o.workers = +v), i++
    else if (a === "--seed") (o.seed = +v), i++
    else if (a === "--replay") (o.replay = v), i++
    else if (a === "--cand") (o.cand = v), i++
    else if (a === "--base") (o.base = v), i++
    else if (a === "-v") o.verbose = true
  }
  return o
}

function config(): any {
  const lines = gunzipSync(readFileSync(ROOT + "mechfight-kit/check/stream.jsonl.gz")).toString().split("\n")
  return JSON.parse(lines[0]).config
}

export function playMatch(world: World, nav: Nav, cfg: any, seed: number, mode: string, bot: string, replay = "", cand: Record<string, unknown> = {}, mirror: Record<string, unknown> = cand): Result {
  // nav.blocked is mutated by bots (stuck blacklist); give each match a clean copy
  const nav2 = Object.create(nav) as Nav
  nav2.blocked = nav.blocked.slice()
  const sim = new Sim(cfg, world, nav2, seed)
  const slot = seed % 16
  const tiers = [0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3]
  let ti = 0
  // league: the 15 other seats in a per-seed order (identical for the candidate and the base run)
  const seats = LEAGUE.flatMap((a) => Array.from({ length: a.n }, () => a))
  const r = rng(seed * 7919 + 1)
  for (let i = seats.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    ;[seats[i], seats[j]] = [seats[j], seats[i]]
  }
  for (let i = 0; i < 16; i++) {
    if (i === slot) sim.addMech(botController(bot, bot === "example" ? (exampleFactory as any) : (h: any) => makeBot(h, cand), ARENA))
    else if (mode === "league") {
      const a = seats[ti++]
      if (a.ffaTier !== undefined) sim.addMech(ffaController(), a.ffaTier)
      else if (a.example) sim.addMech(botController(a.name, exampleFactory as any, ARENA))
      else sim.addMech(botController(a.name, (h: any) => makeBot(h, a.mirror ? mirror : a.params), ARENA))
    } else if (mode === "ffa") sim.addMech(ffaController(), 1 + (ti++ % 3))
    else sim.addMech(houseController(), tiers[ti++])
  }
  const frames: string[] = []
  if (replay) {
    const orig = sim.step.bind(sim)
    sim.step = (dt: number) => {
      orig(dt)
      if (sim.tick % 2 === 0)
        frames.push(JSON.stringify({ t: +sim.t.toFixed(2), z: sim.circle().map((v) => +v.toFixed(1)), m: sim.mechs.map((m) => [m.id, +m.pos[0].toFixed(1), +m.pos[1].toFixed(1), +m.pos[2].toFixed(1), Math.round(m.hp), +m.aim[0].toFixed(2), m.alive ? 1 : 0, m.joined ? 1 : 0]), p: sim.projs.map((p) => [+p.pos[0].toFixed(1), +p.pos[1].toFixed(1)]) }))
    }
  }
  // trace: every decision, the brain's mode, our hp and how many hostiles we see
  const trace: string[] = []
  const ctl = sim.mechs[slot].ctl
  const origAct = ctl.act
  const st = sim.mechs[slot].stat
  ctl.act = (s, m, obs) => {
    // damage taken and decisions per brain state (the state chosen on the previous decision was active while it landed)
    const prev = (ctl as any).bot?.brain?.state ?? "start"
    for (const e of obs!.events)
      if (e.type === "damaged" && e.weapon !== "zone") {
        st[`dmg:${prev}`] = (st[`dmg:${prev}`] ?? 0) + e.amount
        st[`dmgW:${e.weapon}`] = (st[`dmgW:${e.weapon}`] ?? 0) + e.amount
      }
    for (const e of obs!.events) if (e.type === "effect" && e.effect === "cookoff") st.cookoffs = (st.cookoffs ?? 0) + 1
    if (m.weapons.some((w) => w?.kind === "mortar")) st.mortarHeldS = (st.mortarHeldS ?? 0) + 0.1
    const t0 = performance.now()
    const a = origAct(s, m, obs)
    const dtMs = performance.now() - t0
    const now = (ctl as any).bot?.brain?.state ?? "?"
    st[`n:${now}`] = (st[`n:${now}`] ?? 0) + 1
    if ((ctl as any).bot?.brain?.duck) st["n:duck"] = (st["n:duck"] ?? 0) + 1
    // free-for-all detection: in practice it must never fire (count of matches, and the time it fired)
    if ((ctl as any).bot?.brain?.ghost && st.ghostOn === undefined) {
      st.ghostOn = 1
      st.ghostAtS = s.t
    }
    if (dtMs > 15 && s.tick > 0) s.log.push(`slow act ${dtMs.toFixed(0)} ms at t=${s.t.toFixed(1)} state ${(ctl as any).bot?.brain?.state}`)
    const b = (ctl as any).bot?.brain
    const tg = b?.curTarget >= 0 ? s.mechs[b.curTarget] : null
    trace.push(`${s.t.toFixed(1)} ${b?.state ?? "?"} hp${Math.round(m.hp)} vis${obs!.mechs.filter((q) => q.kind === "mech").length} joined${s.mechs.filter((q) => q.joined && q.alive).length}${tg ? ` tgt${tg.id}:${Math.round(tg.hp)}@${Math.round(Math.hypot(tg.pos[0] - m.pos[0], tg.pos[1] - m.pos[1]))}m` : ""} fire${JSON.stringify(a.fire ?? [])} @${m.pos.map((v) => v.toFixed(0)).join(",")} mv${(a.move ?? []).map((v: number) => v.toFixed(1)).join(",")} z${s.circle().map((v) => v.toFixed(0)).join(",")} w${m.weapons.map((w) => w?.kind[0] ?? "-").join("")}`)
    if (trace.length > (process.env.TRACE_ALL ? 1e9 : 40)) trace.shift()
    return a
  }
  sim.run()
  const me = sim.mechs[slot]
  if (replay) {
    mkdirSync(replay.split("/").slice(0, -1).join("/") || ".", { recursive: true })
    writeFileSync(replay, JSON.stringify({ me: slot, seed, bounds: [world.minX, world.minY, world.maxX, world.maxY], prisms: world.prisms.map((p) => ({ top: p.top, ring: Array.from(p.ring, (v) => Math.round(v)) })) }) + "\n" + frames.join("\n") + "\n")
  }
  return {
    seed, place: me.place, points: 16 - me.place, cause: me.alive ? "alive" : me.deathCause, deathT: me.alive ? sim.t : me.deathT,
    kills: me.kills, cubes: me.cubes, hpEnd: Math.round(me.hp), times: sim.timing, errors: sim.log.slice(0, 3),
    houseDead: sim.mechs.filter((m) => m !== me && !m.alive).length,
    stat: me.stat,
    trace: trace.filter((_, i) => i % (process.env.TRACE_ALL ? 10 : 4) === 3 || i >= trace.length - 6),
  }
}

function summarize(rs: Result[], label: string) {
  const pts = rs.map((r) => r.points)
  const mean = pts.reduce((a, b) => a + b, 0) / pts.length
  const sd = Math.sqrt(pts.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, pts.length - 1))
  const causes: Record<string, number> = {}
  for (const r of rs) causes[r.cause] = (causes[r.cause] ?? 0) + 1
  const times = rs.flatMap((r) => r.times).sort((a, b) => a - b)
  const q = (p: number) => (times.length ? times[Math.min(times.length - 1, Math.floor(p * times.length))] : 0).toFixed(2)
  const avg = (f: (r: Result) => number) => (rs.reduce((a, r) => a + f(r), 0) / rs.length).toFixed(1)
  console.log(`${label}: ${rs.length} matches  mean points ${mean.toFixed(2)} ± ${(1.96 * sd / Math.sqrt(pts.length)).toFixed(2)} (95% CI)`)
  console.log(`  places: ${rs.map((r) => r.place).join(" ")}`)
  console.log(`  death causes: ${Object.entries(causes).map(([k, v]) => `${k} ${v}`).join(", ")}`)
  console.log(`  mean survival ${avg((r) => r.deathT)} s, kills ${avg((r) => r.kills)}, cubes ${avg((r) => r.cubes)}`)
  console.log(`  act() ms: p50 ${q(0.5)} p99 ${q(0.99)} max ${q(1)}`)
  const keys = [...new Set(rs.flatMap((r) => Object.keys(r.stat ?? {})))].sort()
  console.log(`  per match: ${keys.map((k) => `${k} ${(rs.reduce((a, r) => a + (r.stat?.[k] ?? 0), 0) / rs.length).toFixed(0)}`).join(", ")}`)
  const errs = rs.flatMap((r) => r.errors)
  if (errs.length) console.log(`  errors (${errs.length}): ${errs.slice(0, 3).join(" | ")}`)
}

async function batch(o: Opts, seeds: number[], cand: Record<string, unknown>, mirror: Record<string, unknown>): Promise<Result[]> {
  const results: Result[] = []
  if (o.workers <= 1 || seeds.length === 1) {
    const world = World.load(ARENA), nav = new Nav(world), cfg = config()
    for (const s of seeds) {
      const r = playMatch(world, nav, cfg, s, o.mode, o.bot, o.replay, cand, mirror)
      if (o.verbose) console.log(`seed ${s}: place ${r.place} ${r.cause} at ${r.deathT.toFixed(0)} s, kills ${r.kills}\n    ${r.trace!.join("\n    ")}`)
      results.push(r)
    }
  } else {
    const chunks: number[][] = Array.from({ length: Math.min(o.workers, seeds.length) }, () => [])
    seeds.forEach((s, i) => chunks[i % chunks.length].push(s))
    await Promise.all(
      chunks.map(
        (chunk) =>
          new Promise<void>((resolve, reject) => {
            const w = new Worker(new URL(import.meta.url), { workerData: { seeds: chunk, mode: o.mode, bot: o.bot, cand, mirror }, env: process.env })
            w.on("message", (r: Result) => {
              if (o.verbose) console.log(`seed ${r.seed}: place ${r.place} ${r.cause} at ${r.deathT.toFixed(0)} s, kills ${r.kills}`)
              results.push(r)
            })
            w.on("error", reject)
            w.on("exit", () => resolve())
          }),
      ),
    )
  }
  return results.sort((a, b) => a.seed - b.seed)
}

if (isMainThread) {
  const o = parse(process.argv.slice(2))
  const seeds = process.env.SEEDS ? process.env.SEEDS.split(",").map(Number) : Array.from({ length: o.matches }, (_, i) => o.seed * 1000 + i)
  if (o.mode === "league" && process.env.MECH_PARAMS) console.error("warning: MECH_PARAMS changes every copy of our bot in the league; use --cand / --base")
  const t0 = performance.now()
  const cand = JSON.parse(o.cand)
  const results = await batch(o, seeds, cand, cand)
  summarize(results, `${o.bot} ${o.cand} vs ${o.mode}`)
  if (o.base) {
    // same seeds and the same field (mirrors stay the candidate), only the candidate's seat changes
    const base = await batch(o, seeds, JSON.parse(o.base), cand)
    summarize(base, `${o.bot} ${o.base} vs ${o.mode}`)
    const d = results.map((r, i) => r.points - base[i].points)
    const md = d.reduce((a, b) => a + b, 0) / d.length
    const sd = Math.sqrt(d.reduce((a, b) => a + (b - md) ** 2, 0) / Math.max(1, d.length - 1))
    console.log(`paired difference cand - base: ${md.toFixed(2)} ± ${((1.96 * sd) / Math.sqrt(d.length)).toFixed(2)} (95% CI) over ${d.length} seeds`)
  }
  console.log(`  wall ${((performance.now() - t0) / 1000).toFixed(1)} s`)
} else {
  const { seeds, mode, bot, cand, mirror } = workerData as { seeds: number[]; mode: string; bot: string; cand: Record<string, unknown>; mirror: Record<string, unknown> }
  const world = World.load(ARENA), nav = new Nav(world), cfg = config()
  for (const s of seeds) parentPort!.postMessage(playMatch(world, nav, cfg, s, mode, bot, "", cand, mirror))
}
