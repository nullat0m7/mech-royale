# Bot design, params, decisions, submissions

The rules and limits are in `CLAUDE.md` and `protocol.md`. This file says how the bot is built, why, and how each version scored.

## Layout

| Path | What it is |
| --- | --- |
| `Dockerfile` | The submitted image: `node:24.22.3-slim` pinned by digest, copies `package.json` and `bot/` only (`.dockerignore` is an allowlist). |
| `bot/main.ts` | Entry. Builds the world model at `hello`, runs `Brain.act` per observation, falls back to "walk to zone, don't fire" if the brain throws. |
| `bot/mechfight.ts` | The kit's TypeScript wrapper, copied verbatim from `mechfight-kit/ts/mechfight.ts`. |
| `bot/params.ts` | Every tunable number. `loadParams` returns a copy; `MECH_PARAMS` (JSON) and per-bot overrides (league) merge into it. The image sets neither. |
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
| `node tools/run.ts --mode league --cand '{"mode":"ffa"}' --base '{"mode":"practice"}' --matches 160` | Free-for-all league (copies of our bot as other teams, sim expert FFA bots, kit example): candidate vs base on the same seeds and field, with the paired difference. Leave `MECH_PARAMS` unset. |
| `node tools/calibrate.ts [--only a,b] [--matches 960]` | Replays every scored version as params on today's code and prints sim vs real with the rank correlation. `HOUSE_PARAMS` tries another house model. |
| `node --run sim -- --matches 96 [--mode ffa] [--bot example] [-v]` | Local simulator: mean points with 95% CI, places, death causes, damage and accuracy, act() timing. `MECH_PARAMS='{"retreatHp":0.5}'` A/B-tests a parameter on the same seeds; `SEEDS=1001 TRACE_ALL=1 … -v --workers 1` prints a decision trace. Timing is only meaningful with `--workers 1` (parallel workers contend for CPU). |

## Simulator (`sim/`)

`sim/engine.ts` approximates the server from `protocol.md`: physics with wall sliding, all four weapons, NPC drones, crates, loot, cubes and offers, supply drops, the zone, vision and sound. Vision includes tree occlusion; shots ignore trees, as in the real game. Collision uses the centre plus four rim points. `sim/house.ts` models the practice squad as the track page describes it:
- Shared vision; they never fight each other.
- Joins: one at 20 s, 2 more per house bot killed, all at 240 s. The calibrated sim uses 1 per kill (`HOUSE.joinPerKill`).
- Position intel every 8 s.
- Aim noise by tier (2.6°, 1.5°, 0.9°, 0.5°).

It also has a simple free-for-all opponent and the kit's example bot. Every number in it is a guess. Since 2026-11-21 house bots fire to full weapon range, proximity vision ignores canopy (protocol §8), and per-match stats include damage taken by brain state and by weapon, laser-duck time and FFA-mode activations. The kit example scores 0.98 in the sim against 1.15 on the real board, so treat sim results as a comparison between versions, not a forecast.

## Behaviour

Each decision the brain picks one mode, in this order:

1. `zone`: outside the circle, or the trip to 70% of the next radius would not finish before the shrink ends. Boosts and still shoots targets of opportunity.
2. `fight`: a hostile mech is in view and HP is at least 40% (+15% per extra hostile with a line of fire on us; 75% when 3 or more hostiles are near). Keeps a preferred range by weapon (gun 100 m, laser 120 m, lightning 28 m) and strafes, flipping direction at random every 0.6–1.8 s.
3. `retreat`: hostiles or recent hits while too weak to fight. Walks to the nearest sampled point that no tracked hostile can see, facing the threat.
4. `regen`: after a retreat (or, with `idleRegen`, whenever nothing is in view and HP is under 85%), stands still (silent) facing the last hit until `reengageHp` (85%) HP. Regen itself (45 HP/s after 5 s unharmed) also runs while roaming.
5. Otherwise `roam`, choosing one of: walk onto visible cubes within 90 m; take a weapon that improves the loadout (laser 3, lightning 2.6, gun 1.6, mortar 1.2); go to a supply drop within 300 m if no hostile is in view and we can arrive within 6 s of landing; shoot NPC drones within 170 m and crates within 90 m (until 330 s, above 60% HP); rotate into the next circle; hold next to a wall inside it.

Kill securing (2026-11-21): below the retreat line, keep fighting a mech with at most `finishHp` HP left in our line of fire while we have `finishSelf` HP.

