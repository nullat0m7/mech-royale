# Bot design, params, decisions, submissions

The rules and limits are in `CLAUDE.md` and `protocol.md`. This file says how the bot is built, why, and how each version scored.

## Layout

| Path | What it is |
| --- | --- |
| `Dockerfile` | The submitted image: `node:24.22.3-slim` pinned by digest, copies `package.json` and `bot/` only (`.dockerignore` is an allowlist). |
| `bot/main.ts` | Entry. Builds the world model at `hello`, runs `Brain.act` per observation, falls back to "walk to zone, don't fire" if the brain throws. |
| `bot/mechfight.ts` | The kit's TypeScript wrapper, copied verbatim from `mechfight-kit/ts/mechfight.ts`. |
| `bot/params.ts` | Every tunable number. `MECH_PARAMS` (JSON) overrides them for simulator A/B runs; the image never sets it. |
| `bot/world/map.ts` | Terrain (bilinear), prisms (spatial hash), `rayHit`/`clear` for shots and sight. Trees are ignored (they never stop shots). |
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
| `node --run sim -- …` | Local simulator (see `tools/run.ts`). |

## Behaviour (v1)

Each decision the brain picks one mode, in this order:

1. `zone`: outside the circle, or the trip to 70% of the next radius would not finish before the shrink ends. Boosts and still shoots targets of opportunity.
2. `fight`: a hostile mech is in view and HP is at least 40% (75% when 3 or more hostiles are near). Keeps a preferred range by weapon (gun 75 m, laser 120 m, lightning 28 m) and strafes, flipping direction at random every 0.6–1.8 s.
3. `retreat`: hostiles or recent hits while too weak to fight. Walks to the nearest sampled point that no tracked hostile can see, facing the threat.
4. `regen`: after a retreat, stands still (silent) facing the last hit until 85% HP.
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
- FFA detection: if more mechs died than we killed plus one, the match is a free-for-all (`ffa`), and NPC farming stops while hostiles are near.

## Decisions

- 2026-11-20: TypeScript on Node 24, not Python. Per-tick work is CPU-bound (line of sight, A*, solvers) under 50 ms on 1 CPU, and the local simulator reuses the same code. Node 24.22.3 is installed locally, so local runs and the image behave the same.
- 2026-11-20: type checking with the locally installed Deno (`deno check`), not `typescript` from npm. Zero dependencies, nothing to vet for slopsquatting.
- 2026-11-20: the kit stays vendored at `mechfight-kit/` (check tool, arena, schema). Root `protocol.md` is an identical copy kept where the owner put it.
- 2026-11-20: the GitHub repo is already public (`gh repo view`: PUBLIC).

## Measurements

| Date | Check | Result |
| --- | --- | --- |
| 2026-11-20 | `node --run check` (local) | PASS 300/300, p99 0.5 ms, world ready 30 ms |
| 2026-11-20 | Docker sandbox check (amd64 emulated on arm64 Mac) | PASS 300/300, p99 3.4 ms, max 10.3 ms, ready 1143 ms |

## Submissions

Practice score = the mean of 16 − place over 48 matches against the house squad. Baseline 1.15.

| # | Date (ET) | Commit | Score | Notes |
| --- | --- | --- | --- | --- |
