# Production Deploy Procedure

This documents how changes actually get onto the live shop server
(`shopcontrol.conceptauto.local`, 192.168.10.8). Confirmed accurate by both
maintainers (Josh, Jim) as of 2026-09-10.

The live app is **not** deployed via `git clone`/`git pull` from this repository.
`/opt/concept-shop-control` on the VM is its own independent local git repo (its
commit history does not match this repo's history) — it exists purely for
on-server change tracking and rollback. Deploys are done by copying files onto
the server and committing there afterward.

## Steps

1. **Back up first.**
   - `pg_dump` the live database.
   - `tar` the current `/opt/concept-shop-control` app directory.
   - Save both under `~/backups/` on the VM (naming convention seen in use:
     `shopcontrol-app-precutover-<timestamp>.tar.gz`,
     `shopcontrol-db-precutover-<timestamp>.dump`).

2. **Copy the new code onto the server.**
   - Overwrite `client/` and `server/` under `/opt/concept-shop-control` with the
     updated source (via SFTP/SCP/rsync from a maintainer's machine).
   - **Never overwrite `server/.env`** — it is gitignored and holds live secrets/
     config. If it needs to change, edit it directly on the server and keep a
     timestamped backup copy (e.g. `.env.bak-<timestamp>`) first.

3. **Install dependencies.**
   ```bash
   cd /opt/concept-shop-control/server
   npm install
   ```

4. **Run migrations.**
   ```bash
   npm run migrate
   ```
   `migrate` (`server/src/migrate.js`) re-runs **every** file in `server/migrations/*.sql`
   in order on every deploy — it does not track which migrations already ran. This is
   only safe because every migration file is written idempotently (`IF NOT EXISTS`,
   `ON CONFLICT`, etc.). **Any new migration must follow that same idempotent style**,
   or re-running `npm run migrate` on a later deploy will fail or duplicate data.

5. **Commit on the server** for local change tracking/rollback:
   ```bash
   cd /opt/concept-shop-control
   git add -A
   git commit -m "Deploy <short description>"
   ```

6. **Restart the service.**
   ```bash
   sudo systemctl restart shop-control-api.service
   ```
   Unit file: `/etc/systemd/system/shop-control-api.service`
   (`WorkingDirectory=/opt/concept-shop-control/server`,
   `EnvironmentFile=.../server/.env`, `ExecStart=/usr/bin/node src/index.js`,
   `Restart=on-failure`).

7. **Verify.**
   ```bash
   systemctl is-active shop-control-api.service
   ```
   Then check the live app in a browser and spot-check the changed feature.

## Test first

Before touching production, test the build on the VM against an isolated copy:

- Copy the app to `~/shopcontrol-test`.
- Point `.env` at a separate database (e.g. `concept_shop_control_test`) on a
  different port (e.g. `4001`).
- Set `EMS_WATCH_ENABLED=false`, `TASK_EMAIL_ENABLED=false`,
  `CORE_NOTIFICATIONS_ENABLED=false` so no real files are processed and no real
  staff emails are sent.
- Run through the acceptance checks in `UPGRADE.md` before deploying to prod.

## Rollback

Stop the service, restore the pre-deploy app tarball and database dump from
`~/backups/`, and restart the service.
