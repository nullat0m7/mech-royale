/**
 * Run simulated matches and print the bot's placement stats.
 *
 *   node tools/run.ts --matches 48 --mode practice --bot ours --workers 8 --seed 1
 *   node tools/run.ts --bot example                     # the kit baseline (1.15 on the real board)
 *   MECH_PARAMS='{"retreatHp":0.5}' node tools/run.ts   # A/B a parameter (same seeds = paired)
 *   node tools/run.ts --replay runs/m1.jsonl --matches 1 # write a replay for tools/viewer.html
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

const ROOT = new URL("..", import.meta.url).pathname
const ARENA = ROOT + "mechfight-kit/arena"

type Opts = { matches: number; mode: string; bot: string; workers: number; seed: number; replay: string; verbose: boolean }
type Result = { seed: number; place: number; points: number; cause: string; deathT: number; kills: number; cubes: number; hpEnd: number; times: number[]; errors: string[]; houseDead: number }

function parse(argv: string[]): Opts {
  const o: Opts = { matches: 48, mode: "practice", bot: "ours", workers: Math.max(1, availableParallelism() - 1), seed: 1, replay: "", verbose: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = argv[i + 1]
    if (a === "--matches") (o.matches = +v), i++
    else if (a === "--mode") (o.mode = v), i++
    else if (a === "--bot") (o.bot = v), i++
    else if (a === "--workers") (o.workers = +v), i++
    else if (a === "--seed") (o.seed = +v), i++
    else if (a === "--replay") (o.replay = v), i++
    else if (a === "-v") o.verbose = true
  }
  return o
}

function config(): any {
  const lines = gunzipSync(readFileSync(ROOT + "mechfight-kit/check/stream.jsonl.gz")).toString().split("\n")
  return JSON.parse(lines[0]).config
}

export function playMatch(world: World, nav: Nav, cfg: any, seed: number, mode: string, bot: string, replay = ""): Result {
  // nav.blocked is mutated by bots (stuck blacklist); give each match a clean copy
  const nav2 = Object.create(nav) as Nav
  nav2.blocked = nav.blocked.slice()
  const sim = new Sim(cfg, world, nav2, seed)
  const slot = seed % 16
  const factory = bot === "example" ? exampleFactory : makeBot
  const tiers = [0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3]
  let ti = 0
  for (let i = 0; i < 16; i++) {
    if (i === slot) sim.addMech(botController(bot, factory as any, ARENA))
    else if (mode === "ffa") sim.addMech(ffaController(), 1 + (ti++ % 3))
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
  sim.run()
  const me = sim.mechs[slot]
  if (replay) {
    mkdirSync(replay.split("/").slice(0, -1).join("/") || ".", { recursive: true })
    writeFileSync(replay, JSON.stringify({ me: slot, seed }) + "\n" + frames.join("\n") + "\n")
  }
  return {
    seed, place: me.place, points: 16 - me.place, cause: me.alive ? "alive" : me.deathCause, deathT: me.alive ? sim.t : me.deathT,
    kills: me.kills, cubes: me.cubes, hpEnd: Math.round(me.hp), times: sim.timing, errors: sim.log.slice(0, 3),
    houseDead: sim.mechs.filter((m) => m !== me && !m.alive).length,
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
  const errs = rs.flatMap((r) => r.errors)
  if (errs.length) console.log(`  errors (${errs.length}): ${errs.slice(0, 3).join(" | ")}`)
}

if (isMainThread) {
  const o = parse(process.argv.slice(2))
  const seeds = Array.from({ length: o.matches }, (_, i) => o.seed * 1000 + i)
  const t0 = performance.now()
  const results: Result[] = []
  if (o.workers <= 1 || o.matches === 1) {
    const world = World.load(ARENA), nav = new Nav(world), cfg = config()
    for (const s of seeds) {
      const r = playMatch(world, nav, cfg, s, o.mode, o.bot, o.replay)
      if (o.verbose) console.log(`seed ${s}: place ${r.place} ${r.cause} at ${r.deathT.toFixed(0)} s, kills ${r.kills}`)
      results.push(r)
    }
  } else {
    const chunks: number[][] = Array.from({ length: Math.min(o.workers, seeds.length) }, () => [])
    seeds.forEach((s, i) => chunks[i % chunks.length].push(s))
    await Promise.all(
      chunks.map(
        (chunk) =>
          new Promise<void>((resolve, reject) => {
            const w = new Worker(new URL(import.meta.url), { workerData: { seeds: chunk, mode: o.mode, bot: o.bot }, env: process.env })
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
  results.sort((a, b) => a.seed - b.seed)
  summarize(results, `${o.bot} vs ${o.mode}`)
  console.log(`  wall ${((performance.now() - t0) / 1000).toFixed(1)} s`)
} else {
  const { seeds, mode, bot } = workerData as { seeds: number[]; mode: string; bot: string }
  const world = World.load(ARENA), nav = new Nav(world), cfg = config()
  for (const s of seeds) parentPort!.postMessage(playMatch(world, nav, cfg, s, mode, bot))
}
