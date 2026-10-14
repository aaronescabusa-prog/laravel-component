# TMC EventEase

TMC EventEase is a Laravel and React application for managing campus events and
their related administrative workflows. The React single-page application is
built with Vite and served by Laravel; the API uses Sanctum bearer-token
authentication and MySQL/MariaDB in the standard development configuration.

## What the system supports

- **Accounts:** administer user profiles and roles, review pending accounts,
  and manage account imports. Administrators can create Students, Scanners, and
  other Admins; Scanner is a dedicated role rather than a variation of Staff
  or Organizer.
- **Events:** create and manage events, audiences, capacity, approvals,
  schedules, penalties, and certificate settings.
- **Audience eligibility:** target by role, department, program, and year.
  Department is derived from the account's program. When criteria are combined,
  all selected criteria must match. The API rechecks eligibility and capacity
  when registrations are created or moved.
- **Registration and attendance:** maintain participant rosters, check-in
  sessions, QR-based attendance, reminders, and calendar invites. Students can
  register themselves for approved, eligible events and retrieve only their
  own registrations. Scanners can access rosters and record attendance only
  for approved events explicitly assigned to them by an administrator.
- **Communications and outcomes:** publish announcements, collect evaluations,
  issue and deliver certificates, review activity logs, and view reports.
- **Administration:** role-aware navigation, application settings, and
  administrator-only management operations.

The sidebar is filtered by role for usability. The API independently enforces
authentication, account status, and resource permissions; hiding a navigation
link is not an authorization control.

### Web-admin sign-in

The React web application is an administrator-only portal. Its login form uses
`POST /api/auth/admin-login`, which issues a token only for an active Admin
account. Non-admin users are redirected away from protected web pages, and
self-registration is not offered in the web interface. The general
`POST /api/auth/login` and `POST /api/auth/register` endpoints remain available
for the separate mobile user application; the web client does not use them.

### Student and scanner API

The repository contains the Laravel API and web-admin SPA, not a student mobile
application. A mobile client can use the existing Sanctum bearer-token
authentication with these endpoints:

- `GET /api/events` — list approved events visible to a Student.
- `POST /api/registrations/self` with `{"event_reference":"..."}` — register
  the authenticated Student. The API derives identity and pass data from the
  account and enforces approval, eligibility, duplicate-registration, and
  capacity rules.
- `GET /api/registrations` and `GET /api/registrations/{reference}` — read only
  the Student's own registrations.
- `GET /api/scanner/events` — list approved events assigned to the authenticated
  Scanner, including the event check-in token needed to open the scanner flow.
- `GET /api/checkin/{token}`, `POST /api/checkin/{token}/punch`, and
  `POST /api/checkin/{token}/mark` — view the assigned roster and record
  attendance. Assignment and active-account status are checked server-side on
  each request. Session configuration, poster generation, and scanner
  assignment endpoints are administrator-only.
- `POST /api/checkin/{token}/scan` with `{"qr_code":"PASS-...","session_id":1,"direction":"in"}`
  — record a scan from the mobile scanner against that event's registered pass.
  Use `direction: "out"` to record a departure. The API only matches passes
  registered for the event and returns the participant and attendance result.
  The web-admin check-in roster refreshes periodically from the same attendance
  records, so the mobile scan appears there without a separate admin action.

The personal registration QR/pass is returned with the registration response;
the mobile app should present it to authorized event scanners. An event's
check-in token identifies the event but does not grant scanner permission.

### Flutter mobile feature-to-endpoint crosswalk

The mobile client calls the Laravel API below; it does not call React pages.
Prefix every path with the API base URL (`https://<web-host>/api`, or the
configured local equivalent). Send `Accept: application/json` and, for JSON
bodies, `Content-Type: application/json`. After login, send
`Authorization: Bearer <token>` on authenticated requests. All protected routes
also require an active account.

