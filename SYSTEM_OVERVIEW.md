# JAPS System Overview

This document summarizes the system as implemented in this repository. It is
intended as a technical orientation guide; it does not imply that every
deployment option described here is currently active.

## What the system does

JAPS is an operations and management application for a transport service. It
supports owner/admin management and reporting, conductor ticketing and
remittances, driver workflows, and audit-teller review. It includes a dashboard
forecast for passenger demand, revenue, and bus utilization.

## Architecture at a glance

```text
Browser
  Angular single-page application
       | HTTPS / JSON REST requests, session cookie
       v
  Express API (Node.js)
       | Sequelize and SQL queries
       v
  PostgreSQL

  Email notifications: Gmail SMTP via Nodemailer
  Ticket printing: browser Web Bluetooth (supported devices/browsers required)
```

In the documented EC2 deployment, Nginx serves the Angular build and forwards
`/api/` requests to the Express process. The API and frontend are therefore
same-origin in that setup.

## Languages and main technologies

| Area | Technologies |
|---|---|
| Web frontend | Angular 21, TypeScript, RxJS, HTML, CSS |
| Backend/API | Node.js, Express 5, CommonJS JavaScript |
| Persistence | PostgreSQL, Sequelize ORM, plus SQL queries for some reports |
| Operations and deployment | Bash shell scripts, Nginx, PM2, Certbot |
| Utility tools | Python owner-account creation utility; JavaScript ticket-printer utility |

The client also uses Tailwind CSS and PrimeIcons. The conductor ticket-printing
flow uses Web Bluetooth and `html2canvas-pro`. The repository declares Power BI
client packages, but active Power BI use in the application source is not
established by the code examined.

## Frontend

The Angular application starts at `client/src/main.ts`. Routes are split into
lazy-loaded areas for owner, conductor, driver, and audit-teller workflows, as
well as authentication. Owner and admin-staff accounts share owner-portal
access. Route guards check login and role; conductor ticketing also checks
printer setup.

Feature pages use Angular `HttpClient` to request JSON from the API. In
development the configured API base URL is `http://localhost:3000`; the
production environment uses a relative URL so requests go to the same origin
that served the client. An HTTP interceptor sends credentials with API
requests.

The frontend keeps the logged-in user profile in Angular application state.
The authentication token itself is an HTTP-only cookie rather than a value
stored in local or session storage.

Relevant files:

- Routes: `client/src/app/app.routes.ts` and each feature area's `*.routes.ts`
- Environment/API base URL: `client/src/environments/environment.ts` and
  `client/src/environments/environment.production.ts`
- Authentication and request credentials:
  `client/src/app/core/services/auth.service.ts` and
  `client/src/app/core/interceptors/auth.interceptor.ts`
- Printer setup and ticket printing:
  `client/src/app/core/services/printer-setup.service.ts`

## Backend and API

The backend is a single Express application started by `server/index.js`.
Routes are grouped by area under `server/routes/`, handlers live in
`server/controllers/`, shared authentication/authorization middleware is in
`server/middleware/auth.js`, and Sequelize models and associations are in
`server/models/`.

The API is mounted under `/api`, with namespaces for authentication, users,
buses, routes, drivers, conductors, audit tellers, fare settings, notifications,
and owner functions. Typical request flow is:

1. The browser sends an HTTP request with its cookie.
2. Express route middleware validates the JWT and, where required, checks the
   caller's role.
3. A controller reads or updates PostgreSQL through Sequelize or a SQL query.
4. The response is returned as JSON. Workflow actions may also create a
   persistent notification or send an email.

The system's roles are `owner`, `admin_staff`, `audit_teller`, `conductor`, and
`driver`. The backend issues a JWT in an HTTP-only cookie; production cookie
settings use `secure` and `SameSite=None`. Owner-level endpoints are restricted
to owner/admin-staff roles. The cookie lifetime configured in the login flow is
30 minutes.

The database connection is configured through `server/config/database.js` and
environment variables (`DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_HOST`, and
`DB_PORT`). The PostgreSQL dialect is used, SSL is configurable, and the
database timezone is set to `+08:00` for Manila-local date handling.

The server calls Sequelize model synchronization at startup. `DB_SYNC_MODE`
defaults to `alter`; `force` drops and recreates tables and must not be used for
normal production operation; `none` disables automatic synchronization. The
deployment guide recommends leaving the production setting unset rather than
using `force`.

## Data storage, provenance, and fetching

The primary source of operational data is the application's PostgreSQL
database. The application does not appear to import a third-party transport
dataset or call a public data API for the forecasting or operational
dashboards. Data is entered or generated through JAPS workflows and stored in
the database; the browser reads it through the application's own REST API.

Important records represented by the backend models include users, buses,
routes and stops, crew assignments, trips, tickets, passenger counts, fare
settings, remittances, remittance expenses, and notifications. For example,
conductors use the application to ticket trips and submit remittances, and
audit tellers review remittances. These records feed owner reporting and
forecasting.

Forecast data is fetched on the backend, not calculated from a separate
external data feed:

