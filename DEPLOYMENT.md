# Production deployment

This guide describes a single-origin deployment: a static host serves the Vite build and a reverse proxy sends `/api/*` traffic to the Express API. It does not depend on a specific cloud provider.

## 1. Provision PostgreSQL

Create a PostgreSQL database and an application role before starting the API. Grant the role connection access and the schema privileges needed to apply migrations. The backend checks for the configured database by connecting to the maintenance database `postgres`; pre-create the database if the managed service role cannot create databases.

Use a managed PostgreSQL service or a separately backed-up database host. Enable TLS for database connections when supported by the provider, restrict inbound access to the API host, and schedule backups before upgrades.

## 2. Configure the API

Set these environment variables in the deployment platform's secret/configuration manager. Do not put production secrets in `.env` or commit them.

| Variable | Production guidance |
|---|---|
| `NODE_ENV` | Set to `production` |
| `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD` | Credentials and address for the provisioned PostgreSQL service |
| `PGDATABASE` | Name of the pre-created SNARP database |
| `PGPOOL_MAX` | Per-process PostgreSQL connection limit; budget the sum across all API instances under the database connection limit. Defaults to 10 and accepts 1–100. |
| `JWT_SECRET` | Unique secret of at least 32 bytes from a secret manager; rotate only with a planned session invalidation |
| `PORT` | Port assigned by the hosting platform, if any |
| `TRUST_PROXY` | Set only when deployed behind a known reverse proxy; use the exact hop count or trusted proxy IP/CIDRs |
| `PAPER_MAX_PDF_BYTES` | Optional PDF size limit, at most 10 MiB |

Configure the proxy to accept HTTPS, set HSTS and a Content Security Policy, and forward only the headers needed by the application. Keep the API and frontend on the same origin to avoid broad CORS configuration. Never set `TRUST_PROXY=true`.

## 3. Build and start

Use Node.js 22.12 or newer and install from the checked-in lockfiles:

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

Deploy `frontend/dist/` to a static host with SPA fallback routing. Start the API with `npm start` under the platform's process manager. The API applies pending migrations at startup under a PostgreSQL advisory lock. Back up the database before the first rollout of a new migration; do not run two independent deployment jobs that bypass the migration runner.

Configure the reverse proxy to route `/api/*` to the API and serve other paths from the frontend build with `index.html` fallback. Set the proxy's health check to `GET /api/health`; it returns `200` only when PostgreSQL responds and `503` otherwise.

## 4. Initial access and operations

Registration creates `user` or `author` accounts only. Promote the first administrator through a restricted database session, then use the admin account to inspect moderation and audit activity. Do not expose database credentials through the app or browser.

The API emits structured JSON process and error logs without logging request bodies or credentials. The process handles `SIGTERM` and `SIGINT` by stopping new HTTP requests and closing the PostgreSQL pool. Allow at least 15 seconds for graceful shutdown.

## 5. Scale and recovery notes

- Rate-limit counters use Express's in-memory store. Run one API process until a shared production store is selected and load-tested; multiple instances do not share counters.
- Set `PGPOOL_MAX` so `instance count × pool max` leaves room for migrations, administration, and other database clients.
- Direct-message threads refresh by polling, not WebSockets. Increase the polling interval or add a measured real-time transport before expecting high concurrent usage.
- The search endpoints use bounded page-based queries and `ILIKE`; PostgreSQL full-text/trigram search remains future work for larger datasets.
- Migrations are transactional and ordered, but schema rollback is not automatic. Restore a verified backup or deploy a forward-fix migration if an upgrade fails after rollout.
- Test database restore, secret rotation, proxy health checks, and shutdown behavior in a staging environment before production traffic.

## Verification boundary

The repository's CI checks syntax, unit tests, frontend lint, and the frontend production build. Those checks do not start PostgreSQL or validate migrations against a live server. Run the documented workflows against a disposable staging database before the first production rollout. No production deployment is performed by this guide.
