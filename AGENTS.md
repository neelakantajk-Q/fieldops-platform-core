# Agent Instructions — FieldOps

**Before doing anything, read `PROJECT_STATE.md` in full.** It holds the current
architecture, decisions, live deployment state, and the resume point. Do not rely
on a previous session's memory or on re-deriving context from `git diff`.

## Hard rules

1. **Continuity:** after every meaningful change, append to the **Change Log** in
   `PROJECT_STATE.md` and update the **Resume Point**. Keep it short and factual.
2. **Canonical host is Render** (`https://fieldops-pb.onrender.com`, one URL for
   UI + API). GitHub Pages and PocketBase Cloud are retired — do not deploy to
   them.
3. **Deploys:** push to `main`, then trigger the Render deploy through the Render
   REST API. GitHub auto-deploy is not reliable (see `PROJECT_STATE.md` §4).
4. **Secrets:** the repo is **public**. Never commit API keys, tokens, or
   passwords. The Render API key lives outside the repo in the workspace
   `ccc.txt`; reference it, never copy it in.
5. **PocketBase 0.22 JSVM:** top-level helpers are not visible inside hook
   callbacks — inline them. Do not move to 0.23+ without porting hooks.
6. **PowerShell 5.1:** no `&&`/`||`; use `;` and `if ($?) { }`.

## Build & verify

```powershell
cd web-client; $env:VITE_SAME_ORIGIN_API="true"; npm run build; cd ..
node --check backend/pb_hooks/api_fieldops.pb.js
node --check backend/pb_migrations/1700000130_region_zone.js
```

Live verification after a Render deploy: fetch `https://fieldops-pb.onrender.com/`,
confirm the `assets/index-*.js|css` hashes changed, call
`https://fieldops-pb.onrender.com/api/fieldops/health`, then log in as
`admin` / `admin` and smoke-test Team (Zone), Performance (TAT), and Broadcast
alert.

## Where things live

- Backend hooks: `backend/pb_hooks/` (edit here only).
- Migrations: `backend/pb_migrations/`.
- Web app: `web-client/src/`.
- Render build: `render.yaml`, `backend/Dockerfile.render`, `backend/entrypoint.sh`.
- State/decisions: `PROJECT_STATE.md`.
