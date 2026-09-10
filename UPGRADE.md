# Shop Control with Production Boards

This package combines Shop Control and the Concept Production Board in one interface. The original Shop Control snapshot and standalone board remain preserved separately. This package has not been installed on the live shop server.

## What is included

- Teal interface with dashboard, Production, Delivery, Planning, Calendar, Opportunities, Settings, and employee notifications alongside existing shop tools.
- Production cards and Shop Control jobs use the same database record and current stage. Other computers refresh automatically; conflicting edits ask staff to refresh rather than overwrite changes.
- Parts selection by RO, select all, bulk edit, and permission-controlled bulk delete. Core checkboxes create employee alerts and queue email.
- Five-digit ROs identify jobs. Other identifiers identify opportunities. Active jobs counts include only cars explicitly marked physically onsite. Scheduled, On the Road, and No Show remain separate queues.
- Opportunities matching one active job by customer, vehicle, and positive dollar amount are linked and hidden from the open queue when those fields are saved/imported. Matching dollar amounts alone do not remove unrelated estimates. History is retained.
- Calendar appointments link to jobs. Settings include insurance, staff, colors, flags (including emoji), appointment types, locations, and core recipients.

## Upgrade an existing installation

Have the person maintaining the shop server perform these steps first against a restored test copy of the database.

1. Back up PostgreSQL and the existing installation, including uploads, `.env`, and certificates. Record the currently deployed version. This package was based on GitHub master commit `66ceb37b15a261c8e0b9b5aa297c6aef2f6f9e80`; compare any newer work before replacing it.
2. Extract into a new installation folder. Preserve the existing server configuration, uploads, and HTTPS configuration in that folder. Never use the sample database password or secret. For initial testing, disable the CCC watcher and set `CORE_NOTIFICATIONS_ENABLED=false` and `TASK_EMAIL_ENABLED=false` to avoid processing real files or contacting staff.
3. Open a terminal in `server` and run `npm install` using an internet connection.
4. Point `DATABASE_URL` in `server/.env` at the test database. Run `npm run migrate`. This applies the numbered migrations, including `010_unified_workspace.sql`. Stop if a migration reports an error. Do not run `setup-db` on an existing installation.
5. Run `npm start` or use `START-SHOP-CONTROL.cmd`. Default address is `http://localhost:4000`; use the existing HTTPS address when configured. The server now serves the interface and API together. Set `PUBLIC_CLIENT_URL` to that same address; do not run a separate client web server.
6. Check the acceptance steps below on the test copy. After verification, stop the old service, take a fresh backup, repeat the migration against the intended database, and start the new service using the shop's existing service manager. Restore the desired CCC watcher and notification settings.

Rollback requires stopping the new service and restoring the matching database backup, original application, and uploads. Keep the original backup until the upgrade is accepted.

## New installation

Install Node.js and PostgreSQL. Create an empty database and database user. In `server`, run `npm install`, copy `.env.example` to `.env`, and configure the connection and a long random JWT secret. Run `npm run setup-db` once, then create the first administrator:

```text
npm run create-user -- USERNAME PASSWORD "Full Name" admin
npm start
```

Choose a private password; shell history may record this command. All users access the same server address. The employee interface is at `/mobile/` and shares the main login on that address.

## Existing cars and board data

Existing records start with onsite unconfirmed. In the jobs view, select the unconfirmed/offsite list and mark the cars actually present as physically onsite. Imports alone never confirm arrival. Scheduled jobs require a five-digit RO. Use On the Road and a follow-up date/notes for IOU parts or opportunities requiring calls; staff change these to Scheduled or No Show after contact.

To bring over the standalone board, export its JSON backup and open the unified Settings import option as an administrator. Review the preview before confirming. Imports match an existing unique RO or a previously imported board ID; ambiguous matches are rejected. The reviewed backup can update matching job stages, details, calendar entries, and settings. New imported records require onsite confirmation. Keep the original board backup. Sample/demo backups are rejected.

## Core notifications

Enable employee notifications on staff accounts and select core recipients in Settings. With no configured recipients, active owner/admin/office/parts staff are used; the assigned employee is also included when their username or full name matches. Email needs valid staff email addresses and working SMTP settings. Core alerts appear in the main and employee interfaces. Browser alerts require permission and the employee page to remain open; background push while the app is closed is not implemented. The worker checks every 30 seconds and retries failed email up to ten times. An interruption after email delivery but before recording success can cause a duplicate email.

## Acceptance checks before live use

1. Sign in as an administrator and an employee. Confirm the employee cannot perform forbidden deletes or change settings.
2. Mark a five-digit RO onsite. Move it between production columns and verify its current stage in Shop Control and a second browser. Verify Scheduled and On the Road remove it from onsite counts.
3. Create a non-five-digit opportunity. Confirm equal amounts on different cars remain separate. Save a unique matching customer/vehicle/amount active job and confirm the opportunity leaves the open queue while history remains.
4. Select an RO's parts, bulk edit, and delete test parts. Confirm other ROs are unaffected. Mark a test part as having a core and verify its employee alert. Enable email only for a designated test recipient and check delivery.
5. Create, edit, and delete linked appointments. Review a real board backup import on the test database and retry it to check matching behavior.
6. Check existing CCC import, task assignment, QC, uploads, and employee workflows before switching the live service.

## Verification supplied with this package

Run `npm test` in `server`. The 21 passing checks cover shared job rules, frontend rendering and saves, route permissions, bulk transaction behavior, edit conflict guards, import mapping, and core notification queue behavior using mocks. Syntax checks also pass. After installing dependencies on the desktop, a fresh local PostgreSQL 18 database successfully applied all migrations. The running app passed login, interface delivery, core API reads, and job stage update/restore. Full browser workflows, migration of existing production data, and actual email delivery still require verification. Complete the acceptance checks on a test installation before production use. See HANDOFF.md for the GitHub and Claude testing handoff.