| Mobile feature | API endpoint | What the web backend currently does |
| --- | --- | --- |
| Create student account | `POST /auth/register` | Accepts `firstName`, `lastName`, `email`, `course`, `year`, `password`, and optional `role` (`Student` is the default). New accounts are `Pending` and need web-admin approval before login. The self-registration request does not accept `block_no`. |
| Sign in / sign out | `POST /auth/login`; `POST /auth/logout` | Mobile user login returns `{user, token}`. The separate web-admin login uses `POST /auth/admin-login` and only accepts active Admin accounts. Suspended or not-yet-active accounts cannot sign in. Keep the mobile bearer token in secure storage and clear it after logout. |
| Load student profile | `GET /auth/me` | Returns the signed-in account, including `course`, `year`, `block_no`, and derived `department` / `department_name`. Department is calculated from the account's course. There is no student profile-edit endpoint. |
| Load department, course, and year choices | `GET /events/courses` | Returns the web app's supported `courses`, `departments`, and `years` for authenticated users. Use these values instead of hard-coding a separate mobile list. |
| Browse and view events | `GET /events`; `GET /events/{event_reference}` | A Student sees approved events. List responses are Laravel-paginated (`data`, `current_page`, `next_page_url`, etc.). The list supports `search`, `status`, and `target_role` query parameters. Event data includes capacity and audience target fields. |
| Check department / course / year eligibility | No preview endpoint | `POST /registrations/self` enforces event status, role, department, course, year, duplicate registration, and capacity. It creates a registration when allowed and returns a `422` validation error with a reason when denied; do not call it as a read-only eligibility check. |
| Register for an event | `POST /registrations/self` with `{"event_reference":"EVT-..."}` | The server derives the student's identity and issues a registration reference and `qr_code` pass. The client must not submit its own participant, email, role, or QR value. A successful request returns the created registration (`201`). |
| My events, pass, and attendance history | `GET /registrations`; optionally `GET /registrations/{registration_reference}` | Student results are scoped to the signed-in account and include registration/attendance data such as `attendance` and `qr_code`. This is the current source for upcoming event registrations and attendance history; there is no separate student attendance-history route. |
| Cancel an event registration | Not available to Students by default | `DELETE /registrations/{registration_reference}` is not permitted by the default Student write-role policy. Do not expose cancellation in the mobile app until a dedicated, ownership-checked student cancellation flow is added. |
| Add an event to calendar | `GET /registrations/{registration_reference}/calendar` | Returns an `.ics` calendar invite for that registration's event. Use an authenticated download request. |
| Read announcements | `GET /announcements` | Student responses are limited to published announcements addressed to `Students` or `All Users`. Announcements are not currently filtered by department. |
| Submit event evaluation | Not available as an API route | An `EvaluationController` exists, but `/evaluations` is not registered in `routes/api.php`. The mobile app cannot submit evaluations to this web backend yet. |
| View and download certificates | `GET /certificates`; `GET /certificates/{certificate_reference}`; `GET /certificates/{certificate_reference}/download` | Student list/detail/download access is restricted to certificates matching the authenticated student's email. The download returns a PDF; include the bearer token. |
| Scanner's assigned events and QR attendance | `GET /scanner/events`; `GET /checkin/{event_token}`; `POST /checkin/{event_token}/scan` | Scanner accounts can view only assigned event rosters. A scan body uses `qr_code`, `session_id`, and `direction` (`in` or `out`). This is the staff/scanner workflow, not the Student event-pass lookup. |

#### Where to find the web implementation

All routes are declared in `routes/api.php`; these controllers implement the
mobile-facing behavior:

- Authentication, registration, and profile read:
  `app/Http/Controllers/Api/AuthController.php`
  (`login`, `register`, `logout`, `me`).
- Event list, details, and academic choices:
  `app/Http/Controllers/Api/EventController.php`
  (`index`, `show`, `coursesIndex`); registration eligibility is checked by
  `app/Services/EventEligibility.php`.
- Student registrations, issued pass, attendance fields, and calendar:
  `app/Http/Controllers/Api/RegistrationController.php`
  (`selfRegister`, `index`, `show`, `calendar`).
- Announcements:
  `app/Http/Controllers/Api/AnnouncementController.php` (`index`).
- Certificates:
  `app/Http/Controllers/Api/CertificateController.php`
  (`index`, `show`, `download`).
- Scanner roster and attendance scan:
  `app/Http/Controllers/Api/EventScannerController.php`
  (`assignedEvents`) and `app/Http/Controllers/Api/CheckInController.php`
  (`show`, `scan`).
- Evaluation storage code exists at
  `app/Http/Controllers/Api/EvaluationController.php`, but no evaluation
  routes currently connect it to the mobile client.

The event list currently returns all approved events to Students; it does not
accept a department query filter or provide a registration-eligibility preview.
The backend still enforces audience rules when a student registers, but a
mobile screen that needs to explain restrictions before registration will need
a dedicated eligibility endpoint. Other mobile-overview features without a
current API include student cancellation, evaluation submission, department-
specific announcements, push notifications, waitlists, personalized
recommendations, and participation-statistics summaries. Treat offline
viewing as a client-side cache feature; registration and attendance still need
server confirmation.

## Requirements

- PHP `^8.3` and Composer.
- Node.js and npm compatible with the versions required by the installed Vite
  dependencies.
- MySQL or MariaDB for a typical shared/deployed environment. Tests use the
  configured test database and should not be pointed at production data.

## Local development

1. Install PHP dependencies and prepare the environment:

   ```sh
   composer install
   cp .env.example .env
   php artisan key:generate
   ```

   On Windows PowerShell, use `Copy-Item .env.example .env` instead of `cp`.

2. Create a local database and configure `DB_*` values in `.env`. The example
   file uses MySQL with a database named `eventease`; set a dedicated local
   database user rather than reusing a privileged account where possible.

3. Run migrations and install the locked frontend dependencies:

   ```sh
   php artisan migrate
   npm ci
   npm run build
   ```

