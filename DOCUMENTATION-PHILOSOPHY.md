# Why We Document: A Guide for Developers

This file uses the Chronicle Worlds project as a live example to explain why disciplined documentation is one of the most valuable skills a developer can build. Every pattern described here was applied in this repository.

---

## The Core Idea

Code tells a computer what to do. Documentation tells a *human* — including your future self — **why** decisions were made, **what** was built, and **where** to go next.

Without it, knowledge lives only in your head. That means:
- Picking the project back up after a week costs hours of re-orientation
- A collaborator can't contribute without a lengthy onboarding call
- A mistake made in an early design quietly breaks something three milestones later, with no paper trail to trace it back

With it, the project becomes a system that scales beyond any single person.

---

## Step 1 — Capture Decisions at the Moment They're Made

**What we did:**
When the Chronicle Worlds database migrations were applied, we immediately documented not just *what* was created, but *why* each design choice was made.

For example, in Milestone 2 we noted:
> `turn_queue` view intentionally reads `resolution_state` from `events` (not `chronicle`) — this is where action state lives.

That one line exists because the migration *failed on the first attempt* due to exactly that confusion. The fix was applied, and the reasoning was written down immediately.

**Why it matters:**
Decisions made under pressure — debugging, deadlines, quick fixes — are the ones most likely to be forgotten and the ones most likely to cause future confusion. Capturing them in the moment costs 30 seconds. Reconstructing them later costs hours.

**The habit:**
After every meaningful change, ask: *"If I came back to this cold in 3 months, would I understand why this is the way it is?"* If the answer is no, write a note.

---

## Step 2 — Make Each Milestone a Complete Unit

**What we did:**
Each milestone in `PROGRESS.md` contains:
1. What was built
2. Key decisions made
3. What to do next — with direct references to prior work

Milestone 3 (Edge Function) doesn't just say "build the function." It says:
> Check `turn_queue` view — if `queue_pos > 1` for this player, return `202 { status: 'queued' }` *(built in Milestone 2)*

**Why it matters:**
A future developer — or you, six weeks from now — shouldn't have to read the entire history to understand what to do next. Each milestone is a **handoff**. It should be possible to open one section and have everything needed to continue.

This is especially important when:
- You work in bursts (evenings, weekends)
- You onboard a collaborator mid-project
- You pause for a client revision and return weeks later

**The habit:**
Before closing out any work session, write one paragraph: what was completed, what was decided, and what the very next action is.

---

## Step 3 — Link Everything Forward and Backward

**What we did:**
Every upcoming milestone explicitly states what it **depends on**, and every completed milestone notes what **builds on top of it**.

For example:
- Milestone 4 (Frontend) says: *Depends on Milestone 3 (Edge Function endpoint live)*
- Milestone 3 (Edge Function) says: *Depends on Milestones 1 & 2 (all tables, `turn_queue` view, `players`, `branches`, `chronicle`)*

**Why it matters:**
Dependencies in code are explicit — the compiler will tell you if something is missing. Dependencies in *understanding* are invisible. If you skip documenting them, a developer will confidently start Milestone 4 without realizing Milestone 3 isn't done, and build against a schema that hasn't been extended yet.

Forward/backward linking also enables **parallel work**. When dependencies are clear, two developers can work on independent milestones simultaneously without stepping on each other.

**The habit:**
For every new piece of work, write: *"This requires X to already exist"* and *"This will be used by Y."* Even one sentence per direction prevents whole categories of wasted effort.

---

## Step 4 — Record Fixes and Failures, Not Just Successes

**What we did:**
When migration `002_multiplayer_extensions` failed on the first attempt because `resolution_state` didn't exist on `chronicle`, we documented the fix and the reason in the milestone notes — not just the final working result.

**Why it matters:**
Documentation that only shows clean outcomes creates a false picture of how software is built. More importantly, it hides the *reasoning* behind non-obvious design choices. When someone later looks at `turn_queue` and wonders "why does this join to `events` instead of just reading from `chronicle`?" — the answer is right there.

Failures are also the most valuable learning data. A bug that surfaces in Milestone 2 is a signal about assumptions made in Milestone 1. Documenting both means you can trace the root cause rather than patch the symptom again in Milestone 5.

**The habit:**
When something breaks, write down: what failed, what the error was, and what the root cause turned out to be. This takes 2 minutes and saves hours of repeated debugging.

---

## Step 5 — Maintain a Single Source of Truth

**What we did:**
All project context — Supabase project ID, region, migration names, branch rules, action durations, links — lives in one place: `PROGRESS.md`, with a Quick Reference table at the bottom.

No hunting through Slack messages, email threads, or old browser tabs.

**Why it matters:**
Knowledge that lives in multiple places becomes inconsistent. One doc says `branch_id = 0` is root. Another says it's `null`. Someone builds the wrong assumption into the Edge Function. Now you have a subtle bug that only surfaces under specific multiplayer conditions.

A single source of truth also lowers the barrier to entry for new contributors. Instead of "ask the original developer," the answer is "read the doc."

**The habit:**
Decide where the truth lives and enforce it. When something changes, update that one place first. If you find yourself writing the same fact in two locations, consolidate them.

---

## Step 6 — Documentation Opens the Door to Improvement

This is the step most students overlook.

Documentation isn't just about preserving what exists — it's what makes it **safe to change** what exists.

Consider: in Chronicle Worlds, the branch fork limit of 3 is enforced at the application layer (the Edge Function), not as a database constraint. That was a deliberate decision noted in Milestone 2.

Because it's documented, a future developer can:
- Understand *why* it was done that way (flexibility during early development)
- Evaluate whether it should now become a DB-level constraint
- Make that change confidently, knowing they understand the full picture

Without documentation, that same developer might assume it *was* a DB constraint, not add one in their new feature, and create a path where the limit is silently bypassed.

**The pattern:**
Good documentation doesn't lock a design in place — it makes the design *legible* enough to evolve. Every note you write is an invitation for a future developer (including yourself) to ask: *"Is this still the right approach?"*

---

## Summary: The Documentation Loop

```
Build something
    ↓
Document what was built + why decisions were made
    ↓
Note what comes next + what it depends on
    ↓
Record any failures or fixes
    ↓
Update the single source of truth
    ↓
Return to it later — oriented, confident, ready to improve
```

This loop doesn't slow development down. In the first week it might feel like overhead. By week three, it's the reason you're moving faster than a team that skipped it.

---

## Applied to This Project

| Documentation Step | Where It Appears in Chronicle Worlds |
|---|---|
| Capture decisions at the moment | Milestone notes (e.g. `resolution_state` fix) |
| Make each milestone a complete unit | Each milestone has What/Decisions/Next Steps |
| Link forward and backward | `Depends on` + `Reference` fields in every milestone |
| Record fixes and failures | `turn_queue` fix documented in Milestone 2 notes |
| Single source of truth | `PROGRESS.md` + Quick Reference table |
| Open the door to improvement | Branch limit noted as app-layer by design — revisitable |

---

*This file is itself an example of the practice it describes: written at the moment the pattern was applied, linked to the work it references, and designed to be useful to someone who wasn't there when the decisions were made.*
