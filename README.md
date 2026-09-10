# Unified edition — start here

Read [UPGRADE.md](UPGRADE.md) for the current setup, migration, and verification instructions. The older setup notes below are historical; the unified app serves its client and API together.

# Concept Shop Control — Multi-User Edition

This turns the original single-browser prototype into a real shared app:

- **`server/`** — Node.js + Express API backed by PostgreSQL. Handles login and all
  CRUD for the six sections (Daily GO List, Tasks, Parts, Vehicle QC, Booth Filters,
  Facility Checklist). Every record tracks who created/updated it.
- **`client/`** — The same front end you already had (same look, same tabs, same
  dashboard), now pulling and saving data through the API instead of localStorage.
  Data is shared across every computer/tablet that opens it, and refreshes
  automatically every 20 seconds so everyone sees current info.

Employees log in with an individual username/password (JWT-based session, 12-hour
expiry by default).

---

## 1. Prerequisites on your VM

- Node.js 18 or newer
- PostgreSQL 14+ (you said you already have somewhere to host this — any Postgres
  instance works, local to the VM or elsewhere on your network)

Check versions:
```bash
node -v
psql --version
```

## 2. Create the database

On the Postgres server:
```sql
CREATE USER shopapp WITH PASSWORD 'choose-a-real-password-here';
CREATE DATABASE concept_shop_control OWNER shopapp;
```

Load the schema:
```bash
psql -h <db-host> -U shopapp -d concept_shop_control -f server/schema.sql
```

> Already set up the database from an earlier version of this project? Just run
> `psql -h <db-host> -U shopapp -d concept_shop_control -f server/migrations/001_add_can_delete.sql`
> instead of starting over — it adds the one new column needed for delete permissions.

## 3. Configure and start the API server

```bash
cd server
npm install
cp .env.example .env
```

Edit `.env`:
- `DATABASE_URL` — point at the database you just created
- `JWT_SECRET` — generate a real one:
  ```bash
  node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
  ```
- `CORS_ORIGIN` — set to wherever you'll host the client, e.g. `http://192.168.1.50:8080`
  (or leave as `*` while testing on your own network)

Create the first login (this becomes your admin account):
```bash
node src/create-user.js jweldon "YourRealPassword123" "James Weldon" admin
```

Start it:
```bash
npm start
```

You should see `Concept Shop Control API listening on port 4000`. Test it:
```bash
curl http://localhost:4000/api/health
```

### Keeping it running (systemd)

Create `/etc/systemd/system/shop-control-api.service`:
```ini
[Unit]
Description=Concept Shop Control API
After=network.target postgresql.service

[Service]
Type=simple
User=shopapp
WorkingDirectory=/opt/concept-shop-control/server
EnvironmentFile=/opt/concept-shop-control/server/.env
ExecStart=/usr/bin/node src/index.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
```
Then:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now shop-control-api
```

## 4. Configure and serve the client

Edit `client/config.js` and point it at your API:
```js
window.API_BASE = "http://<your-vm-ip-or-hostname>:4000/api";
```

Any static file server works. Quick options:

- **Simplest** — Python's built-in server (fine for a shop LAN):
  ```bash
  cd client
  python3 -m http.server 8080
  ```
- **nginx** — serve `client/` as a static site, and reverse-proxy `/api` to
  `localhost:4000` on the same box if you want everything on one URL/port (recommended
  once you move past testing, since it also makes HTTPS easy with a cert).

Then open `http://<your-vm-ip>:8080` on any employee's computer or tablet.

## 5. Adding employees / managing permissions

There's now a built-in **Employees** tab in the app — it only appears for logins
with the `admin` role. From there an admin can:

- Add a new employee (name, username, temporary password, role, and whether they're
  allowed to delete records)
- Revoke or grant delete permission for anyone, at any time — takes effect
  immediately, even on a session they're already logged into
- Deactivate/reactivate a login
- Promote/demote between `employee` and `admin`
- Reset anyone's password

