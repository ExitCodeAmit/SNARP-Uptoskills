# Production deployment

This guide describes a single-origin deployment: one Node.js process (or container) runs the Express API and also serves the Vite build from `frontend/dist/`. An HTTPS proxy or platform load balancer sits in front. It does not depend on a specific cloud provider.

Two supported ways to run it:

- **Docker:** the root [`Dockerfile`](Dockerfile) builds the frontend and runs the API as the non-root `node` user. [`docker-compose.yml`](docker-compose.yml) adds PostgreSQL 17 for a self-hosted stack.
- **Node.js host:** build with `npm run build` and start with `npm start` from the repository root.

## 1. Provision PostgreSQL

Create a PostgreSQL database and an application role before starting the API. Grant the role connection access and the schema privileges needed to apply migrations. In production the API does not try to create the database; it connects and applies pending migrations. (`DB_AUTO_CREATE=true` restores the development behaviour if the role is allowed to create databases.)

Use a managed PostgreSQL service or a separately backed-up database host. Enable TLS for database connections when supported by the provider, restrict inbound access to the API host, and schedule backups before upgrades.

## 2. Configure the API

Set these environment variables in the deployment platform's secret/configuration manager. Do not put production secrets in `.env` or commit them.

| Variable | Production guidance |
|---|---|
| `NODE_ENV` | Set to `production` |
| `DATABASE_URL` | Connection string from the database provider; append `?sslmode=require` when it requires TLS. Takes precedence over the `PG*` variables |
| `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGSSLMODE` | Alternative to `DATABASE_URL` |
| `PGDATABASE` | Name of the pre-created SNARP database |
| `PGPOOL_MAX` | Per-process PostgreSQL connection limit; budget the sum across all API instances under the database connection limit. Defaults to 10 and accepts 1 to 100. |
| `JWT_SECRET` | Unique secret of at least 32 bytes from a secret manager; rotate only with a planned session invalidation |
| `PORT` | Port assigned by the hosting platform, if any |
| `TRUST_PROXY` | Set only when deployed behind a known reverse proxy; use the exact hop count or trusted proxy IP/CIDRs |
| `APP_URL` | Public HTTPS address of the site, for example `https://snarp.example.org`; used in verification links |
| `SMTP_URL` (or `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`) and `MAIL_FROM` | Outgoing mail for verification emails. Without SMTP, links are written to the server log and nobody receives them |
| `PAPER_MAX_PDF_BYTES` | Optional PDF size limit, at most 10 MiB |
| `SERVE_FRONTEND` | Leave unset to serve `frontend/dist` from the API; `false` when another host serves the frontend on the same domain |
| `API_RATE_LIMIT`, `WRITE_RATE_LIMIT` | Optional overrides for the per-IP API limit (default 1500 per 15 minutes) and per-account write limit (default 30 per minute) |

The API itself sends a Content Security Policy and the other security headers, and HSTS when `NODE_ENV=production` and the request arrived over HTTPS (which it can only tell when `TRUST_PROXY` is set correctly). Configure the proxy to terminate HTTPS and forward `X-Forwarded-For` and `X-Forwarded-Proto`. The API and frontend share one origin, so no CORS configuration is needed. Never set `TRUST_PROXY=true`.

## 3. Build and start

Use Node.js 22.13 or newer and install from the checked-in lockfiles:

```sh
cd backend
npm ci
node --check server.js
npm test

cd ../frontend
npm ci
npm test
npm run lint
npm run build
```

The repository root has the same steps as scripts: `npm run build` installs production backend dependencies and builds the frontend; `npm start` starts the API.

Start the API under the platform's process manager. It applies pending migrations at startup under a PostgreSQL advisory lock, then serves `/api/*` and the built frontend (hashed assets cached for a year, `index.html` with `no-cache`, and `index.html` for client-side routes). Back up the database before the first rollout of a new migration; do not run two independent deployment jobs that bypass the migration runner.

Set the platform or proxy health check to `GET /api/health`; it returns `200` only when PostgreSQL responds and `503` otherwise. The Docker image has the same check built in.

### Docker

```sh
cp .env.docker.example .env
docker compose up --build -d
docker compose logs -f app
```

To use a managed database instead of the bundled one, run only the image: `docker build -t snarp .` then `docker run -p 5000:5000 -e NODE_ENV=production -e DATABASE_URL=... -e JWT_SECRET=... snarp`.

### Verify a deployment

```sh
npm --prefix backend run smoke https://staging.example.com
```

The smoke test signs up a temporary account, exercises the main flows and deletes the account at the end. It needs the target server to run with `REQUIRE_EMAIL_VERIFICATION=false`, so use it on staging or CI rather than on production. Prefer staging; on production it leaves only an `account.delete` audit record.

## 4. Initial access and operations

Registration creates `user` or `author` accounts only, and each must confirm its email before the first login. After setting SMTP, run `npm --prefix backend run mail:test -- you@example.com` to confirm the login and delivery. At startup the log shows `smtp_ready` when the SMTP login works, or `smtp_login_failed`, `smtp_not_configured` or `app_url_not_set`; failed sends are logged as `verification_email_failed` or `password_reset_email_failed`. Promote the first administrator through a restricted database session (`UPDATE users SET role = 'admin' WHERE email = '...'`), then use the admin account to inspect moderation and audit activity. Moderators can remove reported posts from the dashboard; each removal is recorded in the audit log. Do not expose database credentials through the app or browser.

The API emits structured JSON process and error logs without logging request bodies or credentials. The process handles `SIGTERM` and `SIGINT` by stopping new HTTP requests and closing the PostgreSQL pool. Allow at least 15 seconds for graceful shutdown.

## 5. Scale and recovery notes

- Rate-limit counters use Express's in-memory store. Run one API process until a shared production store is selected and load-tested; multiple instances do not share counters.
- Set `PGPOOL_MAX` so `instance count × pool max` leaves room for migrations, administration, and other database clients.
- Direct-message threads refresh by polling, not WebSockets. Increase the polling interval or add a measured real-time transport before expecting high concurrent usage.
- The search endpoints use bounded page-based queries and `ILIKE`; PostgreSQL full-text/trigram search remains future work for larger datasets.
- Migrations are transactional and ordered, but schema rollback is not automatic. Restore a verified backup or deploy a forward-fix migration if an upgrade fails after rollout.
- Test database restore, secret rotation, proxy health checks, and shutdown behavior in a staging environment before production traffic.

## Verification boundary

The repository's CI checks syntax, unit tests, frontend lint and the production build, builds the Docker image, and runs the production server against a fresh PostgreSQL 17 database with the smoke test (all migrations, auth, posts, likes, comments, password change, served frontend). It does not test upgrades of an existing database with real data or load. Run the documented workflows against a disposable staging copy of production data before the first rollout. No production deployment is performed by this guide.