4. Start the application:

   ```sh
   composer run dev
   ```

   This starts Laravel, Vite, and a queue listener for local development. For
   separate processes, use `php artisan serve`, `npm run dev`, and
   `php artisan queue:listen --tries=1 --timeout=0`.

Demo records are opt-in outside production. Do not enable demo data on a real
deployment: it includes published sample credentials. Production seeding is
blocked by the application. Provision the first administrator through a
controlled, reviewed operational process and set a unique password.

## Configuration notes

- `.env.example` uses `QUEUE_CONNECTION=database`. Keep a queue worker running
  under a process supervisor in deployed environments; queued work will not be
  processed otherwise.
- The example mailer is `log`, which records outbound mail rather than
  delivering it. Configure and test a production mail transport before relying
  on certificate delivery. Certificate emails are queued on the default queue;
  ensure a worker consumes it (for example, `php artisan queue:work --queue=default`).
- A daily event-reminder command is registered for 08:00 application time.
  Configure Laravel's scheduler to run every minute in production, for example:

  ```cron
  * * * * * cd /path/to/laravel-component && php artisan schedule:run >> /dev/null 2>&1
  ```
- The application expects to be served at the domain root with the web server
  document root pointed at Laravel's `public/` directory. A subdirectory mount
  is supported through the base URL metadata emitted by the app view; verify
  generated asset and API URLs in the target hosting configuration.
- In XAMPP, use an Apache PHP version compatible with the Composer requirements.
  Configure the virtual host/document root to expose `public/`, or verify the
  project's subdirectory setup and access restrictions before use.

## Quality checks

Run the checks used by this repository before merging or releasing:

```sh
php artisan test
npm run build
git diff --check
```

There is no standalone JavaScript test runner or lint script configured.
Frontend changes should pass the production build and the browser smoke checks
listed below; no automated browser-test suite is configured.

## Release and operations checklist

### Before deployment

- [ ] Review the release diff and migration plan; test the migration against a
  recent, non-production database copy.
- [ ] Run the full PHP test suite and the production frontend build.
- [ ] Verify target PHP extensions, web-server rewrite rules, writable Laravel
  storage/cache directories, and the web root (`public/`).
- [ ] Set production-only environment values outside source control:
  `APP_ENV=production`, `APP_DEBUG=false`, a protected `APP_KEY`, production
  database credentials, mail credentials, and HTTPS-aware secure session
  cookies.
- [ ] Confirm HTTPS, trusted host configuration, security headers, CORS/stateful
  Sanctum settings if applicable, and certificate-upload size limits.
- [ ] Provision the first administrator securely. Never use demo credentials
  or publish credentials in deployment notes.
- [ ] Take and verify a database backup. Back up uploaded/private files and
  certificate templates as required by the deployment's retention policy.

### Deploy

1. Install production dependencies and build assets:

   ```sh
   composer install --no-dev --optimize-autoloader
   npm ci
   npm run build
   ```

2. Apply reviewed migrations:

   ```sh
   php artisan migrate --force
   ```

3. Refresh Laravel's production caches only after environment configuration is
   correct:

   ```sh
   php artisan config:cache
   php artisan route:cache
   php artisan view:cache
   ```

4. Restart queue workers after deployment, confirm the scheduler is running,
   and inspect application/worker logs for failures. Do not run demo seeders in
   production.

### Smoke-test after deployment

- [ ] Sign in as an administrator and confirm role-appropriate navigation.
- [ ] Verify account search/filtering and a controlled account update.
- [ ] Create or update a draft event; verify department/program consistency,
  audience/year filters, schedule validation, and capacity behavior.
- [ ] Confirm a participant who meets the target can register and an
  ineligible participant is rejected; verify the full-capacity case.
- [ ] Exercise check-in for a test event and confirm attendance is reflected in
  the registration/reporting workflow.
- [ ] Verify announcement visibility, evaluation submission, and certificate
  preview/download. Send a test email only after mail transport is configured.
- [ ] Check mobile and tablet widths, keyboard navigation, dialog dismissal,
  loading/empty/error states, and the primary flows with representative
  administrator and staff/organizer accounts.
- [ ] Confirm logs, scheduled reminders, queue processing, and backup
  monitoring are healthy.

## Security and data handling

The codebase includes authentication and role middleware, login/registration
throttling, account-status checks, password/token revocation flows, security
headers, and tests for selected security-sensitive behaviors. These are
implementation controls, not a guarantee of security or a substitute for a
deployment-specific review.

Never commit `.env`, credentials, tokens, private participant data, or production
backups. Keep `APP_DEBUG=false` on internet-accessible environments. Restrict
database and storage access, use least-privilege service accounts, monitor
failed jobs and logs, and periodically test database and file restoration.
Report suspected vulnerabilities through the institution's approved security
contact or disclosure process.

## Further Laravel documentation

For framework-specific usage, see the [Laravel documentation](https://laravel.com/docs).
