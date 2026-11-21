# Monthly rules refresh

Run once a month on the most capable model available. Paste the prompt below as the whole message. Last run: 2026-11-20 (installed by memory-setup).

```
You are the most capable model I have access to. Cheaper models run my daily sessions and read only my context files. Refresh those files. Do all of it in this session; ask me at most 3 questions, and only at the end.

Read: CLAUDE.md, AGENTS.md, every file in docs/agent/, every .claude/skills/*/SKILL.md, README.md, the memory directory's MEMORY.md and each file it lists, and the last 30 days of session transcripts or summaries you can reach. Also run: git log --since="30 days ago" --oneline.

Then:

1. Stale rules. For every rule in CLAUDE.md and docs/agent/, check it against the code and the recent sessions. List each rule that is false, unused, or contradicted by another file, with the evidence. Fix or delete it. Confirm every path, script, and skill named in the routing table still exists (project skills in .claude/skills/, global ones in ~/.claude/skills/).

2. Repeated corrections. Find every place in the recent sessions where I corrected a model, repeated an instruction, or got angry. For each: quote me, state the behavior I wanted, and check whether a rule already covers it. If one does and it was still broken, rewrite the rule so a literal reader cannot misread it. If none does, write one.

3. New judgment. List things you would do in this project without being told that the files do not yet say. Convert each to an if/then rule with a trigger, an action, and a way to check it afterwards. Add it to docs/agent/quality-bar.md; promote it to CLAUDE.md only if a session broke it this month.

4. Worked examples. Replace the weakest example in docs/agent/worked-examples.md with a better real one from this month, and say why it is better.

5. Limits. Keep CLAUDE.md under 700 words by `wc -w` and its section order unchanged. Replace, never append. One statement of each rule, in one file. Never weaken a line under "How I work" without asking me. Keep the Git and Worktrees bullets identical to my other projects.

6. Update the date in CLAUDE.md "Current focus" and the Status line from the code, not from plans. Update "Last run" at the top of docs/agent/maintenance.md.

Report: rules deleted, rules rewritten, rules added (show each new line), and up to 3 questions whose answers would change a rule.
```
