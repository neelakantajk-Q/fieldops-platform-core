# FieldOps backend on Hugging Face Spaces (no credit card, no domain)

Hugging Face Spaces (Docker SDK) runs the PocketBase container for free and
exposes a public URL. Use it as the test backend until your custom domain is
ready; nothing needs to change in the client except the API base URL.

## 1. Create the Space
1. Sign in at https://huggingface.co (free account).
2. **New → Space**.
3. Name: `fieldops-backend`. License: MIT. **SDK: Docker → Blank**.
4. Visibility: Public (or Private). Hardware: CPU basic (free).
5. Create.

## 2. Push this backend into the Space
The Space is a git repo. From `fieldops-platform-core/backend/`:

```bash
git remote add hf https://huggingface.co/spaces/<USER>/fieldops-backend
git add Dockerfile pb_hooks pb_migrations seed_schema.js
git commit -m "deploy: pocketbase backend"
git push hf main
```
(Files must be at the **root** of the Space repo, which this `backend/`
folder mirrors: `Dockerfile`, `pb_hooks/`, `pb_migrations/`.)

Hugging Face builds the image automatically. Watch the **Logs** tab.

## 3. First boot
- Migrations create every collection and seed the default tenant, hub and
  three users (`admin/admin`, `mod/1`, `user1/password`).
- Open `https://<USER>-fieldops-backend.hf.space/_/` to reach the PocketBase
  admin UI and create your superuser immediately.

## 4. Point the clients at it
- Web test client (`web-client/config.js`): set
  `API_BASE_URL = "https://<USER>-fieldops-backend.hf.space"` (or use the
  in-page "Save" box).
- Mobile client (`app/config.js`): same value.

## 5. Practical notes
- **Free Spaces sleep** after inactivity and wake on the next request; the
  first call after sleep can take ~30s.
- **Free storage is ephemeral** unless you enable persistent storage on the
  Space (Settings → Persistent storage). Without it `pb_data` resets when the
  Space restarts. Enable it for a usable test environment.
- **No Caddy/SSL needed**: Hugging Face terminates TLS at
  `*.hf.space`. The `deploy_oci.sh` + `Caddyfile` path is only for when you
  move to a VPS and your own domain.
- When the custom domain is ready, set `API_BASE_URL` to
  `https://api.yourbrand.com` and deploy the same Dockerfile to that host.
