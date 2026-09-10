# Shop Control Unified — September 10, 2026

This is the current source from Josh's desktop test version, ready for repository review and further testing. It has not been deployed to the live shop server.

## GitHub handoff

Target repository: https://github.com/jimweldon49/shopcontrol

The base snapshot was master commit `66ceb37b15a261c8e0b9b5aa297c6aef2f6f9e80`. Compare newer repository work before applying this source. Extract the ZIP and place the contents of `shopcontrol-unified` at the repository root on a review branch. Do not nest the entire folder inside the existing app. Review the diff and merge after testing. No GitHub upload or live deployment has been performed by this package.

## Claude testing brief

Review and test the supplied Shop Control Unified application. Preserve existing Shop Control workflows while validating the integrated Production, Delivery, Planning, Calendar, Opportunities, Settings, and employee notification views. Use an isolated PostgreSQL database with sample data; do not connect to the live shop database or send staff emails. Follow UPGRADE.md for installation.

Focus testing on:

- Production card movements and Shop Control current stage saving to the same job; concurrent edits and second-client refresh.
- Five-digit RO classification, explicit onsite counts, Scheduled, On the Road, No Show, and safe opportunity matching by customer, vehicle, and positive amount.
- Parts select-all, bulk edit/delete boundaries and permissions; core event creation, recipient selection, retries, and return handling.
- Linked calendar CRUD, delivery stage transitions, planning buckets, settings permissions, and reviewed legacy-board imports with repeat-import behavior.
- Existing CCC imports preserving workflow status, QC, employee login, uploads, task assignment, and mobile workflows.
- Browser layout and interactions on desktop and mobile, authorization enforcement, migration behavior on a restored pre-upgrade database, and regression tests.

Report reproducible findings and fix confirmed defects without changing the agreed workflow. Browser notifications currently require the employee page to remain open; background push is not implemented. On the Road follow-up is staff-managed.

## Verification status

The 21 automated checks pass. These include mocks and pure frontend/model checks, not complete end-to-end coverage. A fresh local PostgreSQL 18 database successfully applied the schema and all ten migrations. The running desktop app passed HTTP interface delivery, administrator login, jobs/parts/calendar/settings/notification API reads, and shared job stage update/restore against PostgreSQL. Real SMTP delivery, an upgrade of existing production data, and comprehensive browser workflows still need verification.

## Package contents and isolation

Includes source, public-registry dependency lockfile, migrations, tests, launcher, and setup instructions. Excludes desktop `.env`, passwords, database contents, sample-account setup scripts, installed dependencies, uploads, and private certificates. Configure a new `.env` for the receiving environment. For isolated testing use localhost, a dedicated database, `EMS_WATCH_ENABLED=false`, `TASK_EMAIL_ENABLED=false`, and blank SMTP values. See UPGRADE.md before production deployment.
