# CLAUDE2.md: overflow of CLAUDE.md

`CLAUDE.md` is capped at 800 words by `wc -w` (owner, 2026-11-20). Anything that does not fit lives here. `CLAUDE.md` wins on any conflict.

## Observations (continued)

- 2026-11-20: Both ~0.45 losses had `idleRegen` on; long range alone is untested. See `PATTERNS.md`.
- 2026-11-21: Track page: at the cutoff (Sun 11:00 ET) the chosen submission ("your best unless you pick another") locks with its practice score; the top 32 play 16 FFA matches on new seeds, the top 16 a 64-match FFA series; ties go to the earlier submission; finalists are rebuilt, so pin versions. Board chat quotes a Builders rule: no code shared between teams, top entries compared. Never read or copy other teams' repos.
- 2026-11-21: Leaderboard 23:07 ET (11-20): 135 teams; #1 5.58, #10 4.88, #21 4.46 (our best), #32 4.21. The top-32 line moves up fast.
- 2026-11-21: `mechfight-kit/check/stream.jsonl.gz` is a real free-for-all: 3 deaths by 24.9 s, all far away. Opponent id 10 held gun + laser at 4.9 s, aimed within about 1°, and landed 4 of 4 full-charge lasers at 57-150 m.
- 2026-11-21: Sim timing: the A* gate is no longer wall-clock (`brakeMs` 30 is an emergency stop), so sim runs are reproducible across worker counts unless the machine is overloaded.

- 2026-11-20: House bots die only to us, the zone, NPC drones or their own mortar splash. Clock-out ranking by HP cannot happen: the circle reaches radius 0 at 415 s at 260 HP/s, before the 480 s limit (`PATTERNS.md` pattern 2).
- 2026-11-20: Every change from the 4.44 behaviour has lost so far: long range 3.98, tree cover + idle regen 4.00, reengage 0.65 + farm at 85% 4.31, reengage 0.65 alone 4.40. The only gradient seen: farming less cost about 0.09.
- 2026-11-20: `f4f93f8` stacked two changes (`reengageHp` 0.65, `farmHp` 0.85) and scored 4.31. A stacked score cannot say which change moved it, so submit one change at a time.
- 2026-11-20: Trees block about half the sightlines buildings leave open, never shots; hunters track us 5 s after losing sight.
- 2026-11-20: No public replays, match data or debug downloads exist (watch, status, leaderboard pages). The practice score is the only real feedback.
- 2026-11-20: Leaderboard ~21:00 ET: 94 teams, top 5.23 (then 5.19, 5.19, 4.75, 4.73); we are about 9th at 4.44. The top 32 by practice score qualify for the final.
- 2026-11-20: In Claude's sandbox, `python3`, `npm` and `bun` are shell wrappers (safe-chain) that fail with `listen EPERM`. `node --run <script>` and `/opt/homebrew/bin/python3` work. Docker, `gh` and `git push` must run outside the sandbox.
- 2026-11-20: Writes to the memory directory from Bash are denied by the sandbox; use the Edit or Write tool.
