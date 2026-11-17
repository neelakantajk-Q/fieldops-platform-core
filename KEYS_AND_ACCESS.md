# KEYS AND ACCESS (handoff file â€” intentional for cross-device continuation)
#
# WARNING: these are demo/free-tier credentials for development handoff only.
# The pbc CLI token can be revoked/regenerated in the portal (Account page).
# Rotate before any production use.

## PocketBase Cloud account
- Portal:            https://portal.pocketbasecloud.com/projects
- Project:           Neelakanta JK's Project
- Project ID:        j2nnf0udodj4kuc
- Plan:              free (trial, 7 days from 2026-11-11 â€” add a card in the portal to keep it)
- Instance name:     fieldops-db
- Instance ID:       wzc6r4fspi7fdd2
- Public URL:        https://wzc6r4fspi7fdd2.pwz5.pocketbasecloud.com
- Admin panel:       https://wzc6r4fspi7fdd2.pwz5.pocketbasecloud.com/_/
- PocketBase pin:    0.22.32 (set in backend/pbc.json)

## Instance superuser (VERIFIED WORKING 2026-11-11)
- Email:             itadmin@fieldops.local
- Password:          <REDACTED — rotate before use; see portal Billing/Account>
- NOTE: the instance DB's admins table can be EMPTY even though `pbc pocketbase
  info` shows creds (the platform's managed-superuser sync does not seed the DB).
  While empty, PB 0.22 permits unauthenticated creation:
    POST /api/admins {"email":"itadmin@fieldops.local","password":"<REDACTED>","passwordConfirm":"<REDACTED>"}
  Once created, normal auth works (cloud seeded; 8/8 + 13/13 tests green).
- If creds are lost: delete the admin row from the panel and re-create as above,
  or use the panel's password reset.

## pbc CLI access token (portal > Account > CLI access token)
<REDACTED — generate a fresh token in the portal; never commit it>

Usage:
  pbc login --token <paste token here>
  pbc project use j2nnf0udodj4kuc
  cd backend && pbc pocketbase deploy --name fieldops-db --no-input

## Live frontend (web console, PocketBase Cloud hosting)
- URL:               https://cj0jzgjbxy8nywl.pwz5.pocketbasecloud.com
- Frontend name:     fieldops-web
- Points at (baked): https://wzc6r4fspi7fdd2.pwz5.pocketbasecloud.com
- Redeploy:          powershell -File scripts\deploy_frontend_cloud.ps1
- GitHub repo var:   VITE_API_BASE_URL (used by .github/workflows/web-client.yml)
- Login:             cloud admin/mod/user1 seeded by backend/seed_schema.js

## Local dev superuser (local pb_data, same creds)
- itadmin@fieldops.local / <REDACTED>

## Android app default server URL
- Prefilled in LoginActivity: the cloud URL above (editable on-device;
  use http://10.0.2.2:8090 for the local emulator).
## !! FREE TRIAL EXPIRES ~2026-11-18 !!
- The Cloud project is on a 7-day free trial starting 2026-11-11.
- Add a payment card in the portal (Billing) before ~2026-11-18 to keep the
  instance and demo URLs alive after the trial.
- CLI access tokens expire quickly: if 'pbc login --token' says 'Not authenticated',
  fetch a new token from portal > Account > CLI access token.

