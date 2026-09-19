# Dependency review — 2026-09-19

Live npm registry: next latest stable 16.3.5; canary 16.4.0-canary.36 excluded. React/react-dom latest stable 19.3.0. Next peer metadata accepts React ^19.0.0 and Node >=20.9.0. Local Node 22.21.1 / npm 11.12.1.

Pin next and eslint-config-next to 16.3.5, react/react-dom to 19.3.0; npm lockfile. Supported Node 22.x initial Vercel target; recheck Node patches/deployment support before production. No experimental compiler/features needed.

Sources checked:
- https://nextjs.org/blog/tag/security
- https://nextjs.org/blog/august-2026-security-release — security patches in 16.3.3 Active LTS; selected 16.3.5 is newer in this line.
- npm view next dist-tags --json; npm view next@latest engines peerDependencies --json; npm view react version; npm view react-dom version.

No guarantee of vulnerability-free software. Audit actual install/lockfile and before deployment; record results in docs/reviews/Step01.md. No force fixes, silent downgrades or claiming complete security from audit alone.
