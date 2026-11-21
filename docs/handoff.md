# Handoff

Rules live in `CLAUDE.md` and override this file. Design, decisions and the submissions log are in `docs/bot.md`; the change history is in `CHANGELOG.md`.

## 0. Built, with evidence

- **Repo setup**, 2026-11-20, `64d0b01`: TypeScript bot on Node 24 with no runtime dependencies; `Dockerfile` (node:24.22.3-slim pinned by digest, copies `package.json` and `bot/` only); `.gitignore`, `.dockerignore`; vendored kit in `mechfight-kit/`; scripts in `package.json` (`node --run typecheck|test|check|docker:build|check:docker|verify|sim`).
- **Bot**, 2026-11-20, `bot/main.ts` → `bot/brain/brain.ts` (`Brain.act`):
  - World: `bot/world/map.ts` (`World.rayHit`, `clear`, `sightClear`, `treesBlock`) and `bot/world/nav.ts` (`Nav.path`, `reachable`, `snap`, regions).
  - Every tunable number is in `bot/params.ts` (`P`).
  - Verified at submission 10 (`rangeGun` 100 m): type check 0 errors, `node --run test` 10/10 (includes a 10 000-observation fuzz test), local check PASS 300/300 (p99 0.7 ms), Docker sandbox check PASS 300/300 (p99 4.7 ms, max 14.1 ms).
- **Simulator**, 2026-11-20:
  - `sim/engine.ts` (`Sim`), `sim/house.ts` (`houseController`, `ffaController`, `exampleFactory`, `HOUSE` with a `HOUSE_PARAMS` env override), `tools/run.ts` (batch runner), `tools/viewer.html` (replay viewer).
  - About 1.5 s per match.
  - It mis-ranks tactics: see the `CLAUDE.md` Observations.
- **Practice scores (exact; the scorer is deterministic):**

  | Commit | Score | Notes |
  | --- | --- | --- |
  | `65ce172` | 4.44 | |
  | `6df0e10` | 3.98 | long range, reverted |
  | `ecbee26` | 4.44 | |
  | `096c710` (bot = `029df2d`) | 4.00 | submission 4: `treeCover` and `idleRegen` on; turned off again |
| `fe134fc` | not scored | `reengageHp` 0.65 alone |
| `f4f93f8` | 4.31 | submission 5: `reengageHp` 0.65 + `farmHp` 0.85 |
| `926e5b7` | 4.40 | submission 6: `reengageHp` 0.65 alone; back to 0.85 |
| `aeb2484` / `5770340` | 4.35 | submission 7: `crateRange` and `cubeRange` 140 m; back to 90 |
| `7a3a25a` | **4.46** | submission 8: 4.44 behaviour plus `dropMaxDist` 300 m; new best |
| `944ca5c` | 4.38 | submission 9: `dropSlack` 30 s; back to 6 |
| `3a7229f` | pending | submission 10: `7a3a25a` plus `rangeGun` 100 m |
| HEAD of `main` | pending | candidate 11: laser duck, no mortar, free-for-all mode |

## 1. Next (2026-11-21)

The win is decided in free-for-alls between the top 32 (track page; `CLAUDE.md` Observations); the practice score only has to stay in the top 32 with margin. Work in this order:
1. Log #10 (`3a7229f`) and #11 when the owner pastes them. If #10 is 4.46 or below, the next candidate also sets `rangeGun` back to 75.
2. Grow the free-for-all mode with the league (`node tools/run.ts --mode league --cand '{"mode":"ffa"}' --base '{"mode":"practice"}' --matches 160`): accept a change only when the paired difference is positive with the CI above 0. Ideas: exposure map precomputed offline for hiding spots, endgame positioning near `next_center`, quieter rotations.
3. Practice candidates, one mechanism each, from `PATTERNS.md` and `docs/bot.md` Decisions: one-at-a-time geometry (move when 2+ hostiles have a line of fire), kill securing (stay to finish a target we out-damage), zone planner on walking distance. The sim cannot rank them (calibration 2026-11-21); decide by real scores.
4. Before the cutoff (Sun 2026-11-22 11:00 ET): the chosen submission must carry the FFA mode and be in the top 32; if the board's "best" is an older build without it, the owner picks the newer one on the track page.
