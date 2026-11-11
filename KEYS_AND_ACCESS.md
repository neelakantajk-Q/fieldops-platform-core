# KEYS AND ACCESS (handoff file — intentional for cross-device continuation)
#
# WARNING: these are demo/free-tier credentials for development handoff only.
# The pbc CLI token can be revoked/regenerated in the portal (Account page).
# Rotate before any production use.

## PocketBase Cloud account
- Portal:            https://portal.pocketbasecloud.com/projects
- Project:           Neelakanta JK's Project
- Project ID:        j2nnf0udodj4kuc
- Plan:              free (trial, 7 days from 2026-11-11 — add a card in the portal to keep it)
- Instance name:     fieldops-db
- Instance ID:       wzc6r4fspi7fdd2
- Public URL:        https://wzc6r4fspi7fdd2.pwz5.pocketbasecloud.com
- Admin panel:       https://wzc6r4fspi7fdd2.pwz5.pocketbasecloud.com/_/
- PocketBase pin:    0.22.32 (set in backend/pbc.json)

## Instance superuser (set at deploy; re-synced via `pbc pocketbase superuser sync`)
- Email:             itadmin@fieldops.local
- Password:          FieldOps#2026
- KNOWN ISSUE: REST auth against the cloud instance returns 400
  "Failed to authenticate." — see HANDOFF.md § Known issues (W1) for the
  debugging checklist before trusting these creds on the cloud instance.

## pbc CLI access token (portal > Account > CLI access token)
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJjb2xsZWN0aW9uSWQiOiJfcGJfdXNlcnNfYXV0aF8iLCJleHAiOjE3OTQ0NTA1NTYsImlkIjoicDJ3ZGgyNzN2ejhhcWJ2IiwicmVmcmVzaGFibGUiOnRydWUsInR5cGUiOiJhdXRoIn0.DoK-bh06VT9oSn0Yg4mgsoh-oOn_r5jOVkvFoBy8eho

Usage:
  pbc login --token <token above>
  pbc project use j2nnf0udodj4kuc
  cd backend && pbc pocketbase deploy --name fieldops-db --no-input

## Local dev superuser (local pb_data, same creds)
- itadmin@fieldops.local / FieldOps#2026

## Android app default server URL
- Prefilled in LoginActivity: the cloud URL above (editable on-device;
  use http://10.0.2.2:8090 for the local emulator).