Free-for-all ("ghost", 2026-11-21): when at least 2 mechs we did not kill are dead by 150 s (house bots never fight each other, so practice cannot do this), and until 4 are alive, the next circle is 70 m or t = 330 s:
- Attacked by a mech in the last 2 s: go to cover if it is within 45 m (shooting back), else fight.
- Finish a visible enemy at or below 50% HP in range when we have 50% and no other mech is within 150 m.
- A mech that can see us: move out of its sight, facing it. Otherwise collect cubes and weapons within 40 m, take a drop within 120 m with no mech near it, shoot crates within 60 m when no mech was heard for 10 s, rotate early, hold beside a wall. No drone farming. Below 5 m/s when a mech is within 60 m or was heard near/mid (silent, §8).
- Upgrades: plating, armor, nanites, sensors first. Laser duck on and mortars never held (FFA only, `ghostDuck`, `ghostNoMortar`); cover within 45 m; finish enemies at or below 50% HP.

Always on:
- Laser duck (2026-11-21): a visible mech charging a laser aimed at us sends us to the nearest walkable spot within 14 m it cannot see. Mortars are never taken and are dropped if held (cook-off).
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
- 2026-11-20: candidate 6: `farmHp` 0.6 → 0.85, from `protocol.md` §7. Regen needs 5 s without dealing *or* taking damage, and drones shoot back at whoever attacks them. Farming while hurt therefore stops regen and costs HP. With `reengageHp` 0.65 the bot left regen at 65% and could start farming straight away, which undercut candidate 5's premise that regen continues while roaming. Now it shoots drones and crates only at 85% HP or more.
- 2026-11-20: `f4f93f8` (`reengageHp` 0.65 + `farmHp` 0.85) scored 4.31, below 4.44. Only the pair was scored. `farmHp` goes back to 0.6. Farming less means fewer cubes, the passive direction that lost twice already, so it is the likelier cause. Candidate 6 is `reengageHp` 0.65 alone. If that also scores 4.44 or below, `reengageHp` goes back to 0.85.
- 2026-11-20: `926e5b7` (`reengageHp` 0.65 alone) scored 4.40, below 4.44, so it goes back to 0.85. Against the pair's 4.31, `farmHp` 0.85 cost about 0.09: less farming hurts. Candidate 7 farms more. `crateRange` and `cubeRange` go from 90 to 140 m. Crates (300 HP, 1 cube, a weapon half the time) do not shoot back, unlike drones. Gun range is 230 m and laser range 280 m. A 140 m radius covers about 2.3× the area, so about 2.3× the crates of the 36 on the map. `cubeRange` must match, because a crate's cube drops where the crate stood.
- 2026-11-20: crates and cubes to 140 m (`aeb2484`) scored 4.35, so both go back to 90 m. Farming more lost as well, so `farmHp` 0.4 (more farming) is dropped. Six changes from the 4.44 behaviour, six losses. Candidate 8: `dropMaxDist` 220 → 300 m. A drop gives 3 cubes, full HP and full energy (`protocol.md` §7 Supply drops), and getting there means moving, not standing still. The ETA rule still applies (`brain.ts:505`, walk speed): 300 m at 11.7 m/s is 25.6 s, within the 25 s fall plus `dropSlack` 6 s.
- 2026-11-20: `dropMaxDist` 300 m (`7a3a25a`) scored 4.46, the first change to beat 4.44, so it stays. Candidate 9: `dropSlack` 6 → 30 s. `obs.drops` lists a drop until someone captures it (`protocol.md` §5 `drops`). Once it has landed, `lands_in` is 0, so the old rule (`brain.ts:505`: walk ETA ≤ `lands_in` + 6 s) chased landed drops only within about 70 m. With 30 s, a landed, untaken drop is chased within the 300 m `dropMaxDist`, and a falling one whenever we can arrive within 30 s of landing.
- 2026-11-20: `dropSlack` 30 s (`944ca5c`) scored 4.38, below 4.46, so it goes back to 6. Chasing drops that have already landed, up to 300 m away, lost about 4 place-points. Candidate 10: `rangeGun` 75 → 100 m (gun without a laser only; drones are fought from the same range, crates stay at 40 m or less). `PATTERNS.md` pattern 1 shows the 3.98 long-range result was confounded with `idleRegen`, so long range has never been tested on its own. 100 m is a moderate step. It leaves more time to sidestep bullets (252 m/s: 0.40 s against 0.30 s at 75 m), and it stays outside lightning's 45 m range (`protocol.md` §7 Weapons).
- 2026-11-20: tree occlusion (`World.sightClear`/`treesBlock`). Trunks block sight; crowns block when the path through them is longer than ln(1/canopyBlockT)/canopyDensity = 3.96 m (our reading of `rules`, unverified). The sim's vision uses it, and so do the bot's cover and peek searches (`treeCover`).
- 2026-11-21: the final is decided in free-for-alls between qualifiers (track page), so the bot gets a free-for-all mode. It is gated so practice behaviour does not change: 0 activations in 192 sim practice matches; it activates at 22.7 s on the recorded real match.
- 2026-11-21: sim calibration with house fire at full range: the `6df0e10` stack (real 3.98) still scores best in the sim (5.38 vs 3.63 for the 4.44 behaviour, 960 matches each), and also with near-perfect house aim (4.36 vs 3.18, 480 each). The sim cannot rank tactics; it stays a tool for bugs, timing and mechanisms.
- 2026-11-21: candidate 11: laser duck plus never carrying a mortar. The real recording shows lasers doing 1260 of 1665 damage taken; the sim's house bots rarely laser (317 of 2600 per match), so the sim cannot measure it. Jinking (`strafeFlip` 1, 0.3-0.7 s) showed no sim change in damage taken and is not shipped.
- 2026-11-21: #11 scored 4.31. The owner asked for all-in bets instead of one-knob tests, so candidate 12 bundles one direction, "kill faster": kill securing (`finishHp` 350: keep fighting below the retreat line while the target has at most 350 HP in our line of fire and we have 300), damage upgrades before plating, and weapons hunted out to 260 m (`lootRange`). Ghost mode keeps the v1 camp (exposure off, `ghostExpW` 0): the exposure camp scored −0.49 ± 0.78 against v1's +0.59 ± 0.77 in the league.
- 2026-11-21: #12 scored 3.90. Reverted to the exact 4.46 practice behaviour (including the original strafe draw, so the random sequence matches) with the free-for-all mode on top. Plating-first upgrades stay (`PATTERNS.md`).
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
| 2026-11-20 | Checks at candidate 6 (`farmHp` 0.85) | typecheck 0 errors; test 10/10; local check PASS 300/300 p99 0.6 ms; Docker check PASS 300/300 p99 4.3 ms, max 9.8 ms; sim 96 matches 3.42 ± 0.76, no exceptions, 2 zone deaths; 12 matches, 1 worker: act() max 4.2 ms |
| 2026-11-20 | Checks at candidate 6 (`reengageHp` 0.65 alone) | typecheck 0 errors; test 10/10; local check PASS 300/300 p99 0.7 ms; Docker check PASS 300/300 twice, p99 5.5 / 4.6 ms, max 31.2 / 21.1 ms (same bot code as `fe134fc`, which measured a 9.7 ms max, so these are emulation spikes); sim 96 matches, no exceptions, 4 zone deaths; 12 matches, 1 worker: act() max 4.2 ms |
| 2026-11-20 | Checks at candidate 7 (crates and cubes to 140 m) | typecheck 0 errors; test 10/10; local check PASS 300/300 p99 0.8 ms, max 1.5 ms; Docker check PASS 300/300 p99 5.2 ms, max 27.9 ms (emulated amd64); sim 96 matches, no exceptions, mean cubes 4.4 vs 3.6 at 90 m (wiring check, not a ranking); 12 matches, 1 worker: act() max 4.8 ms |
| 2026-11-20 | Checks at candidate 8 (`dropMaxDist` 300 m) | typecheck 0 errors; test 10/10; local check PASS 300/300 p99 0.7 ms; Docker check PASS 300/300 p99 4.6 ms, max 8.5 ms; sim 96 matches, 8 workers, no exceptions, 2 zone deaths, cubes 3.7 vs 3.6 at 220 m (the sim bot survives about 99 s and the first drop lands at 95 s, so drops rarely come into play there); 12 matches, 1 worker: act() max 4.0 ms |
| 2026-11-20 | Checks at candidate 9 (`dropSlack` 30 s) | typecheck 0 errors; test 10/10; local check PASS 300/300 p99 0.6 ms; Docker check PASS 300/300 p99 3.9 ms, max 9.7 ms; sim 96 matches, 8 workers, no exceptions, 2 zone deaths, cubes 3.9 vs 3.7 at 6 s (wiring check only); 12 matches, 1 worker: act() max 2.0 ms |
| 2026-11-20 | Checks at candidate 10 (`rangeGun` 100 m) | typecheck 0 errors; test 10/10; local check PASS 300/300 p99 0.7 ms; Docker check PASS 300/300 p99 4.7 ms, max 14.1 ms; sim 96 matches, 8 workers, no exceptions, 4 zone deaths; 12 matches, 1 worker: act() max 4.2 ms |
| 2026-11-20 | Sim act() timing, 12 FFA matches, 1 worker | p50 0.00 ms, p99 0.15 ms, max 6.3 ms |
| 2026-11-21 | Checks at candidate 11 | typecheck 0 errors; test 15/15 (fuzz 10 000 in auto and FFA mode); local check PASS 300/300 p99 0.9 ms; Docker check PASS 300/300 p99 5.6 ms, max 20.6 ms; sim 192 practice matches, 0 FFA activations, no exceptions |
| 2026-11-21 | League, 32 matches (smoke test) | ghost 10.06 ± 1.28 vs practice mode 9.25 ± 1.40 in the same seat |
| 2026-11-21 | League, 480 paired matches (seed 3) | ghost + laser duck + no mortar vs ghost: +0.21 ± 0.26; cover 45 m + finish at 50%: +0.19 ± 0.32; endgame at 3 alive / 360 s: −0.01 ± 0.07 |
| 2026-11-21 | League, 480 paired matches (seed 5) | ghost v2 (duck, no mortar, cover 45 m, finish at 50%) vs ghost v1: +0.41 ± 0.34 (8.70 vs 8.29) |
| 2026-11-21 | League, 480 paired matches each (seeds 7, 9), vs ghost v2 | loot/crates 70-90 m −0.05 ± 0.31; drops to 220 m −0.19 ± 0.14 (loss: drops are fight magnets); no drops +0.09 ± 0.16; loot 25 m +0.04 ± 0.33; quiet radius 100 m −0.15 ± 0.18. Ghost v2 kept as is. |
| 2026-11-21 | League, 480 paired matches (seed 3), at candidate 12 | ghost 8.63 ± 0.40 vs practice mode 8.15 ± 0.41; paired +0.48 ± 0.44; survival 134 vs 122 s; wins 38 vs 47 |

