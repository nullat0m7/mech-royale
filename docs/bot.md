# Bot design, params, decisions, submissions

The rules and limits are in `CLAUDE.md` and `protocol.md`. This file says how the bot is built, why, and how each version scored.

## Layout

| Path | What it is |
| --- | --- |
| `Dockerfile` | The submitted image: `node:24.22.3-slim` pinned by digest, copies `package.json` and `bot/` only (`.dockerignore` is an allowlist). |
| `bot/main.ts` | Entry. Builds the world model at `hello`, runs `Brain.act` per observation, falls back to "walk to zone, don't fire" if the brain throws. |
| `bot/mechfight.ts` | The kit's TypeScript wrapper, copied verbatim from `mechfight-kit/ts/mechfight.ts`. |
| `bot/params.ts` | Every tunable number. `MECH_PARAMS` (JSON) overrides them for simulator A/B runs; the image never sets it. |
| `bot/world/map.ts` | Terrain (bilinear), prisms (spatial hash), `rayHit`/`clear` for shots, `sightClear` adding tree trunks and crowns for sight (trees never stop shots). |
| `bot/world/nav.ts` | 2 m walk grid: surface height, roof flag, wall flag; A* with step-up and slope rules. |
| `bot/world/geom.ts` | Angles, gun intercept, mortar ballistic pitch, point-in-polygon, seeded RNG. |
| `bot/brain/brain.ts` | Memory, behaviour choice, movement, dodging, aiming and firing. |
| `test/` | `node:test` unit tests. |
| `sim/`, `tools/` | Local simulator and match runner (not shipped). |

## Commands

Run from the repo root. In Claude Code's sandbox, use `node --run`, never `npm` or bare `python3` (a shell wrapper there fails with `listen EPERM`). Docker commands need to run outside the sandbox.

| Command | What it does |
| --- | --- |
| `node --run typecheck` | `deno check` on `bot`, `test`, `sim`, `tools` (Deno is the type checker: no npm dependencies). |
| `node --run test` | Unit tests. |
| `node --run check` | Kit conformance check against `node bot/main.ts`. |
| `node --run docker:build` | Builds the image for linux/amd64. |
| `node --run check:docker` | Conformance check against the image with the match sandbox flags. |
| `node --run verify` | All of the above in order. Run before every push that will be submitted. |
| `node --run sim -- --matches 96 [--mode ffa] [--bot example] [-v]` | Local simulator: mean points with 95% CI, places, death causes, damage and accuracy, act() timing. `MECH_PARAMS='{"retreatHp":0.5}'` A/B-tests a parameter on the same seeds; `SEEDS=1001 TRACE_ALL=1 … -v --workers 1` prints a decision trace. Timing is only meaningful with `--workers 1` (parallel workers contend for CPU). |

## Simulator (`sim/`)

`sim/engine.ts` approximates the server from `protocol.md`: physics with wall sliding, all four weapons, NPC drones, crates, loot, cubes and offers, supply drops, the zone, vision and sound. Vision includes tree occlusion; shots ignore trees, as in the real game. Collision uses the centre plus four rim points. `sim/house.ts` models the practice squad as the track page describes it:
- Shared vision; they never fight each other.
- Joins: one at 20 s, 2 more per house bot killed, all at 240 s.
- Position intel every 8 s.
- Aim noise by tier (2.6°, 1.5°, 0.9°, 0.5°).

It also has a simple free-for-all opponent and the kit's example bot. Every number in it is a guess. The kit example scores 0.98 in the sim against 1.15 on the real board, so treat sim results as a comparison between versions, not a forecast.

## Behaviour

Each decision the brain picks one mode, in this order:

