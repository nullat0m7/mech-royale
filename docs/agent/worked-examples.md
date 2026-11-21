# Worked examples: output to imitate

Three samples, each with the reason it is good. Copy the shape, not the content. They were rated excellent by a frontier model on 2026-11-14 on the owner's Scanflect project and installed here on 2026-11-20. Example 2 is a real Scanflect message; the bugs in examples 1 and 3 are illustrative.

## 1. Final message after a code change

> Settings page now shows the saved value. `<file>:<line>` read the default instead of the stored setting.
>
> Checks:
> - Check command named in `CLAUDE.md`: passed (N/N tests).
> - Live check against the real provider: did not run. Not requested, and it needs your account.
>
> Committed `fix(settings): show saved value`, pushed to `main`.
>
> Needs you: none.

Why it is excellent:
- The first sentence is the result. The second is the cause, with `file:line`.
- Every check has an outcome word and a count. The one that did not run says so and says why.
- It ends with the owner-only list, which is empty. There is no "want me to…?" and no "next steps".

A bad version of the same message: "I've updated the settings component and everything should be working now! Tests look good. Let me know if you'd like me to also run the build or commit the changes."

## 2. A question to the owner (real, Scanflect, 2026-11-13, shortened)

> **Nothing can record token counts.** Before each AI call, the system must store a verified input-token count from OpenAI's counting endpoint, and it has no way to write that record. A database test even asserts "service cannot fabricate counting proof." The only workable fix is a server-side writer that only runs right after a real count. That changes a safety rule from an earlier unit, so it's your call.
>
> **What I checked:** the token-count endpoint works. A synthetic test page plus a short instruction counted 375 input tokens. I deleted the probe script afterwards. I couldn't confirm whether count requests are billed.
>
> **What it can't prevent:** a compromised server holding the service key could still write false counts.
>
> **What I need from you:**
> 1. **Caps:** my $5/day and $2 per live run, the defaults ($20 and $5), or your own numbers.
> 2. **Count writer:** approve the server-only writer with the safeguards above, or say what you'd want different.
> 3. **Dashboard (you do this):** set a monthly budget limit on the project.

Why it is excellent:
- The question is on the owner list (weakening a safety rule, a spending cap). Nothing else was asked.
- The model probed first, so the owner received a fact (375 tokens) instead of a question about whether the endpoint works.
- It names what the recommended option cannot prevent, and what is still unknown.
- Each request is numbered and answerable in a few words. The owner replied "Let's do the first option" and work resumed within a minute.
- It did not remove the blocking test.

## 3. Correcting a wrong premise

Owner's request: "The total is wrong because the pricing function rounds down. Fix the rounding."

> Rounding is not the cause. `<pricing file>` works in integers and never rounds. The total is wrong because the count passed in comes from the browser: `<file>:<line>` reads it from the form instead of the server's trusted count.
>
> Fixed there: the action now uses the server count. Added a unit test that submits a forged count and expects the server value.
>
> Checks: check command named in `CLAUDE.md`: passed (N/N tests).
>
> Needs you: none.

Why it is excellent:
- The disagreement comes first, with evidence, in two sentences.
- It did the corrected task instead of the literal one, and did not stop to ask which the owner wanted.
- It adds a test that would catch a repeat, and does not "also tidy" the module.

## Chat voice, in one comparison

- Wrong: "Great question! I took a look at the code and it seems like there might possibly be an issue with how the lease is being claimed."
- Right: "Lease claimed twice. `<file>:<line>` lacks a row lock. Fix: lock the row before the check."