- **Passenger demand:** a daily series derived from trips. Passenger counts
  are obtained from ticket records, ticket-number ranges, or the
  `passenger_counts` records, depending on available trip data. The forecast
  endpoint gap-fills the passenger series over a 90-day window.
- **Revenue:** approved remittances, using `net_collection + cash_deposit`,
  gap-filled over a 90-day window.
- **Bus utilization:** distinct buses with trips divided by the active-bus
  count. This query uses a 90-day lower bound but does not fill missing dates
  in the same way as passenger and revenue series.

The database's records, completeness, and consistency therefore affect
dashboard and forecast results. In particular, the utilization series may have
missing days, and the source of passenger counts can vary with which trip and
ticketing records are available.

## Forecasting and the role of linear regression

Forecasting is implemented in `server/services/forecast/` and exposed through
`GET /api/owner/forecast`. The Angular owner forecasting page requests that
endpoint. It returns predictions and related dashboard information such as
forecast series, peak-hour information, seasonal factors, and a method label
for each series.

**Linear regression is a fallback method, not the sole or default method in
every case.** The system attempts a `RandomForestRegression` model for
passenger, revenue, and utilization forecasts when there are at least 60
positive-value observations. The random forest uses 100 estimators and a
fixed seed. For passenger and revenue, if the data is not ready for that model,
the fallback fits ordinary least-squares linear regression of the observed
daily values against their row positions (a simple time trend). It then
adjusts the trend using weekday seasonal factors. The revenue fallback blends
the trend and seasonality components at 70% and 30%, respectively. Utilization
uses exponential smoothing with alpha 0.3 as its fallback.

For the machine-learning path, the daily features include weekday, day of
month, month, a holiday flag, lag-1 value, lag-7 value, and rolling 7-day
average. Forecasts are generated recursively: each rounded, nonnegative
prediction is fed into the next day's feature calculation. The forecast model
is built when requested; no persisted trained model is shown in these code
paths. The holiday feature uses a hard-coded Philippine holiday list, including
movable dates only through 2027.

These are operational forecasts, not evidence of validated predictive
accuracy. The implementation paths do not show a held-out evaluation,
forecast-error metrics, or model-selection procedure. Readiness is based on
the number of positive-value observations, not necessarily on a continuous
60-day history. Forecasts should be interpreted with those limits in mind.

## Notifications and other integrations

- **Email:** Nodemailer sends application email through Gmail SMTP, configured
  with `SMTP_USER` and `SMTP_APP_PASSWORD`. Templates cover account, trip,
  assignment, and remittance events.
- **In-app notifications:** Workflow notifications are stored in PostgreSQL
  and retrieved through the API.
- **Ticket printing:** The browser uses Web Bluetooth to communicate with a
  compatible printer; the browser/device must support the required capability.
- **Excel:** ExcelJS is included for spreadsheet-related functionality.

No separate cache, queue, or microservice layer is evident in the backend
package and application structure examined.

## Hosting and deployment

The repository's deployment guide documents a production setup with one
Amazon Linux 2023 EC2 instance:

- Nginx serves the built Angular files and reverse-proxies `/api/` to Express.
- PM2 manages the Express process on `127.0.0.1:3000`.
- PostgreSQL must be reachable separately; the EC2 scripts do not provision
  the database. A managed database is one documented option.
- Certbot configures HTTPS. The guide supports an `sslip.io` hostname for an
  Elastic IP, or a real domain.
- `deploy/deploy.sh` pulls the selected branch, installs dependencies, builds
  the client, reloads the backend with PM2, and reloads Nginx.

There are also other repository configurations, which should not be confused
with proof of the active production host:

- `client/vercel.json` configures a static Angular build and SPA fallback, but
  does not configure an API/backend proxy.
- `server/scripts/migrate-to-render.sh` documents moving PostgreSQL data to
  Render; by itself it does not establish that the application is hosted on
  Render.

For the documented EC2 procedure and required environment variables, see
[`deploy/README.md`](deploy/README.md). Production secrets belong in
`server/.env`, not in source control. The server's
`server/.env.production.example` is the configuration template.

## Local development and tests

The client has an Angular CLI development server, production build, and unit
test setup. Its project instructions are in [`client/README.md`](client/README.md).
The backend contains focused tests for forecast construction, Manila time,
manual ticket handling, and remittance calculations under
`server/services/` and `server/utils/`.

## Key files to orient yourself

| Concern | Files |
|---|---|
| Client entry and top-level routes | `client/src/main.ts`, `client/src/app/app.routes.ts` |
| Client authentication and API environment | `client/src/app/core/services/auth.service.ts`, `client/src/environments/` |
| API bootstrap and database | `server/index.js`, `server/config/database.js` |
| API routes and access control | `server/routes/`, `server/middleware/auth.js` |
| Models and associations | `server/models/` |
| Owner reporting and forecast data queries | `server/routes/ownerRoutes.js` |
| Forecast methods and data readiness | `server/services/forecast/` |
| EC2/Nginx/PM2 deployment | `deploy/` |