1. `zone`: outside the circle, or the trip to 70% of the next radius would not finish before the shrink ends. Boosts and still shoots targets of opportunity.
2. `fight`: a hostile mech is in view and HP is at least 40% (+15% per extra hostile with a line of fire on us; 75% when 3 or more hostiles are near). Keeps a preferred range by weapon (gun 75 m, laser 120 m, lightning 28 m) and strafes, flipping direction at random every 0.6–1.8 s.
3. `retreat`: hostiles or recent hits while too weak to fight. Walks to the nearest sampled point that no tracked hostile can see, facing the threat.
4. `regen`: after a retreat (or, with `idleRegen`, whenever nothing is in view and HP is under 85%), stands still (silent) facing the last hit until `reengageHp` (65%) HP. Regen itself (45 HP/s after 5 s unharmed) also runs while roaming.
5. Otherwise `roam`, choosing one of: walk onto visible cubes; take a weapon that improves the loadout (laser 3, lightning 2.6, gun 1.6, mortar 1.2); go to a supply drop if no hostile is in view and we can arrive within 6 s of landing; shoot NPC drones within 170 m and crates within 90 m (until 330 s, above 60% HP); rotate into the next circle; hold next to a wall inside it.

Always on:
- Dodge: sidestep visible bullets passing within 4.5 m in the next 0.8 s, leave predicted mortar impacts, and sidestep a charging laser aimed at us.
- Unstick: jump and jet when we barely move for 1 s; on every second stuck event, blacklist the next path cell for 20 s.
- Upgrades: picked by `P.upgradeOrder` (plating, armor, nanites first).
- Aim:
  - Lightning when within 95% of range.
  - Laser: start charging when the cooldown is nearly done; release when full and on target.
  - Gun: lead by intercept time; fire when the slewed aim is within the target's angular radius.
  - Mortar: low arc, or high arc when the target has no line of sight.
- Targeting: the score favours line of fire, low HP (`targetHpWeight`) and the current target (`targetStick`), so damage turns into kills instead of being spread across hunters that regenerate. An NPC drone that hits us while no mech is in view becomes the target.
- Fight position: every 0.5 s, sample spots within 30 m that keep a line of fire to the target but hide us from other tracked hostiles; move there. The retreat threshold rises by 15% per extra hostile with a line of fire on us.
- Reachability: the walk grid is split into regions that are mutually walkable. Goals (cubes, loot, drops, zone) must be in our region. If we end up in a small sealed yard (under 3000 cells), we jet over the wall toward the goal.
- Budget: at most one A* per decision (≤25 000 cells, only if under 12 ms used so far), and cover and peek searches consider at most the 4 nearest threats.
- FFA detection: if more mechs died than we killed plus one, the match is a free-for-all (`ffa`), and NPC farming stops while hostiles are near.

## Decisions

