# All-step prompt registration — independent verification

User requested all steps to be written/registered as ready-to-run prompts before further implementation.

## Deliverables
- steps/Step01.md through Step18.md: complete executable prompts with prerequisites, operating constraints, bounded objective, ordered implementation sequence, expected deliverables, specific acceptance tests, commands, reporting and stop gates.
- prompts/Step01-opencode-glm52.md through Step18-opencode-glm52.md: identical execution copies.
- steps/registry.json: ordered machine-readable register with model, dependencies, paths and verified/registered statuses.
- steps/README.md and prompts/README.md: run instructions and external decision gates.
- AGENTS.md, docs/product.md and README.md updated from just-in-time prompt creation to prewritten prompts with just-in-time prerequisite/code review.
- Originally executed Step01 prompt preserved verbatim under prompts/archive/Step01-original-executed-opencode-glm52.md. Current Step01 prompt defaults to verification-only to prevent re-scaffolding a completed project.

## Actual verification
Python validation passed for all 18 steps: ordered dependencies, exact requested model, required sections, canonical/execution byte equality, register links and correct status. Original Step01 archive matches the git baseline byte for byte. git diff --check passed.
Every prompt contains step-specific implementation and acceptance instructions, not just a copied generic checklist. Auth method, test DB access, Greek UI, closed-month policy and production permissions remain explicit gates. Step17 is audit-only before separately approved remediation.

## Scope
Documentation-only registration. Step02–Step18 were NOT executed. Existing app/package changes are earlier Step01 independent-review fixes, not new feature implementation from this registration pass. No push, deployment, DB connection or credential inspection performed.
The prior owned Step01 QA browser was closed and its production server stopped; port 3107 verified not listening. Application build/browser results remain recorded in Step01.md; no new runtime behavior was introduced by this documentation pass.
