# mySavings — registered execution prompts

All 18 steps are written as ready-to-run prompts. Preparation is complete; implementation is NOT. Step01–Step04 are independently verified. Step05–Step18 remain unexecuted.

## How execution works
1. User approves one step.
2. Hermes reads its prompt and the current code/prior independent review, verifies prerequisites and amends any stale assumptions in BOTH copies.
3. Run only that prompt with OpenCode `ollama-cloud/glm-5.2`.
4. Hermes independently reviews and verifies; records docs/reviews/StepNN.md and reports.
5. Stop for approval before the next step. No batch/automatic run of all prompts.

Canonical files are steps/StepNN.md. Identical execution copies are prompts/StepNN-opencode-glm52.md. The historical originally executed Step01 prompt is archived in prompts/archive/, because the registered Step01 prompt is now verification-only by default.

## Ordered register
- [Step01: Stable Next.js foundation](Step01.md) — completed / independently verified. [Execution copy](../prompts/Step01-opencode-glm52.md).
- [Step02: Financial calculation core and tests](Step02.md) — completed / independently verified; see ../docs/reviews/Step02.md. [Execution copy](../prompts/Step02-opencode-glm52.md).
- [Step03: Neon connection and migrations infrastructure](Step03.md) — independently verified after atomicity corrections; see ../docs/reviews/Step03.md. [Execution copy](../prompts/Step03-opencode-glm52.md).
- [Step04: Private authentication and identity](Step04.md) — independently verified after security remediation and real-browser re-QA; see ../docs/reviews/Step04.md. [Execution copy](../prompts/Step04-opencode-glm52.md).
- [Step05: Owner-scoped financial schema](Step05.md) — registered / awaiting approval and prerequisites. [Execution copy](../prompts/Step05-opencode-glm52.md).
- [Step06: Account balances and adjustments backend](Step06.md) — registered / awaiting approval and prerequisites. [Execution copy](../prompts/Step06-opencode-glm52.md).
- [Step07: Mobile shell and account screens](Step07.md) — registered / awaiting approval and prerequisites. [Execution copy](../prompts/Step07-opencode-glm52.md).
- [Step08: Monthly plans and recurring templates](Step08.md) — registered / awaiting approval and prerequisites. [Execution copy](../prompts/Step08-opencode-glm52.md).
- [Step09: Expense plans and income expectations](Step09.md) — registered / awaiting approval and prerequisites. [Execution copy](../prompts/Step09-opencode-glm52.md).
- [Step10: Partial payments and receipts engine](Step10.md) — registered / awaiting approval and prerequisites. [Execution copy](../prompts/Step10-opencode-glm52.md).
- [Step11: Mobile settlement and reconciliation UX](Step11.md) — registered / awaiting approval and prerequisites. [Execution copy](../prompts/Step11-opencode-glm52.md).
- [Step12: Reserved commitments and tax money](Step12.md) — registered / awaiting approval and prerequisites. [Execution copy](../prompts/Step12-opencode-glm52.md).
- [Step13: Savings-first overview and forecast](Step13.md) — registered / awaiting approval and prerequisites. [Execution copy](../prompts/Step13-opencode-glm52.md).
- [Step14: Month rollover preview and apply](Step14.md) — registered / awaiting approval and prerequisites. [Execution copy](../prompts/Step14-opencode-glm52.md).
- [Step15: Month closing, history and private exports](Step15.md) — registered / awaiting approval and prerequisites. [Execution copy](../prompts/Step15-opencode-glm52.md).
- [Step16: Installable privacy-safe PWA](Step16.md) — registered / awaiting approval and prerequisites. [Execution copy](../prompts/Step16-opencode-glm52.md).
- [Step17: Security, isolation and mobile acceptance](Step17.md) — registered / awaiting approval and prerequisites. [Execution copy](../prompts/Step17-opencode-glm52.md).
- [Step18: Vercel deployment and production smoke](Step18.md) — registered / awaiting approval and prerequisites. [Execution copy](../prompts/Step18-opencode-glm52.md).

## External decisions and access gates
- Step03: approved mySavings Neon test connection. Do not assume the existing .env authorizes access or points to a test branch.
- Step04: sign-in/enrollment choice and maintained stable auth solution, reviewed before execution.
- Step07: confirm Greek UI assumption.
- Step15: closed-month correction/reopening policy.
- Step16: physical Android/iPhone installation evidence separate from browser emulation.
- Step17: audit-only first; remediation needs separate approval and re-QA. Critical/high unresolved findings block deployment.
- Step18: explicit Vercel/Neon production permissions, backup/restore, secrets and deployment gate. Push permission remains separate.

## Run one approved step
```bash
cd /home/leandrosdim777/projects/mySavings
opencode run --agent build --model ollama-cloud/glm-5.2 "$(< prompts/Step02-opencode-glm52.md)"
```
The command is an example, not automatic approval. Do not run Step01 scaffolding again.