- 2026-11-20: TypeScript on Node 24, not Python. Per-tick work is CPU-bound (line of sight, A*, solvers) under 50 ms on 1 CPU, and the local simulator reuses the same code. Node 24.22.3 is installed locally, so local runs and the image behave the same.
- 2026-11-20: type checking with the locally installed Deno (`deno check`), not `typescript` from npm. Zero dependencies, nothing to vet for slopsquatting.
- 2026-11-20: the kit stays vendored at `mechfight-kit/` (check tool, arena, schema). Root `protocol.md` is an identical copy kept where the owner put it.
- 2026-11-20: the GitHub repo is already public (`gh repo view`: PUBLIC).
- 2026-11-20: sim squad calibrated to the first real score: one hunter joins per kill, aim σ 1.5/0.9/0.5/0.3°. Sim gives example 0.96 (real 1.15) and build `65ce172` 4.90 (real 4.44).
- 2026-11-20: engagement range 170 m (gun) / 210 m (laser), outnumbered at 2, retreat +30% per extra shooter. Calibrated sim: 4.76 → 6.76 over 192 matches; FFA sim 11.10 → 11.80. Our aim is precise and the house aim is noisy, so long range favours us.
- 2026-11-20: loadout values laser 3, gun 2, lightning 1.3, mortar 1 (was lightning 2.6, gun 1.6). Calibrated sim 6.76 → 7.63 over 192 matches; FFA 11.80 → 11.96.
- 2026-11-20: submission 2 (`6df0e10`, long range + gun/laser) scored 3.98 against 4.44, although the sim predicted +2.9. The sim cannot rank these changes, even after adding tree occlusion (trees block about half of building-clear sightlines). Defaults go back to the 4.44 behaviour; `idleRegen` and `avoidLightning` stay off. From here, a behaviour change ships only if a real submission shows it. Submission 3 replays the 4.44 behaviour to measure run-to-run noise on the fixed seeds.
- 2026-11-20: after submission 3 matched 4.44 exactly, each submission is an exact A/B on the 48 seeds. Candidate 4: tree-aware cover and peek spots (`treeCover`, a tree-only hidden spot costs 40% of an exposed one) plus `idleRegen` on.
- 2026-11-20: submission 4 (tree cover + idle regen) scored 4.00. Both passive changes so far lost about 0.45 (long range 3.98). House bots never fight each other, so our score is roughly how many house bots die before us, mostly by our hand; time spent hiding gives hunters time to gather and to regenerate. Both flags off. Candidate 5: `reengageHp` 0.85 → 0.65. Regen runs at 45 HP/s after 5 s without damage whether we stand still or roam, so the `regen` state adds only silence, and while in it we ignore a visible hunter until it hits us. Rejected: armor before plating (plating ×1.15 max HP beats armor's ×1.087 effective HP per stack, per `hello.config.upgrades`), longer gun range (the direction that lost), skipping drops (3 cubes plus full HP and energy).
- 2026-11-20: tree occlusion (`World.sightClear`/`treesBlock`). Trunks block sight; crowns block when the path through them is longer than ln(1/canopyBlockT)/canopyDensity = 3.96 m (our reading of `rules`, unverified). The sim's vision uses it, and so do the bot's cover and peek searches (`treeCover`).
- 2026-11-20: the simulator drives bots in-process (`botController`), not over pipes. The protocol path is covered by `check.py` locally and in Docker; in-process runs are about 1.5 s per match.

## Measurements

| Date | Check | Result |
| --- | --- | --- |
| 2026-11-20 | `node --run check` (local) | PASS 300/300, p99 0.5 ms, world ready 30 ms |
| 2026-11-20 | Docker sandbox check (amd64 emulated on arm64 Mac) | PASS 300/300, p99 3.4 ms, max 10.3 ms, ready 1143 ms |
| 2026-11-20 | Docker sandbox check at `df534b7`+NPC fix | PASS 300/300, p99 4.1 ms, max 9.7 ms, ready 1164 ms |
| 2026-11-20 | `node --run test` | 10/10 pass (includes a 10 000-observation fuzz test) |
| 2026-11-20 | Sim, 96 practice matches | 2.92 ± 0.39 points (kit example: 0.98 ± 0.30 on 48) |
| 2026-11-20 | Sim, 96 FFA matches | 11.10 ± 0.98 points (the sim's FFA opponents are weak) |
| 2026-11-20 | Sim at candidate 5 (`reengageHp` 0.65), 96 practice matches, sanity only | 3.26 ± 0.72 points, no exceptions, 3 zone deaths, act() max 19.5 ms with parallel workers |
| 2026-11-20 | Checks at candidate 5 | typecheck 0 errors; test 10/10; local check PASS 300/300 p99 0.7 ms; Docker check PASS 300/300 p99 4.3 ms, max 9.7 ms; sim 12 matches, 1 worker: act() p99 0.25 ms, max 4.3 ms |
| 2026-11-20 | Sim act() timing, 12 FFA matches, 1 worker | p50 0.00 ms, p99 0.15 ms, max 6.3 ms |

## Submissions

Practice score = the mean of 16 − place over 48 matches against the house squad. Baseline 1.15.

| # | Date (ET) | Commit | Score | Notes |
| --- | --- | --- | --- | --- |
| 1 | 2026-11-20 | `65ce172` | 4.44 | First submission. Sim had predicted 2.92: the sim squad is too strong. |
| 2 | 2026-11-20 | `6df0e10` | 3.98 | Long range (gun 170 m, laser 210 m), gun+laser loadout. Sim predicted 7.63: its long-range model was wrong. |
| 3 | 2026-11-20 | `ecbee26` | 4.44 | Same behaviour as #1: identical score, so practice scoring is deterministic. |
| 4 | 2026-11-20 | `096c710` (bot = `029df2d`) | 4.00 | `treeCover` + `idleRegen` on. Worse than 4.44; both turned off again. |