## Submissions

Practice score = the mean of 16 − place over 48 matches against the house squad. Baseline 1.15.

| # | Date (ET) | Commit | Score | Notes |
| --- | --- | --- | --- | --- |
| 1 | 2026-11-20 | `65ce172` | 4.44 | First submission. Sim had predicted 2.92: the sim squad is too strong. |
| 2 | 2026-11-20 | `6df0e10` | 3.98 | Seven changes: long range (gun 170 m, laser 210 m), loadout gun 2 / lightning 1.3 / mortar 1, `idleRegen` and `avoidLightning` on, `retreatPerExtra` 0.3, `outnumbered` 2. Sim predicted 7.63. |
| 3 | 2026-11-20 | `ecbee26` | 4.44 | Same behaviour as #1: identical score, so practice scoring is deterministic. |
| 4 | 2026-11-20 | `096c710` (bot = `029df2d`) | 4.00 | `treeCover` + `idleRegen` on. Worse than 4.44; both turned off again. |
| 5 | 2026-11-20 | `f4f93f8` | 4.31 | `reengageHp` 0.65 + `farmHp` 0.85 together (`fe134fc`, `reengageHp` alone, was never scored). Worse than 4.44; `farmHp` back to 0.6. |
| 6 | 2026-11-20 | `926e5b7` | 4.40 | `reengageHp` 0.65 alone. Worse than 4.44; back to 0.85. Together with #5, `farmHp` 0.85 cost about 0.09. |
| 7 | 2026-11-20 | `aeb2484` (bot; docs-only HEAD `5770340`) | 4.35 | `crateRange` and `cubeRange` 90 → 140 m. Worse than 4.44; back to 90. |
| 8 | 2026-11-20 | `7a3a25a` | **4.46** | `dropMaxDist` 220 → 300 m. New best (+1 place-point over 48 matches); kept. |
| 9 | 2026-11-20 | `944ca5c` | 4.38 | `dropSlack` 6 → 30 s on top of #8. Worse than 4.46; back to 6. |
| 10 | 2026-11-20 | `3a7229f` | not reported | `rangeGun` 100. |
| 12 | 2026-11-21 | `3a7455a` (or `71b82d1`, same practice play) | 3.90 | Kill securing + damage-first upgrades + `lootRange` 260. Worse than 4.46 by 0.56; all three reverted. Bundling untested changes was a mistake: one change per submission again. |
| 11 | 2026-11-21 | `d2453c4` | 4.31 | `rangeGun` 100 + laser duck + mortar never held + FFA mode (inactive in practice). Worse than 4.46; duck, mortar rule and `rangeGun` 100 reverted. |