You can also do all of this from the command line if you'd rather not use the UI:
```bash
cd server
node src/create-user.js mikep "SomeStrongPassword!" "Mike P" employee
```
Or directly against the API:
```
GET    /api/users
POST   /api/users            { username, password, fullName, role, canDelete }
PATCH  /api/users/:id        { active, role, canDelete, fullName }  (any subset)
POST   /api/users/:id/reset-password   { password }
```
A couple of built-in safety rails: an admin can't deactivate or demote their own
account (so you can't accidentally lock yourself out), and delete permission is
checked against the database on every delete request rather than cached in the
login token, so revoking it takes effect right away rather than waiting up to 12
hours for the token to expire.

### On permissions in general

Right now it's role/flag-based rather than department-based: everyone who's logged
in can see and edit everything, and the only restriction is whether they're allowed
to delete. If down the road you want tighter rules — e.g., only the Parts department
can edit Parts records, or Painters can't touch Vehicle QC — that's a bigger change
(each record and each user would need a department tag, and every route would need
to check it), but it's a natural next step if you find you need it. Just say the
word.

## 6. Backups

Your data now lives in Postgres instead of a browser, so back up the database
itself instead of using the old CSV export buttons (though those still work fine
as quick day-to-day exports):
```bash
pg_dump -h <db-host> -U shopapp concept_shop_control > backup_$(date +%F).sql
```
Put that on a cron job.

## Notes / things worth knowing

- **Security**: change the default JWT_SECRET and all passwords before real use.
  Put this behind HTTPS (a reverse proxy like nginx or Caddy with a Let's Encrypt
  cert, or your own internal CA) once it's reachable outside your shop's LAN.
- **Sync**: every open browser tab polls for updates every 20 seconds, and there's
  a manual "Refresh Data" button in the header for an instant pull. It's not
  real-time (no websockets) but is more than enough for a shop-floor tool people
  check throughout the day.
- **Permissions**: every logged-in employee can create and edit any record (same as
  the original single-computer version), but deleting is gated by the per-person
  "Can delete records" flag set in the Employees tab. Use that to keep newer or
  less-trusted employees from deleting things while still letting them do
  everything else.


---

# Corrected Version Upgrade Notes

This ZIP was upgraded from the later/correct base that already included `can_delete`.

Added in this build:

- **Expanded employee roles**
  - admin, owner, manager, office, estimator, parts, paint, body, qc, cleanup, employee
- **Preserved delete permission**
  - The existing `can_delete` user setting is still supported
- **Activity Log**
  - Tracks create, update, delete, and upload actions
  - Shows who changed what and when
- **Photos / Attachments tab**
  - Upload images or PDFs tied to records
  - Useful for QC photos, booth filter pictures, parts return photos, and damage proof
- **Dashboard alert cards**
  - Customer Updates Needed
  - Cars Sitting Too Long
  - Deliveries Today Not Ready
  - Supplements Not Approved
  - Parts Need Mirror Match
- **Supplement approval tracking**
  - Added Supplement Submitted and Supplement Approved fields

## Updating an existing database

If you already ran the older `001_add_can_delete.sql`, keep it. Then run this new migration:

```bash
psql -h <db-host> -U shopapp -d concept_shop_control -f server/migrations/002_activity_uploads_roles_alerts.sql
```

If this is a brand new database, loading `server/schema.sql` is enough.

## Upload folder

Photos/files save in:

```text
server/uploads
```

Or set a custom path in `.env`:

```bash
UPLOAD_DIR=/opt/concept-shop-control/server/uploads
MAX_UPLOAD_BYTES=10485760
```

Back up both:

1. The PostgreSQL database
2. The upload folder


---

# Booth Filter Countdown

This version adds a main dashboard booth filter countdown.

How it works:

- The countdown looks at the most recent Booth Filter Log record where:
  - `Filters Changed = Yes`
  - `Booth Date` has a date
- It counts down from 30 days after that date.
- When there are 5 days or fewer left, the card turns yellow.
- After 30 days, the card turns red and shows how many days overdue it is.
- The **Reset Filter Countdown** button creates a new Booth Filter Log entry for today with `Filters Changed = Yes`.

Recommended process:

1. Physically change the booth filters.
2. Click **Reset Filter Countdown** on the Dashboard.
3. Add a note if needed.
4. Upload a booth filter photo in the Photos tab or update the Booth Filter Log picture status.


---

# CCC EMS Import

This version adds a **CCC Import** tab.

How it works:

- Upload a CCC EMS DBF-style file such as `.AD2`, `.AD1`, `.AD3`, or `.DBF`.
- The server parses the EMS table directly.
- It creates or updates a Daily GO List record.
- It tries to match existing records by RO / estimate / claim number when those fields are present.
- If the file does not include vehicle year/make/model/VIN, the vehicle field will show `Vehicle from CCC`.

The sample AD2 file provided includes customer/shop/timing fields but does not include full vehicle data. If vehicle data is missing, export/upload the matching EMS vehicle file from CCC as well.

Mapped fields include:

- Customer name
- Vehicle year/make/model/VIN when present
- RO / estimate / claim number when present
- Target delivery date
- RO in date
- Estimator
- Location
- Marketing/source
- Phone/email when present

Imported Daily GO List defaults:

- Stage: Check-In
- Department Responsible: Estimator
- Estimate Needed: Yes
- Estimate Completed: No
- Customer Updated Today: No


## CCC full EMS package import update

The CCC Import tab now supports uploading the full EMS output set at one time.

Recommended files to select together:

- `.env` for RO/file/supplement metadata
- `.ad1` for insurance, owner, claim, deductible, loss date
- `.ad2` for shop, estimator, RO in date, target date
- `.veh` for year, make, model, VIN, plate, color, mileage, paint code
- `.ttl` for gross/net/supplement totals
- `.stl` for estimate section totals
- `.lin` for line items and parts
- `.ven` and profile files when available

What gets imported:

- Daily GO List record
- Vehicle description with VIN/plate/color when available
- Owner/customer name
- Target delivery date
- Estimator
- Insurance/claim/deductible notes
- Estimate and supplement total notes
- Parts records from `.lin` part line items

If the same RO already exists, the Daily GO List record is updated instead of duplicated. Parts line items are skipped if an imported line with the same RO and description already exists.


---

# CCC Full EMS File Set Import

The CCC Import tab now accepts multiple EMS files at the same time.

Recommended files to select together:

- `.ENV` - RO number, EMS package info, supplement number
- `.AD1` - insurance, claim, owner/insured, deductible
- `.AD2` - estimator, target date, location
- `.VEH` - year, make, model, VIN, color, paint code, mileage, plate
- `.TTL` - estimate totals, tax, deductible, supplement amount
- `.STL` - labor/category totals
- `.LIN` - estimate line items and parts lines
- `.VEN` - vendors
- profile files like `.PFH`, `.PFL`, `.PFM`, `.PFO`, `.PFP`, `.PFT`

What gets created/updated:

- Daily GO List record matched by RO number when available
- Vehicle info from `.VEH`
- Insurance/claim notes from `.AD1`
- Target date and estimator from `.AD2`
- Estimate totals in notes from `.TTL`
- Parts records from `.LIN` when the line includes a part number and price/quantity

For your sample file set, the importer can identify:

- RO: 17767
- Vehicle: 2023 Honda Accord Sedan LX, VIN 1HGCY1F29PA011296
- Insurance: State Farm
- Claim: 55-0H3M-90501
- Gross total: 8972.94
- Supplement amount: 1059.83


---

# Self-Service Password Reset and HTTPS

This version adds two production-ready setup items:

1. Self-service password reset by email
2. Direct HTTPS support using certificate/key files

## Database migration

Run this migration on an existing database:

```bash
psql -h <db-host> -U shopapp -d concept_shop_control -f server/migrations/003_password_reset_https.sql
```

If this is a brand-new database, loading `server/schema.sql` is enough.

## User email addresses

Employees need an email address saved to receive password reset emails.

Admins can add the email address when creating a user from the Employees tab.

The CLI user creator also supports email as the final argument:

```bash
node src/create-user.js josh "StrongPassword123" "Josh Agah" admin true josh@example.com
```

## SMTP setup

Add these values to `server/.env`:

```bash
PUBLIC_CLIENT_URL=https://your-shop-app-domain.com

SMTP_HOST=smtp.your-email-provider.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@example.com
SMTP_PASS=your-smtp-password
SMTP_FROM="Concept Shop Control <your-email@example.com>"
PASSWORD_RESET_EXPIRES_MINUTES=30
```

How it works:

- Employee clicks **Forgot password?**
- Employee enters username or email
- App emails a time-limited reset link
- Link opens the app with `?resetToken=...`
- Employee enters a new password
- Token can only be used once and expires after the configured time

For security, the forgot-password screen always says a reset email was sent if the account exists. This prevents people from guessing valid usernames.

## HTTPS certificate setup

You can run HTTPS directly from Node by adding certificate paths in `server/.env`:

```bash
HTTPS_PORT=4443
SSL_KEY_PATH=./certs/server.key
SSL_CERT_PATH=./certs/server.crt
SSL_CA_PATH=
FORCE_HTTPS=false
```

Create this folder if it does not exist:

```bash
mkdir -p server/certs
```

Put your cert files there:

```text
server/certs/server.key
server/certs/server.crt
```

Then start the server:

```bash
cd server
npm install
npm start
```

If `SSL_KEY_PATH` and `SSL_CERT_PATH` are set and the files exist, the API starts in HTTPS mode.

If the certificate files are missing, the server falls back to HTTP and prints a warning.

## Important HTTPS note

For a real public cloud setup, a reverse proxy like Nginx, Caddy, Cloudflare Tunnel, or a load balancer is still usually cleaner for HTTPS. Direct Node HTTPS works well for an internal server or a simple deployment.


---

# CCC EMS Auto Import Watcher

This version can automatically import CCC EMS files from a server folder.

Your CCC output folder:

```text
\\Conceptserver\ccc\EMS\EMSOUT
```

## Recommended setup

If the app is running directly on `Conceptserver`, use a local path instead of a UNC path because it is more reliable for a Windows service:

```text
C:\ccc\EMS\EMSOUT
```

If the app is running on another server, use the UNC path:

```text
\\Conceptserver\ccc\EMS\EMSOUT
```

## Environment settings

Add this to `server/.env`:

```bash
EMS_WATCH_ENABLED=true
EMS_WATCH_DIR=\\Conceptserver\ccc\EMS\EMSOUT
EMS_ARCHIVE_DIR=\\Conceptserver\ccc\EMS\EMSOUT\_processed
EMS_ERROR_DIR=\\Conceptserver\ccc\EMS\EMSOUT\_error
EMS_WATCH_INTERVAL_MS=30000
EMS_FILE_STABLE_MS=5000
EMS_REQUIRE_ENV=true
```

## How it works

- The server scans the EMS output folder every 30 seconds.
- It groups files by the shared filename prefix, such as `99ec69da`.
- It waits until the file sizes and modified times stop changing.
- It requires a matching `.ENV` file by default, because `.ENV` confirms the EMS package is complete.
- It imports the file set into:
  - Daily GO List
  - Parts, when `.LIN` contains part-number lines
  - Activity Log
- After import, it moves the whole EMS file set into:

```text
_processed
```

- If import fails, it moves the files into:

```text
_error
```

and writes an `import-error.txt` file.

## Important Windows service permission note

The Windows user running the Node service must have read/write access to:

```text
\\Conceptserver\ccc\EMS\EMSOUT
```

If running as a Windows service, do not use `LocalSystem` unless the share permissions are configured for it. Prefer a domain/local service account that has permission to the share.

## Avoid duplicate imports

The auto importer archives successfully imported EMS files, so they do not import over and over.

If you want to keep CCC's original EMSOUT folder untouched, change `EMS_ARCHIVE_DIR` to another location on the server.


---

# Dashboard First, Grouped Parts, and Task Emails

This version adds the requested workflow changes.

## Dashboard first

- Dashboard is now the first tab on the left.
- Dashboard is the first screen users see after login.

## Parts grouped by vehicle / RO

The Parts tab now shows one row per vehicle/RO instead of one giant list of every part line.

The grouped view shows counts for:

- Total parts
- Open parts
- Need to Order
- Waiting / ordered / backordered
- Need mirror match
- Returns / credits

Click **Open Parts** to see the individual part lines in a pop-out.

## Task assignment email

When a task is created or reassigned, the system looks up the assigned employee by:

- Full name
- Username
- Email
- First name

If that employee has an email address saved, the app sends a task assignment email.

## Task reminder emails

The task reminder scheduler can send:

- 1 hour reminder to the assigned employee
- 3 hour urgent reminder to the assigned employee with owner CC

Reminder emails only send during business hours:

```text
Monday through Friday
8:00 AM to 5:00 PM
America/Los_Angeles
```

## Database migration

Run this migration on an existing database:

```bash
psql -h <db-host> -U shopapp -d concept_shop_control -f server/migrations/004_dashboard_parts_task_emails.sql
```

## Environment settings

Add or confirm these in `server/.env`:

```bash
TASK_EMAIL_ENABLED=true
TASK_URGENT_CC=josh@conceptautobody.net
OWNER_EMAIL=josh@conceptautobody.net
BUSINESS_TIMEZONE=America/Los_Angeles
BUSINESS_START_HOUR=8
BUSINESS_END_HOUR=17
TASK_REMINDER_SCAN_MS=600000
```

SMTP must also be configured for task emails to send.

```bash
SMTP_HOST=smtp.your-email-provider.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@example.com
SMTP_PASS=your-smtp-password
SMTP_FROM="Concept Shop Control <your-email@example.com>"
```

## Important employee setup

For emails to work, each employee needs an email address saved in the Employees tab.

