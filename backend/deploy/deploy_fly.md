# FieldOps backend on Fly.io

Fly.io no longer has a true free tier (removed for new orgs in Oct 2024). What
you get instead:

- **No card:** a $1 trial, 7 days (or until credit runs out). Trial Machines
  auto-stop after 5 minutes, so this is only good for a quick test.
- **Card on file:** bills **under $5/month are waived**. A single
  `shared-cpu-1x` 512MB Machine + 1GB volume runs about **$3.84/mo**, so it
  stays effectively **$0** out of pocket. That is the realistic "free" path.

PocketBase uses SQLite, so it must run as **exactly one Machine** with one
persistent volume. Always deploy with `--ha=false`.

## 1. Install flyctl (Windows PowerShell)

```powershell
iwr https://fly.io/install.ps1 -useb | iex
```

Close and reopen the terminal, then:

```powershell
fly auth signup     # or: fly auth login
```

## 2. Create the app + volume

From `fieldops-platform-core\backend\`:

```powershell
# fly.toml already sets app = "fieldops-pb" — change it if the name is taken,
# or create a uniquely-named app and update `app` in fly.toml to match.
fly apps create fieldops-pb

# 1 GB volume in Mumbai (bom). Use `fly platform regions` to pick another.
fly volumes create pb_data --region bom --size 1
```

## 3. Deploy

```powershell
fly deploy --ha=false
```

The image pins PocketBase **0.22.32** (same as the old cloud instance). On
first boot `pb_migrations/` build the full schema and seed the QEL org; the
`pb_hooks/` (seat limits, geofencing, TAT, billing, etc.) are active
immediately — no separate `hooks push` step like PocketBase Cloud needed.

## 4. Create the superuser

```powershell
fly ssh console -C "pocketbase admin create itadmin@fieldops.local YOUR_STRONG_PASSWORD"
```

Then open the admin panel at:

```
https://fieldops-pb.fly.dev/_/
```

If `admin create` says the email already exists, the DB already has one — use
that account, or reset it from the panel.

## 5. Point the clients at the new URL

Set the API base URL to `https://fieldops-pb.fly.dev` in:

- `web-client` build env: `VITE_API_BASE_URL` (GitHub repo variable + rebuild)
- `app/config.js` (mobile)
- Android `LoginActivity` default server URL

CORS is open by default in PocketBase 0.22, and Fly terminates TLS, so no extra
proxy/Caddy is needed. Realtime (SSE) works through Fly's HTTP service.

## 6. (Optional) Migrate the existing data

The old cloud data is not carried over automatically. Two options:

- **Clean start (recommended for a demo):** let migrations + seeds run as-is.
- **Import existing data:** from the old/local running instance create a backup
  (admin panel → Settings → Backups), then upload that `.zip` in the new Fly
  instance's admin panel → Settings → Backups → Upload. This restores
  collections + records in one step.

## 7. Cost controls

- `min_machines_running = 1` keeps it always on (needed for the escalation /
  retention crons). That is the ~$3.84/mo that the under-$5 waiver zeroes out.
- To cut cost further at the price of reliability, set
  `min_machines_running = 0` in `fly.toml` and redeploy — the Machine then
  auto-stops when idle (crons only run while it is awake).
- Watch usage at https://fly.io/dashboard → Billing.

## Useful commands

```powershell
fly logs                    # live logs
fly status                  # machines/volumes
fly ssh console             # shell inside the container
fly deploy --ha=false       # redeploy after hook/migration changes
fly volumes list            # confirm pb_data exists
```
