# SNARP: Social Networking & Academic Research Platform

An UptoSkills internship MVP where students and researchers share updates, publish research and connect with communities.

This README describes the project **as it stands today**: what works end to end, what is UI only, and how to run it.

---

## Contents

- [Current status](#current-status)
- [Tech stack](#tech-stack)
- [Architecture](#architecture)
- [Getting started](#getting-started)
- [Deployment](#deployment)
- [Configuration](#configuration)
- [Database schema](#database-schema)
- [API reference](#api-reference)
- [Project structure](#project-structure)
- [Design system](#design-system)
- [Security notes](#security-notes)
- [Testing](#testing)
- [Production deployment](DEPLOYMENT.md)
- [Roadmap and known limitations](#roadmap-and-known-limitations)

---

## Current status

| Feature | Status | Notes |
|---|---|---|
| Landing page | ✅ Working | GSAP scroll animations, shown to logged-out visitors at `/` |
| Sign up / log in / log out | ✅ Working | bcrypt password hashing, password strength rules and meter, per-account login lockout, revocable server-tracked JWT sessions (1 or 7 days), return to the requested page after login |
| Email verification | ✅ Working | New accounts confirm their email through a one-time link (24 hours) before logging in; resend with a one-minute cooldown; without SMTP the link is printed in the server log |
| Forgot password | ✅ Working | "Forgot password?" on the login page emails a one-time reset link (60 minutes, stored only as a hash). The reset page sets a new password with the strength meter, signs out every device, confirms the email address and is audited (`account.password_reset` with source `email`). The answer is the same whether or not the email has an account |
| Member ↔ Author switch | ✅ Working | Settings → Account type switches between Member and Author at any time (audited as `account.role_change`); members opening Submit a paper get a one-click "Switch to Author". Moderator and admin roles cannot be changed this way |
| Signed-in devices | ✅ Working | Settings lists every active session by browser and OS, with sign-out for one device or all others |
| Feed: create text posts | ✅ Working | Up to 5000 characters |
| Feed: post images with a description | ✅ Working | JPEG, PNG, GIF, WebP up to 5 MB, stored in PostgreSQL as `BYTEA` |
| User profiles | ✅ Working | Persistent name, institution, department, bio, interests, skills, links and photo; public profiles show approved papers, posts, and post/paper/follower/following counts |
| Follow researchers | ✅ Working | Follow and unfollow from profiles; follower and following lists; "Researchers to follow" suggestions ranked by shared research interests |
| Feed: create, edit and delete own posts | ✅ Working | Up to 5000 characters; deleting also removes the post's image |
| Likes, comments, share and reports | ✅ Working | Same post card in the feed, on profiles and in search; comment authors, post owners and moderators can remove comments; duplicate reports are blocked |
| Feed pagination and filters | ✅ Working | Mixed post and approved-paper feed with Everyone / Following tabs and All / Posts / Papers filter; loads more on scroll; a "new updates" button appears when others post (checked every minute) |
| Feed composer | ✅ Working | Grows with the text; attach a photo by picking, pasting or dropping it; authors get a shortcut to submit a paper; long posts collapse behind Show more and web links are clickable |
| Feed sidebar | ✅ Working | Profile card with post/follower/following counts and a profile-completion prompt, researchers to follow, popular research topics, communities and upcoming events |
| Paper discussion | ✅ Working | Like, comment on, share and save approved papers from the feed and the paper page; submitters and moderators can remove paper comments |
| Saved papers | ✅ Working | Personal reading list at `/saved` |
| Citation tools (APA / BibTeX) | ✅ Working | Runs in the browser, needs no backend |
| Communities | Implemented MVP | Create communities, join/leave, member discussions, owner editing and post moderation persist in PostgreSQL |
| Events | Implemented MVP | Upcoming events, author/moderator/admin publishing, event details, registration and capacity enforcement persist in PostgreSQL |
| Messages | Implemented MVP | Private one-to-one conversations persist; active threads refresh periodically |
| Notifications | Implemented MVP | Persisted alerts for post likes and comments, paper likes and comments, new followers, paper reviews and messages, with unread/read state |
| Submit a paper | ✅ Working | Three steps on one page with a clickable step bar: **1 Upload** (drag and drop, Preview, "Fill in and continue" reads the PDF and shows what it found), **2 Details** (title, abstract, domain, DOI, keywords, with the PDF shown alongside on wide screens), **3 Authors & submit** (co-authors from friends, notes for reviewers and a summary with Edit links). Each step is checked before moving on, Enter moves to the next step, and server errors jump to the step with the problem. Suggested values are marked "From PDF" and can be undone |
| Co-authors (friends only) | ✅ Working | The submitter is always author 1; co-authors are picked from a searchable list of friends (mutual follows) and linked to their accounts. The server rejects anyone else. Co-authors are notified, the published paper links to their profiles and appears on them with a "Co-author" tag, and co-authors cannot peer-review the paper. Suggest from PDF adds friends named in the paper and lists the rest |
| Co-author check | ✅ Working | Papers with co-authors start in **Co-author check**: every co-author opens the PDF and approves it or requests changes with a comment. If changes are requested, the submitter uploads a corrected PDF (a new draft, earlier drafts kept) and co-authors check again. When all co-authors approve the current PDF, the paper moves to peer review automatically. After a moderator requests a revision, the resubmitted round goes through the co-author check again before reviewers see it. Papers without co-authors go straight to peer review |
| Author publishing | ✅ Working | The submitter has **Publish for everyone** while the paper is in co-author check or peer review. When every co-author has approved the current PDF it publishes after a simple confirmation; if anyone has not approved, the page warns with their names and needs **Publish anyway** (the server refuses without `force`). Publishing reveals the reviews, notifies co-authors and is audited (`paper.published_by_author`). Moderators can still publish, request changes or reject |
| Withdraw submission | ✅ Working | The submitter can withdraw any unpublished paper from My submissions or its feedback page; reviews, versions and co-author checks are removed, co-authors are told, and the withdrawal is audited (`paper.withdrawn`) |
| Peer review | ✅ Working | Authors, moderators and admins review papers they did not submit: 1 to 5 star rating, scores for originality, methodology, clarity and significance, a recommendation, comments, itemised suggestions and a private note for moderators. Reviewers stay anonymous to the author |
| Recommendations | ✅ Working | The Research papers page shows papers picked from your research interests, the papers you wrote, saved, liked or discussed, and the people you follow, each with the reason it was picked. It also suggests related topics you have not explored yet. Paper pages list related papers, and the search boxes suggest topics, papers and researchers as you type |
| Revise and resubmit | ✅ Working | Moderators approve, request changes or reject. Authors answer every suggestion (addressed or declined), explain their changes, upload a new PDF and resubmit as the next round; earlier versions stay available and previous reviewers are notified |
| Paper moderation | ✅ Working | Queues for papers under review, waiting on authors and decided, with review counts and average ratings; report queue with post removal (audited); admin audit log |
| Settings | ✅ Working | Profile fields, profile photo, password change (signs out other devices), appearance and account deletion |
| Light and dark mode | ✅ Working | Top-bar toggle and Settings → Appearance (System, Light, Dark); saved per browser; public pages stay light |
| Help center | ✅ Working | FAQ and real contact details |
| Search | ✅ Working | Researchers, posts, communities, upcoming events and approved papers from PostgreSQL |
| Production build | ✅ Ready | One container serves the API and the built frontend; Docker, health check, CI smoke test against PostgreSQL |

The app ships with no sample or demo data: a fresh database starts empty and everything a signed-in user sees comes from PostgreSQL. [`frontend/src/content.js`](frontend/src/content.js) only holds fixed copy: the help-centre FAQ and the illustrative paper in the landing page's citation animation.

Paper submission, review, approval/rejection, feed publication, search and PDF retrieval use PostgreSQL. Pending and rejected papers are excluded from public feed and search results.

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite, React Router 7, GSAP 3 (ScrollTrigger, ScrollSmoother, SplitText, DrawSVG, Flip), Phosphor Icons (app), Hugeicons (landing), Geist font (self-hosted) |
| Backend | Node.js 22.13+ (tested on 22.16 and 24), Express 5, PDF.js for reading uploaded papers |
| Database | PostgreSQL (all data, including images, lives here) |
| Auth | JWT (`jsonwebtoken`) and `bcryptjs` |
| Uploads | Multer (in-memory) with file-signature validation |
| Deployment | Dockerfile (multi-stage, Node 22 Alpine), docker-compose with PostgreSQL 17, GitHub Actions CI |

No external storage (Cloudinary, S3, R2) is used. **Everything is stored in PostgreSQL.**

---

## Architecture

```mermaid
flowchart LR
    subgraph Browser
        UI["React app<br/>(Vite :5173 in development,<br/>served by Express in production)"]
    end
    subgraph Server["backend/ (Express :5000)"]
        API["REST API<br/>/api/*"]
        AUTH["JWT auth middleware"]
        UP["Multer upload<br/>+ image signature check"]
    end
    DB[("PostgreSQL<br/>database: snarp")]

    UI -- "/api requests<br/>(Vite proxy)" --> API
    API --> AUTH
    API --> UP
    API -- "pg pool" --> DB
    UI -- "&lt;img src=/api/images/:uuid&gt;" --> API
```

- In development, Vite proxies every `/api` request to `http://localhost:5000` (see [`frontend/vite.config.js`](frontend/vite.config.js)), so there are no CORS issues.
- **In production the API also serves the frontend.** When `frontend/dist/` exists, Express serves the built files (hashed assets cached for a year, `index.html` never cached) and returns `index.html` for client-side routes. Frontend and API share one origin, so no CORS configuration is needed. Set `SERVE_FRONTEND=false` to host the frontend elsewhere behind the same domain.
- **The backend sets itself up on start.** It applies pending migrations under an advisory lock. In local development (no `NODE_ENV=production`, no `DATABASE_URL`) it first creates the `snarp` database if it does not exist. Production expects the database to exist already.
- In local development, the backend generates a random `JWT_SECRET` and saves it to `backend/.env` when none is set. Production must provide a unique secret of at least 32 bytes through the deployment environment or a secret manager.
- Signup, login, password changes, content writes and the API as a whole use in-memory rate limits. Configure `TRUST_PROXY` only when deployed behind a trusted reverse proxy; use its hop count or explicit trusted proxy IP/CIDRs. The built-in store is suitable for a single process, not shared across multiple instances.

### Request flow: creating an image post

```mermaid
sequenceDiagram
    participant U as User (Feed page)
    participant F as React (Feed.jsx)
    participant A as Express API
    participant P as PostgreSQL

    U->>F: Pick photo + write description
    F->>F: Preview image, check type and 5 MB limit
    F->>A: POST /api/posts (multipart: body, image) + Bearer token
    A->>A: Verify JWT, sniff file bytes (JPEG/PNG/GIF/WebP only)
    A->>P: One SQL statement: INSERT image, then INSERT post with image_id
    P-->>A: New post id
    A->>P: SELECT post joined with author
    A-->>F: 201 Created (post JSON with image_id)
    F->>A: GET /api/images/:image_id
    A-->>F: Image bytes (cached for 1 year)
```

---

## Getting started

### Prerequisites

- **Node.js 22.13 or newer** (the backend uses `--env-file-if-exists`, and PDF.js needs 22.13)
- **PostgreSQL** running locally (any recent version with `gen_random_uuid()`, so 13+; 17 is tested)

Or skip both and run the production stack with Docker: see [Deployment](#deployment).

### 1. Install dependencies

```bash
cd frontend
npm install
cd ../backend
npm install
```

### 2. Configure the database connection

```bash
cd backend
cp .env.example .env
```

Edit `backend/.env`:

```env
PGHOST=localhost
PGPORT=5432
PGUSER=postgres
PGPASSWORD=your_password
PGDATABASE=snarp
PORT=5000
PGPOOL_MAX=10
```

All settings are listed under [Configuration](#configuration).

> Forgot your postgres password? See [Resetting the postgres password](#resetting-the-postgres-password).

### 3. Run

Use two terminals:

```bash
cd backend
npm start
```

On the first run you should see:

```
Created database snarp
API running on http://localhost:5000
```

```bash
cd frontend
npm run dev
```

Open **http://localhost:5173**, create an account, and post.

### Available scripts

| Where | Command | What it does |
|---|---|---|
| root | `npm run build` | Install production dependencies and build the frontend (used by hosting platforms) |
| root | `npm start` | Start the API, which also serves `frontend/dist/` |
| root | `npm test` | Backend tests, frontend tests and lint |
| frontend | `npm run dev` | Start the Vite dev server |
| frontend | `npm run build` | Production build into `frontend/dist/` |
| frontend | `npm run lint` | ESLint over frontend source |
| frontend | `npm test` | Citation helper tests |
| backend | `npm start` | Start the API |
| backend | `npm run dev` | Start the API with auto-restart |
| backend | `npm test` | Validation, session, discovery and migration-runner unit tests |
| backend | `npm run reset-password -- <email>` | Set a new password for an account from the server (hidden input) and sign it out everywhere; audited |
| backend | `npm run mail:test [-- you@example.com]` | Checks the SMTP login from `.env` and optionally sends a test email; explains common problems such as a Gmail password instead of an App Password |
| backend | `npm run smoke [url]` | End-to-end API check against a running server and database; its temporary account deletes itself at the end. The server must run with `REQUIRE_EMAIL_VERIFICATION=false` |
| backend | `npm run seed:demo` | Seed synthetic recommendation examples through local submission and moderation APIs (development only) |

### Seed recommendation demo data

Start PostgreSQL and the backend first. In a separate PowerShell terminal in `backend`, explicitly enable the local-only seed and run it:

```powershell
$env:NODE_ENV = 'development'
$env:ALLOW_DEMO_SEED = 'true'
npm run seed:demo
```

The repeatable seed submits ten synthetic papers, with valid demonstration PDFs, under clearly marked demo accounts and approves them through the existing moderation API. Their tags and notes identify them as `DEMO DATA`; their dates are illustrative only, and they have no DOI or real-person authors. The seed refuses production mode, production-named databases, and non-local PostgreSQL hosts. It does not update or remove existing records. After seeding, save interests from **Settings** using the existing profile form, then open `/search`.

### Resetting the postgres password

1. Open `C:\Program Files\PostgreSQL\<version>\data\pg_hba.conf` as Administrator.
2. Change `scram-sha-256` to `trust` on the `127.0.0.1/32` and `::1/128` lines, then restart the service (`Restart-Service postgresql-x64-<version>` in an admin PowerShell).
3. Run `psql -U postgres -p <port> -c "ALTER USER postgres PASSWORD 'new_password';"`
4. **Change `trust` back to `scram-sha-256`** and restart the service again.

---

## Deployment

Full rollout, scaling and operations notes are in [DEPLOYMENT.md](DEPLOYMENT.md). The short version:

### Option A: Docker (recommended)

```bash
cp .env.docker.example .env
docker compose up --build -d
```

This starts PostgreSQL 17 and the app on **http://localhost:5000**. The image builds the frontend, installs only production dependencies, runs as the non-root `node` user and has a health check on `/api/health`. Put an HTTPS reverse proxy (Caddy, Nginx, a cloud load balancer) in front and set `TRUST_PROXY=1`.

Generate secrets with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### Option B: Any Node.js host (Render, Railway, a VM)

| Setting | Value |
|---|---|
| Build command | `npm run build` |
| Start command | `npm start` |
| Health check path | `/api/health` |
| Environment | `NODE_ENV=production`, `DATABASE_URL` (add `?sslmode=require` for hosted PostgreSQL), `JWT_SECRET`, `TRUST_PROXY=1` when the platform puts a proxy in front |

Create the database first; the app applies migrations on start. Then promote the first admin:

```sql
UPDATE users SET role = 'admin' WHERE email = 'you@example.com';
```

### Before going live

- [ ] `NODE_ENV=production` and a unique `JWT_SECRET` (32+ bytes) from the platform's secret store
- [ ] HTTPS in front of the app, `TRUST_PROXY` set to the proxy hop count
- [ ] Database backups scheduled and a restore tested
- [ ] `npm run smoke https://staging.example.com` passes against staging
- [ ] One API instance only, until rate limits use a shared store

---

## Configuration

Environment variables read by `backend/server.js`. Local development reads `backend/.env`; production should use the platform's secret manager.

| Variable | Default | Purpose |
|---|---|---|
| `NODE_ENV` | unset | `production` requires `JWT_SECRET`, turns off database auto-creation and enables HSTS over HTTPS. You can also set it in `backend/.env` to run the production build locally |
| `DATABASE_URL` | unset | Full connection string; overrides the `PG*` values. Supports `?sslmode=require` |
| `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` | `snarp` database | Standard PostgreSQL settings, used when `DATABASE_URL` is unset |
| `PGSSLMODE` | unset | `require` or `no-verify` for TLS without a connection string |
| `DB_AUTO_CREATE` | `true` in development | Create the database on start if missing |
| `PGPOOL_MAX` | `10` | Connections per API process (1 to 100) |
| `JWT_SECRET` | generated locally | Token signing secret, at least 32 bytes; required in production |
| `PORT` | `5000` | HTTP port |
| `TRUST_PROXY` | unset | Proxy hop count or trusted proxy IPs/CIDRs; never `true` |
| `APP_URL` | request address (development), `http://localhost:PORT` (production) | Public site address used in emailed links. Set it in production; the request Host header is never trusted there |
| `SMTP_URL` | unset | SMTP connection URL for outgoing mail, for example `smtps://user%40gmail.com:app-password@smtp.gmail.com:465` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE` | unset, `587`, unset, unset, `true` on port 465 | Alternative to `SMTP_URL` |
| `MAIL_FROM` | `SMTP_USER` | Sender shown on verification emails |
| `REQUIRE_EMAIL_VERIFICATION` | `true` | `false` makes new accounts active immediately; use only for automated smoke tests |
| `SERVE_FRONTEND` | `true` when `frontend/dist` exists | Serve the built React app from the API |
| `FRONTEND_DIST` | `../frontend/dist` | Location of the built frontend |
| `API_RATE_LIMIT` | `1500` | Requests per IP per 15 minutes across `/api` |
| `WRITE_RATE_LIMIT` | `30` | Posts, comments, messages, reports and uploads per account per minute |
| `PAPER_MAX_PDF_BYTES` | `10485760` | PDF upload limit, capped at 10 MB |

---

## Database schema

The backend creates the database if needed, then applies ordered SQL files from [`backend/migrations/`](backend/migrations/). Applied filenames are recorded in `schema_migrations`; a PostgreSQL advisory lock prevents two server instances from applying the same migration at once. Migration `001_initial_schema.sql` also upgrades databases created by the earlier startup-based setup without dropping existing rows.

```mermaid
erDiagram
    users ||--o{ posts : "writes"
    users ||--o{ images : "uploads"
    users ||--o{ papers : "submits"
    users ||--o{ auth_sessions : "has sessions"
    users ||--o| user_profiles : "has profile"
    users ||--o{ comments : "writes"
    users ||--o{ likes : "likes"
    users ||--o{ reports : "reports"
    users ||--o{ communities : "creates"
    users ||--o{ community_members : "joins"
    users ||--o{ community_posts : "writes"
    communities ||--o{ community_members : "has members"
    communities ||--o{ community_posts : "hosts"
    users ||--o{ conversations : "participates"
    conversations ||--o{ conversation_members : "tracks reads"
    conversations ||--o{ messages : "contains"
    users ||--o{ notifications : "receives"
    users ||--o{ events : "organizes"
    users ||--o{ event_registrations : "registers"
    users ||--o{ follows : "follows"
    users ||--o{ paper_likes : "likes papers"
    users ||--o{ paper_comments : "discusses papers"
    users ||--o{ paper_saves : "saves papers"
    papers ||--o{ paper_likes : "receives"
    papers ||--o{ paper_comments : "has"
    papers ||--o{ paper_saves : "is saved"
    events ||--o{ event_registrations : "has attendees"
    posts ||--o{ comments : "has"
    posts ||--o{ likes : "receives"
    posts ||--o{ reports : "is reported"
    images |o--o| posts : "attached to"

    users {
        SERIAL id PK
        VARCHAR(100) name "NOT NULL"
        VARCHAR(255) email "NOT NULL, UNIQUE"
        TEXT password_hash "bcrypt hash"
        VARCHAR(20) role "admin | moderator | author | user"
        TEXT[] research_interests "NOT NULL, default empty list"
        TIMESTAMPTZ created_at "DEFAULT now()"
        TIMESTAMPTZ last_login_at "nullable"
        TIMESTAMPTZ email_verified_at "null until confirmed"
    }

    auth_sessions {
        UUID id PK "JWT session id"
        INTEGER user_id FK "users.id, ON DELETE CASCADE"
        TIMESTAMPTZ created_at
        TIMESTAMPTZ expires_at
        TIMESTAMPTZ revoked_at "nullable"
        TEXT user_agent "device label source"
        TIMESTAMPTZ last_seen_at
        BOOLEAN remember
    }

    user_profiles {
        INTEGER user_id PK, FK
        VARCHAR institution
        VARCHAR department
        TEXT[] research_interests
        TEXT bio
        TEXT[] skills
        JSONB links
    }

    posts {
        SERIAL id PK
        INTEGER user_id FK "users.id, ON DELETE CASCADE"
        TEXT body "max 5000 chars, may be empty if image present"
        UUID image_id FK "images.id, ON DELETE SET NULL, nullable"
        TIMESTAMPTZ created_at "DEFAULT now()"
        TIMESTAMPTZ updated_at
    }

    comments {
        BIGSERIAL id PK
        INTEGER post_id FK
        INTEGER user_id FK
        VARCHAR body
        TIMESTAMPTZ created_at
        TIMESTAMPTZ updated_at
    }

    likes {
        INTEGER post_id PK, FK
        INTEGER user_id PK, FK
        TIMESTAMPTZ created_at
    }

    reports {
        BIGSERIAL id PK
        INTEGER post_id FK
        INTEGER reported_by FK
        VARCHAR reason
        VARCHAR status
        TIMESTAMPTZ created_at
    }

    communities {
        BIGSERIAL id PK
        VARCHAR name "unique"
        VARCHAR category
        INTEGER created_by FK
        TIMESTAMPTZ created_at
    }

    community_members {
        BIGINT community_id PK, FK
        INTEGER user_id PK, FK
        VARCHAR role
        TIMESTAMPTZ joined_at
    }

    community_posts {
        BIGSERIAL id PK
        BIGINT community_id FK
        INTEGER user_id FK
        VARCHAR body
        TIMESTAMPTZ created_at
        TIMESTAMPTZ updated_at
    }

    conversations {
        BIGSERIAL id PK
        INTEGER user_one FK
        INTEGER user_two FK
        TIMESTAMPTZ created_at
    }

    conversation_members {
        BIGINT conversation_id PK, FK
        INTEGER user_id PK, FK
        TIMESTAMPTZ last_read_at
    }

    messages {
        BIGSERIAL id PK
        BIGINT conversation_id FK
        INTEGER sender_id FK
        VARCHAR body
        TIMESTAMPTZ created_at
    }

    notifications {
        BIGSERIAL id PK
        INTEGER user_id FK
        INTEGER actor_id FK
        VARCHAR kind
        BIGINT entity_id
        TIMESTAMPTZ read_at
    }

    events {
        BIGSERIAL id PK
        VARCHAR title
        TIMESTAMPTZ starts_at
        TIMESTAMPTZ ends_at
        INTEGER capacity "nullable"
        VARCHAR status
        INTEGER created_by FK
    }

    event_registrations {
        BIGINT event_id PK, FK
        INTEGER user_id PK, FK
        TIMESTAMPTZ registered_at
    }

    follows {
        INTEGER follower_id PK, FK
        INTEGER followee_id PK, FK "never equal to follower_id"
        TIMESTAMPTZ created_at
    }

    paper_likes {
        BIGINT paper_id PK, FK
        INTEGER user_id PK, FK
        TIMESTAMPTZ created_at
    }

    paper_comments {
        BIGSERIAL id PK
        BIGINT paper_id FK
        INTEGER user_id FK
        VARCHAR body "1-2000 chars"
        TIMESTAMPTZ created_at
    }

    paper_saves {
        INTEGER user_id PK, FK
        BIGINT paper_id PK, FK
        TIMESTAMPTZ created_at
    }

    images {
        UUID id PK "gen_random_uuid()"
        INTEGER user_id FK "users.id, ON DELETE CASCADE"
        VARCHAR(20) mime "detected from file bytes"
        BYTEA data "raw image bytes"
        TIMESTAMPTZ created_at "DEFAULT now()"
    }

    papers {
        BIGSERIAL id PK
        INTEGER user_id FK "users.id, ON DELETE CASCADE"
        VARCHAR(300) title "NOT NULL"
        TEXT abstract "NOT NULL"
        VARCHAR(255) doi "nullable"
        VARCHAR(120) domain "NOT NULL"
        DATE publication_date "nullable"
        TEXT[] tags
        JSONB authors
        BYTEA pdf_data "PDF, maximum 10 MB"
        VARCHAR(255) pdf_filename
        VARCHAR(20) status "pending, approved or rejected"
        INTEGER reviewed_by FK "users.id, nullable"
        TIMESTAMPTZ reviewed_at "nullable"
        TEXT rejection_reason "nullable"
        UUID idempotency_key "nullable, unique per user"
        TIMESTAMPTZ created_at
        TIMESTAMPTZ updated_at
    }
```

### Tables

#### `users`

| Column | Type | Constraints |
|---|---|---|
| `id` | `SERIAL` | Primary key |
| `name` | `VARCHAR(100)` | Not null |
| `email` | `VARCHAR(255)` | Not null, unique, stored lowercase |
| `password_hash` | `TEXT` | bcrypt hash (cost 10), never returned by the API |
| `role` | `VARCHAR(20)` | `admin`, `moderator`, `author` or `user`, default `user` |
| `research_interests` | `TEXT[]` | Saved recommendation topics; defaults to an empty list |
| `created_at` | `TIMESTAMPTZ` | Default `now()` |
| `last_login_at` | `TIMESTAMPTZ` | Set on every successful sign-up or login (migration 009) |
| `email_verified_at` | `TIMESTAMPTZ` | Null until the emailed link is opened; login is refused while null (migration 010) |

Sign-up only allows `user` or `author`. Admins and moderators must be promoted in the database:

```sql
UPDATE users SET role = 'moderator' WHERE email = 'someone@example.com';
```

#### `auth_sessions`

Each issued access token has a matching session row. Protected requests check that the session remains active and that the user's current role still grants access. Logout revokes the current session; expired and old revoked rows are pruned during sign-in. Remembered sessions expire after 7 days; unchecked “Keep me logged in” sessions expire after 24 hours. Tokens issued before this session check was deployed must be replaced by signing in again. Migration 009 adds `user_agent`, `last_seen_at` (refreshed at most every five minutes) and `remember`, which Settings uses to list signed-in devices.

#### `user_profiles`, `likes`, `comments`, and `reports`

Migration 002 stores optional academic profile fields separately from account credentials. Likes are unique per user and post; comments are owned by their author and cascade with deleted posts. Users can report another user's post once. Moderators can mark reports reviewed or dismissed.

#### `paper_reviews` and `audit_logs`

Migration 003 stores every paper approval/rejection with its reviewer and comment. Sensitive moderation actions and report dispositions also create audit records. Audit log access is admin-only; role promotion remains an out-of-band database operation.

#### Peer review: `peer_reviews`, `review_suggestions`, `paper_versions`

Migration 011 adds the review workflow. `papers.status` gains `revision_requested`, and `papers.round` counts review rounds (1 for a first submission). Each reviewer writes at most one `peer_reviews` row per paper and round, with an overall rating, four 1 to 5 scores, a recommendation (`accept`, `minor_revision`, `major_revision`, `reject`), comments for the author and an optional note for moderators. `review_suggestions` holds the itemised suggestions; the author marks each one `addressed` or `declined` with a response when resubmitting. A resubmission copies the previous title, abstract and PDF into `paper_versions`, increments `round` and sets the paper back to `pending`. `paper_reviews` (the decision history) now also records `revision_requested` and `resubmitted` (with the author's response letter) and the round.

Visibility: reviewers see the paper (including its PDF) while it is under review, the previous round's suggestions with the author's answers, and only their own review. Moderators see every review with reviewer names and notes for moderators. Authors see reviews only for rounds a moderator has decided, labelled "Reviewer 1", "Reviewer 2" and so on, never with names or moderator notes.

#### `communities`, `community_members`, and `community_posts`

Migration 004 persists community metadata, owner/member roles, and paginated discussions. Community creators are owners; only members can publish discussions. Owners and platform moderators can edit communities and remove community posts. Owners cannot leave until ownership transfer is available.

#### `conversations`, `messages`, and `notifications`

Migration 005 stores private one-to-one conversation membership and message read timestamps. Notifications are recipient-scoped and store read timestamps; likes, comments, paper decisions and direct messages create alerts. Message access is checked against conversation membership on every API request.

#### `events` and `event_registrations`

Migration 006 stores scheduled academic events and unique attendee registrations. Registration locks the event row before checking capacity, so simultaneous signups cannot exceed a configured limit. Organizers and platform moderators can edit or cancel events; registration closes when an event starts or is cancelled.

#### `follows`, `paper_likes`, `paper_comments`, and `paper_saves`

Migration 008 adds the social graph and engagement on research papers. A follow is one row per follower and followee; a check constraint blocks following yourself. The feed's Following scope shows the viewer's own items plus those of people they follow. Paper likes, comments and saves only accept approved papers and cascade when a paper or user is deleted. Following someone, or liking or commenting on their paper, creates a notification (`follow`, `paper_like`, `paper_comment`).

#### `posts`

| Column | Type | Constraints |
|---|---|---|
| `id` | `SERIAL` | Primary key |
| `user_id` | `INTEGER` | References `users(id)`, cascade delete |
| `body` | `TEXT` | Default `''` |
| `image_id` | `UUID` | References `images(id)`, set null on delete, optional |
| `created_at` | `TIMESTAMPTZ` | Default `now()` |

- **`posts_content_check`**: `length(body) <= 5000 AND (trim(body) is not empty OR image_id IS NOT NULL)`. A post needs text, an image, or both.
- **Index**: `posts_created_at_idx` on `created_at DESC` for the feed.

#### `images`

| Column | Type | Constraints |
|---|---|---|
| `id` | `UUID` | Primary key, `gen_random_uuid()` |
| `user_id` | `INTEGER` | References `users(id)`, cascade delete |
| `mime` | `VARCHAR(20)` | `image/jpeg`, `image/png`, `image/gif` or `image/webp` |
| `data` | `BYTEA` | Raw file bytes (max 5 MB, enforced by the API) |
| `created_at` | `TIMESTAMPTZ` | Default `now()` |

#### `papers`

Migration `001_initial_schema.sql` creates this table if it does not exist. It stores the uploaded PDF bytes directly in PostgreSQL `BYTEA`; submissions start as `pending`. The author is associated with the authenticated user. A nullable per-user idempotency key prevents repeated requests from creating duplicate rows.

| Column | Type | Notes |
|---|---|---|
| `id` | `BIGSERIAL` | Primary key |
| `user_id` | `INTEGER` | References `users(id)`, cascade delete |
| `title`, `abstract`, `domain` | `VARCHAR` / `TEXT` | Required paper metadata |
| `doi` | `VARCHAR(255)` | Optional validated DOI |
| `publication_date` | `DATE` | Optional date supplied with the submission |
| `tags` | `TEXT[]` | Research keywords |
| `authors` | `JSONB` | Author names and optional affiliations |
| `pdf_data` | `BYTEA` | Validated PDF content, up to 10 MB |
| `pdf_filename`, `pdf_content_type`, `pdf_size` | `VARCHAR` / `INTEGER` | Original display name and validated PDF metadata |
| `additional_notes` | `TEXT` | Optional |
| `status` | `VARCHAR(20)` | `pending`, `approved`, or `rejected`; defaults to `pending` |
| `reviewed_by` | `INTEGER` | References the reviewing user, set to null if that user is deleted |
| `reviewed_at` | `TIMESTAMPTZ` | Set when a moderator approves or rejects |
| `rejection_reason` | `TEXT` | Visible to the submitting author in My submissions |
| `created_at`, `updated_at` | `TIMESTAMPTZ` | Default `now()` |

The optional `PAPER_MAX_PDF_BYTES` setting can lower the server upload limit; it is capped at 10 MB. The default is 10,485,760 bytes.

### Upgrades

Databases created by earlier versions of this project are upgraded by the first migration: the `image_id` and profile-photo columns are added when missing, the old post constraint is replaced, paper review columns and auth sessions are added, and indexes are created. Migration `002_profiles_and_social_feed.sql` adds profile fields, post timestamps, likes, comments and reports. Migration `003_moderation_dashboards.sql` adds durable paper review history and the admin audit log. Migration `004_communities.sql` adds communities, membership and discussions. Migration `005_messages_notifications.sql` adds private conversations, messages and notifications. Migration `006_events.sql` adds events and capacity-aware registrations. Migration `007_user_timeline_indexes.sql` adds indexes for user timelines and submission history. Migration `008_follows_and_paper_engagement.sql` adds follows, paper likes, paper comments and saved papers, and widens the allowed notification kinds. Migration `009_session_devices.sql` records the device, last activity and remember choice of each session, and the last login time of each user. Migration `010_email_verification.sql` adds `users.email_verified_at` (accounts that already existed are marked verified) and the `email_verifications` table of one-time link hashes. Migration `011_peer_review.sql` adds review rounds, the `revision_requested` status, peer reviews with suggestions, archived paper versions and the `review_request` notification kind. Migration `012_coauthors.sql` adds the `coauthor` notification kind and a GIN index on `papers.authors` for finding co-authored papers. Migration `013_coauthor_checks.sql` stores each co-author's approve/changes verdict per paper round. Migration `014_coauthor_gate.sql` adds the `coauthor_check` status, draft numbers for papers, versions and checks, and the `coauthor_update` and `coauthors_approved` timeline entries. Migration `015_password_resets.sql` stores hashed one-time password reset links. The migration runner wraps each file and its version record in a transaction. Review any future migration for data compatibility before deploying it.

---

## API reference

Base URL: `http://localhost:5000/api` (or `/api` through the Vite proxy).

Authenticated routes need the header `Authorization: Bearer <token>`. Errors always return JSON: `{ "error": "message" }`, including `404` for unknown `/api` paths and `429` when a rate limit is reached.
Profile photos are stored in the `images` table. Their UUID image URLs are unguessable and can be loaded by the browser without an auth header, like post images.

| Method | Path | Auth | Body | Success response |
|---|---|---|---|---|
| `GET` | `/health` | No | | `200 { status: "ok" }` when PostgreSQL is reachable; otherwise `503` |
| `POST` | `/auth/signup` | No | JSON `{ name, email, password, role? }` | `201 { verification_required: true, email, email_sent }`; the account stays inactive until the link is opened. With `REQUIRE_EMAIL_VERIFICATION=false`: `201 { token, user }` |
| `POST` | `/auth/login` | No | JSON `{ email, password, remember? }` | `200 { token, user }`; `403` with `code: "email_unverified"` when the password is right but the email is not confirmed |
| `POST` | `/auth/verify-email` | No | JSON `{ token }` from the emailed link | `200 { token, user }` (confirms and signs in); `410` `already_verified` or `expired`; `400` `invalid` |
| `POST` | `/auth/forgot-password` | No | JSON `{ email }` | `200` with the same message whether or not the account exists; emails a reset link valid for 60 minutes; one per minute and 3 per 15 minutes per address |
| `POST` | `/auth/reset-password` | No | JSON `{ token, password }` | `200 { message, email }`; `400` invalid link or weak password (`field: "password"`), `410` used or expired link; signs out every session |
| `POST` | `/auth/resend-verification` | No | JSON `{ email }` | `200` with the same message whether or not the account exists; at most one email a minute and 3 per 15 minutes per address |
| `POST` | `/auth/logout` | Yes | | `204`; revokes this session token |
| `GET` | `/auth/me` | Yes | | `200 { id, name, email, role, created_at, avatar_url, institution, department, research_interests, bio, skills, links, post_count, paper_count, follower_count, following_count }` |
| `PUT` | `/auth/me` | Yes | JSON profile fields: `name`, `institution`, `department`, `bio`, `research_interests[]`, `skills[]`, `links[]` | Updated profile |
| `DELETE` | `/auth/me` | Yes | JSON `{ password }` | `204`; permanently deletes the account with its posts, comments, messages, papers and the communities and events it organises; the last admin cannot be deleted; audited |
| `PUT` | `/auth/me/role` | Yes | JSON `{ role: "user" | "author" }` | `{ role }`; only between Member and Author, `403` for moderators and admins, audited |
| `PUT` | `/auth/me/password` | Yes | JSON `{ currentPassword, newPassword }` | `204`; revokes every other session of this account |
| `GET` | `/auth/sessions` | Yes | | Active sessions: `{ id, device, created_at, last_seen_at, expires_at, remember, current }[]`, this device first |
| `DELETE` | `/auth/sessions` | Yes | | `{ revoked }`; signs out every other device |
| `DELETE` | `/auth/sessions/:id` | Yes | | `204`; signs out one of your own sessions, `404` otherwise |
| `PUT` | `/auth/me/photo` | Yes | `multipart/form-data`: `photo` (JPEG, PNG, GIF or WebP, max 5 MB) | `200 { avatar_url }` |
| `PATCH` | `/auth/profile` | Yes | JSON `{ research_interests: string[] }` (up to 20 interests, 100 characters each) | `200 { research_interests }` |
| `GET` | `/users/search?q=...` | Yes | | Up to 20 matching public researcher profiles |
| `GET` | `/users/friends` | Yes | Optional `q` name filter | Friends (people you follow who follow you back): `{ id, name, role, avatar_url, institution }[]`, up to 200 |
| `GET` | `/users/suggestions` | Yes | | Up to 5 researchers the viewer does not follow, ranked by shared research interests then followers |
| `GET` | `/users/:id` | Yes | Optional `post` query to include a shared older post | Public profile, follow counts and state, up to 20 approved papers and 20 posts; email is not included |
| `PUT` | `/users/:id/follow` | Yes | JSON `{ following: boolean }` | `{ follower_count, followed_by_me }`; following notifies the researcher |
| `GET` | `/users/:id/followers`, `/users/:id/following` | Yes | | Up to 100 researchers, newest first, with the viewer's follow state |
| `GET` | `/posts?page=1&scope=everyone` | Yes | Optional page; `scope=following` limits to the viewer and people they follow | `{ items, page, hasMore }`; 20 mixed posts/papers per page with like, comment and save state |
| `POST` | `/posts` | Yes | `multipart/form-data`: `body` (text), `image` (file, optional) | `201 post` |
| `PATCH` | `/posts/:id` | Yes (owner) | JSON `{ body }` | Updated post |
| `DELETE` | `/posts/:id` | Owner/Moderator/Admin | | `204`; removal by a moderator is audited |
| `PUT` | `/posts/:id/like` | Yes | JSON `{ liked: boolean }` | Current like state and count |
| `GET` | `/posts/:id/comments` | Yes | | Up to 50 comments |
| `POST` | `/posts/:id/comments` | Yes | JSON `{ body }` | `201 comment` |
| `DELETE` | `/comments/:id` | Comment author/Post owner/Moderator | | `204`; removal by a moderator is audited |
| `POST` | `/posts/:id/report` | Yes | JSON `{ reason }` | `201 { id, status }`; duplicate reports return `409` |
| `GET` | `/events?q=...&page=1` | Yes | Optional query/page/limit | Upcoming published events with registration counts and current user's registration state |
| `POST` | `/events` | Author/Moderator/Admin | JSON event fields: `title`, `description`, `kind`, `location`, `startsAt`, `endsAt`, optional `capacity` | `201 event`; organizer is the creator |
| `GET` | `/events/:id` | Yes | | Event details, registration count and management permission |
| `PATCH` | `/events/:id` | Organizer/Moderator/Admin | Full event metadata | Updated event; capacity cannot fall below registered attendees |
| `PATCH` | `/events/:id/cancel` | Organizer/Moderator/Admin | | Cancels the event and closes registrations |
| `PUT` | `/events/:id/registration` | Yes | JSON `{ registered: boolean }` | Registers or cancels the current user's registration; capacity is enforced |
| `GET` | `/messages/conversations` | Yes | | Conversations, last message and unread message count |
| `POST` | `/messages/conversations` | Yes | JSON `{ userId }` | Existing or newly-created one-to-one conversation |
| `GET` | `/messages/conversations/:id/messages?page=1` | Participant | Optional page/limit | Chronological messages; viewing marks the thread read |
| `POST` | `/messages/conversations/:id/messages` | Participant | JSON `{ body }` | `201 message`; notifies the other participant |
| `GET` | `/notifications` | Yes | Optional page/limit | Recipient's notifications and read state |
| `GET` | `/notifications/unread-count` | Yes | | Unread notification and message counts |
| `PUT` | `/notifications/:id/read` | Owner | | Mark one notification read |
| `PUT` | `/notifications/read-all` | Yes | | Mark all of the current user's notifications read |
| `GET` | `/communities?q=...&page=1` | Yes | Optional search query and page | Matching communities with member/post counts and current user's membership |
| `POST` | `/communities` | Yes | JSON `{ name, category, description? }` | `201 community`; creator becomes owner |
| `GET` | `/communities/:id` | Yes | | Community metadata, counts and current membership role |
| `GET` | `/communities/:id/members` | Yes | | Up to 100 members with community roles |
| `PATCH` | `/communities/:id/members/:userId/role` | Owner/Platform moderator | JSON `{ role: "moderator" | "member" }` | Updated community membership role; audited |
| `PATCH` | `/communities/:id` | Owner/Platform moderator | JSON `{ name, category, description }` | Updated community |
| `PUT` | `/communities/:id/membership` | Yes | JSON `{ joined: boolean }` | Join or leave; owners cannot leave |
| `GET` | `/communities/:id/posts?page=1` | Yes | Optional page/limit | Paginated public discussion feed |
| `POST` | `/communities/:id/posts` | Member | JSON `{ body }` | `201 discussion post` |
| `DELETE` | `/communities/:communityId/posts/:postId` | Author/Community owner/Moderator | | `204` |
| `GET` | `/images/:uuid` | No | | Image bytes with the correct `Content-Type` |
| `POST` | `/papers/analyze` | Author | `multipart/form-data`: `pdf` | Suggestions read from the first 5 pages, nothing stored: `{ title, abstract, authors: [{ name, affiliation }], tags, doi, domain, notes, pages, text_found, looks_like_paper, sources }`. `422` for unreadable or slow PDFs, `503` when busy; 10 per minute per author |
| `POST` | `/papers/submit` | Author | `multipart/form-data`: `title`, `abstract`, optional `doi`, `domain`, optional `publicationDate` (`YYYY-MM-DD`), JSON `tags`, JSON `authors` (first entry `{ user_id: <you> }`, each co-author `{ user_id, affiliation }` of a friend; names come from the accounts), optional `additionalNotes`, `pdf` file; optional `Idempotency-Key` header | `201 { id, title, status, submittedAt }` (repeat key returns `200`) |
| `GET` | `/papers/my-submissions` | Yes | | Own submissions with status, round, revision note, rejection reason and review count |
| `POST` | `/papers/:id/coauthor-update` | Submitter, status `coauthor_check` | `multipart/form-data`: `pdf`, `note` | `{ round, draft }`; replaces the PDF with a new draft (old one archived), co-authors asked to check again |
| `PUT` | `/papers/:id/coauthor-check` | Co-author | JSON `{ decision: "approve" | "changes", comment }` (comment required for changes) | Saves the verdict on the current PDF (round and draft), notifies the submitter; when every co-author approves, the paper moves to peer review. `409` outside the co-author check |
| `POST` | `/papers/:id/publish` | Submitter | JSON `{ force?: boolean }` | `{ status: "approved" }`; `409` with `code: "coauthors_pending"` and `pending` names when co-authors have not approved and `force` is not true; `409` after a moderator requested changes |
| `DELETE` | `/papers/:id` | Submitter | | `204`; withdraws an unpublished paper with its reviews and versions, notifies co-authors, audited; `409` for published papers |
| `GET` | `/papers/:id/feedback` | Owner or co-author | | Status, decided rounds' anonymous reviews with suggestions, round summary, decision timeline and versions |
| `POST` | `/papers/:id/resubmit` | Owner, status `revision_requested` | `multipart/form-data`: `response_letter`, `suggestion_responses` (JSON `[{ id, status: "addressed" \| "declined", response }]`), paper fields as in submit, optional `pdf` | Archives the current version, starts the next round, notifies previous reviewers |
| `GET` | `/papers/:id/versions/:round/pdf` | Yes | | PDF of an earlier round, same access rules as the current PDF |
| `GET` | `/reviews/queue` | Author/Moderator/Admin | `scope=mine` for own reviews | Papers under review that the viewer did not submit, with review counts and whether the viewer reviewed this or an earlier round |
| `GET` | `/reviews/papers/:id` | Author/Moderator/Admin | | Paper, versions, author response and previous-round answers, own review; moderators also get all reviews with names, round summary and timeline |
| `PUT` | `/reviews/papers/:id` | Author/Moderator/Admin, not the submitter | JSON `{ overall_rating, scores: { originality, methodology, clarity, significance }, recommendation, comments, confidential_comments?, suggestions: [{ section?, body }] }` | `201` new or `200` updated review for the current round; `409` once the round is decided; at least one suggestion when recommending a revision |
| `PATCH` | `/moderation/papers/:id/request-revision` | Moderator/Admin | JSON `{ "note": "..." }` (10 to 5,000 characters) | pending → revision_requested, history, audit record, author notified |
| `GET` | `/papers/search?q=...&author=...&domain=...&tag=...&sort=newest&page=1&limit=20` | Yes | All filters are optional; `sort` is `newest`, `oldest`, `title_asc`, or `title_desc`; `limit` is capped at 50 | `{ items, page, limit, total, hasMore }`; approved papers only |
| `GET` | `/papers/categories` | Yes | | Distinct categories used by approved papers |
| `GET` | `/papers/trending-tags` | Yes | | Up to 8 most used keywords on papers approved in the last 180 days, with paper counts |
| `GET` | `/papers/recommendations?limit=6` | Yes | `limit` 1 to 12 | `{ personalised, hasInterests, basedOn, items, topics }`; each item has `reasons`; papers you wrote, saved or liked are left out |
| `GET` | `/papers/interest-matches` | Yes | | Published papers matching the viewer's saved research interests, each with a `score` and `matched_interests` signals (shown on Search) |
| `GET` | `/papers/:id/related` | Yes | | Up to 4 approved papers that share keywords, authors, category or wording, each with a `reason` |
| `GET` | `/search/suggest?q=...` | Yes | `q` needs at least 2 characters | `{ topics, papers, people }` for the search dropdowns |
| `GET` | `/papers/saved` | Yes | | The viewer's saved approved papers, newest save first |
| `GET` | `/papers/:id` | Yes | | Approved paper metadata, abstract, like/comment counts and the viewer's like/save state; never includes PDF bytes or review notes |
| `PUT` | `/papers/:id/like` | Yes | JSON `{ liked: boolean }` | `{ like_count, liked_by_me }`; approved papers only; notifies the submitter |
| `PUT` | `/papers/:id/save` | Yes | JSON `{ saved: boolean }` | `{ saved_by_me }` |
| `GET` | `/papers/:id/comments` | Yes | | Up to 100 comments, oldest first |
| `POST` | `/papers/:id/comments` | Yes | JSON `{ body }` | `201 comment`; notifies the submitter |
| `DELETE` | `/paper-comments/:id` | Comment author/Paper submitter/Moderator | | `204`; removal by a moderator is audited |
| `GET` | `/papers/:id/pdf` | Yes | | PDF bytes for the submitting user, Admin/Moderator, Authors while the paper is under review, or any authenticated user after approval |
| `GET` | `/moderation/papers?status=pending` | Moderator/Admin | Optional `status` (`pending`, `revision_requested`, `approved`, `rejected`, `reviewed`), `page`, `limit` | Paper metadata with round, review count and average rating for the current round, plus pagination; no PDF bytes |
| `GET` | `/moderation/papers/:id` | Moderator/Admin | | Full review metadata |
| `GET` | `/moderation/summary` | Moderator/Admin | | Counts for users, pending/reviewed papers and reports |
| `GET` | `/moderation/reports?status=pending&page=1` | Moderator/Admin | Status: `pending`, `reviewed`, or `dismissed`; optional page/limit | Reported post context and pagination |
| `PATCH` | `/moderation/reports/:id/:decision` | Moderator/Admin | Decision path: `reviewed` or `dismissed` | Updated report disposition; action is audited |
| `PATCH` | `/moderation/papers/:id/approve` | Moderator/Admin | Optional JSON `{ "comment": "..." }` | Atomic pending → approved decision with reviewer, history and audit record |
| `PATCH` | `/moderation/papers/:id/reject` | Moderator/Admin | JSON `{ "reason": "..." }` | Atomic pending → rejected decision with reviewer, history and audit record |
| `GET` | `/admin/audit-logs?page=1&limit=50` | Admin | Optional page/limit | Paginated moderation audit records |

Paper discovery supports title/abstract/DOI/author/domain/tag matching, exact category filtering, four sort orders and bounded page-based pagination. Recommendations award +3 for an exact tag match, +4 for a domain match, +2 for a title match, and +1 for an abstract match per distinct saved interest. The authenticated endpoint excludes the requesting user's papers and all non-approved papers, removes duplicates, returns at most ten results, and uses publication date (or submission date if unavailable) to break score ties. Each result includes `score` and `matched_interests` with matching fields and point values. The PDF endpoint never returns pending or rejected papers to other users, and paper bytes are not included in metadata responses. PDF uploads are checked by their `%PDF-` signature, not their filename or client-provided MIME type. Only Admin/Moderator users can access moderation endpoints; discovery and detail queries filter to `approved` in SQL.

**Example: submit a paper with curl**

```bash
curl -X POST http://localhost:5000/api/papers/submit \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: 2c93e46c-44fd-4e95-92a2-e3584d2539df" \
  -F 'title=Research title' \
  -F 'abstract=Summary of the research.' \
  -F 'domain=Computer science' \
  -F 'tags=["systems","research"]' \
  -F 'authors=[{"name":"A. Researcher","affiliation":"UptoSkills"}]' \
  -F 'pdf=@paper.pdf;type=application/pdf'
```

Verify the metadata and stored PDF size in PostgreSQL:

```sql
SELECT id, user_id, title, status, pdf_filename, pdf_content_type,
       pdf_size, octet_length(pdf_data) AS stored_pdf_bytes, created_at
FROM papers
ORDER BY created_at DESC;
```

**Post object**

```json
{
  "id": 12,
  "body": "Our poster for the innovation challenge",
  "image_id": "47087733-d0e8-40a4-85b2-a685ff151dfa",
  "created_at": "2026-10-18T16:52:03.264Z",
  "user_id": 3,
  "author_name": "M. Jeevan Kumar",
  "author_role": "author"
}
```

**Validation rules**

| Field | Rule |
|---|---|
| `name` | 2-100 characters, must contain letters, no control characters; repeated spaces collapsed |
| `email` | Valid format, stored lowercase, unique (`409` if taken) |
| `password` | At least 8 characters and at most 72 bytes (bcrypt limit); letters plus a number or symbol; not a common password; must not contain the email name or full name. Applies to sign-up, password change and `reset-password`. Validation errors include `field` |
| `role` | `author` or anything else becomes `user`; members and authors can switch later with `PUT /auth/me/role` |
| post `body` | Max 5000 characters; required unless an image is attached |
| post `image` | One file, max 5 MB, real JPEG/PNG/GIF/WebP bytes |

**Example: image post with curl**

```bash
curl -X POST http://localhost:5000/api/posts \
  -H "Authorization: Bearer $TOKEN" \
  -F "body=Our lab poster" \
  -F "image=@poster.png"
```

---

## Project structure

```
SNARP-Uptoskills/
├── backend/                  Express API (all Node.js code lives here)
│   ├── server.js             API routes, auth, uploads and error handling
│   ├── migrate.js            Ordered, transactional SQL migration runner
│   ├── migrations/           Versioned PostgreSQL schema changes
│   │   ├── 001_initial_schema.sql
│   │   ├── 002_profiles_and_social_feed.sql
│   │   ├── 003_moderation_dashboards.sql
│   │   ├── 004_communities.sql
│   │   ├── 005_messages_notifications.sql
│   │   ├── 006_events.sql
│   │   ├── 007_user_timeline_indexes.sql
│   │   ├── 008_follows_and_paper_engagement.sql
│   │   ├── 009_session_devices.sql
│   │   ├── 010_email_verification.sql
│   │   ├── 011_peer_review.sql
│   │   ├── 012_coauthors.sql
│   │   ├── 013_coauthor_checks.sql
│   │   ├── 014_coauthor_gate.sql
│   │   └── 015_password_resets.sql
│   ├── migrate.test.js       Migration runner tests
│   ├── profile.js            Profile input validation
│   ├── profile.test.js       Profile validation tests
│   ├── community.js          Community and discussion input validation
│   ├── community.test.js     Community validation tests
│   ├── messaging.js          Direct-message input validation
│   ├── messaging.test.js     Messaging validation tests
│   ├── event.js              Event input validation
│   ├── event.test.js         Event validation tests
│   ├── paper-search.js       Approved-paper filters, sorting and pagination
│   ├── paper-search.test.js  Paper discovery query tests
│   ├── session.js            Session-bound JWT helpers
│   ├── credentials.js        Name, email and password rules; device labels
│   ├── credentials.test.js   Credential rule tests
│   ├── mailer.js             SMTP mailer, verification email and one-time tokens
│   ├── mailer.test.js        Mailer and token tests
│   ├── peer-review.js        Review and resubmission validation, anonymous reviewer labels
│   ├── peer-review.test.js   Peer review rule tests
│   ├── pdf-analysis.js       Reads a paper PDF (PDF.js in a worker thread) and suggests title, abstract, authors, keywords, DOI and domain
│   ├── pdf-analysis-worker.js  Worker thread entry for the PDF analysis
│   ├── pdf-analysis.test.js  Builds real PDFs and checks the suggestions
│   ├── image.js              Detects real image type from file bytes
│   ├── image.test.js         Tests for image.js
│   ├── scripts/smoke.mjs     End-to-end API smoke test (npm run smoke)
│   ├── recommendations.js    Paper recommendation scoring and ranking
│   ├── recommendations.test.js Tests for recommendation scoring and ranking
│   ├── seed-demo-papers.js   Development-only demo data via submission and moderation APIs
│   ├── .env.example          Template for backend/.env (copy and fill in)
│   ├── package.json
│   └── package-lock.json
├── frontend/
│   ├── public/                Favicon and shared SVG icons
│   ├── src/
│   │   ├── App.jsx            Routes and session restore
│   │   ├── main.jsx           Entry point, Geist font and global CSS
│   │   ├── api.js             API fetch wrapper and token storage
│   │   ├── Auth.jsx           Login and sign-up: strength meter, Caps Lock warning, return to the requested page
│   │   ├── password.js        Password rules (mirrors the server), strength score, safe redirect paths
│   │   ├── VerifyEmail.jsx    Opens the emailed link: confirms, signs in, or offers a new link
│   │   ├── ResetPassword.jsx  Opens the emailed reset link and sets a new password
│   │   ├── pages/review.jsx   Peer review queue and workspace, moderator decisions, author feedback and resubmission
│   │   ├── Feed.jsx           API-backed feed and image uploads
│   │   ├── Landing.jsx        Public landing page and animations
│   │   ├── Layout.jsx         Sidebar, top bar, mobile menu
│   │   ├── components/ui.jsx  Shared Avatar and PageHeader components
│   │   ├── components/PostCard.jsx  Post with like, comment, share, report, edit and delete
│   │   ├── theme.js           Light/dark/system theme preference
│   │   ├── content.js         Help-centre FAQ and landing-page illustration copy
│   │   ├── pages/index.jsx    Communities, papers, events, messages and other pages
│   │   ├── assets/logo.png
│   │   └── supporting CSS, formatting and citation helpers and tests
│   ├── index.html
│   ├── vite.config.js         Dev proxy: /api -> localhost:5000
│   ├── eslint.config.js
│   ├── package.json
│   └── package-lock.json
├── .gitignore
├── .github/workflows/ci.yml   Lint, tests, build, Docker build and a smoke test against PostgreSQL
├── Dockerfile                 Multi-stage image: builds the frontend, runs the API
├── docker-compose.yml         App + PostgreSQL 17 for a production-like stack
├── .env.docker.example        Secrets template for docker-compose
├── package.json               Root build/start/test scripts for hosting platforms
├── DEPLOYMENT.md              Production rollout and operations guide
├── DB_SETUP.md                Installing PostgreSQL and pgAdmin on Windows
└── README.md
```

### Frontend routes

| Path | Page | Backend |
|---|---|---|
| `/` (logged out) | Landing page | Not needed |
| `/login`, `/signup` | Auth | ✅ |
| `/` (logged in) | Feed | ✅ |
| `/communities` | Communities | Persistent community API |
| `/communities/:id` | Community detail | Membership and discussion APIs |
| `/articles` | Research papers | Approved paper API with filters and pagination; `?tag=` pre-fills the keyword filter |
| `/articles/:id` | Paper details | Approved paper detail, PDF and discussion (like, comment, save) APIs |
| `/saved` | Saved papers | Reading-list API |
| `/events` | Events | Upcoming event and registration APIs |
| `/events/:id` | Event details | Event detail, registration and organizer APIs |
| `/messages` | Messages | Persistent one-to-one messaging API |
| `/notifications` | Notifications | Persistent alerts and read-state API |
| `/tools` | Citation tools | Not needed |
| `/submit` | Submit a paper: PDF upload with suggestions, required-field checklist | PDF analysis and submission APIs |
| `/my-submissions` | My submissions | Own submissions API |
| `/my-submissions/:id` | Reviews, timeline and revise-and-resubmit form for one paper | Feedback and resubmit APIs |
| `/reviews` | Peer review: "Your papers in progress" cards (co-author approvals, review count, Publish with the co-author warning, Check the PDF for co-authors), then the review queue and your reviews as cards | Review queue, my submissions and publish APIs |
| `/reviews/:id` | Review workspace: paper, versions, changes since last round, review form; decision panel for moderators | Review and moderation APIs |
| `/moderation` | Moderator/admin dashboard | Papers under review, waiting on authors and decided (each opens the review workspace), report queue, summary; admin audit log |
| `/settings` | Settings | Profile, photo, password, appearance and account deletion |
| `/users/:id` | Researcher profile | Public profile, follow, followers/following, approved papers and latest 20 posts |
| `/help` | Help center | Not needed |
| `/search?q=` | Search results | Researchers, posts, communities, upcoming events and approved papers APIs |

Logged-out users see the landing page at `/` and are redirected to `/login` from any app page; logged-in users visiting `/login` go to the feed.

---

## Design system

The signed-in app uses a neutral zinc palette with light and dark themes (`:root` and `:root[data-theme='dark']` in [`frontend/src/index.css`](frontend/src/index.css)). Colour is kept for status only. The landing page keeps the UptoSkills brand colours.

| Token | Light | Used for |
|---|---|---|
| `--bg` / `--surface` / `--raised` | `#fafafa` / `#ffffff` / `#f4f4f5` | Page, panels, hover and inset areas |
| `--border` / `--border-strong` | `#e4e4e7` / `#d4d4d8` | Panel borders and inputs (borders instead of shadows) |
| `--text` / `--text-2` / `--text-3` | `#18181b` / `#52525b` / `#71717a` | Primary, secondary and muted text |
| `--ink` / `--on-ink` | `#18181b` / `#ffffff` | Primary buttons and active states |
| `--success`, `--danger`, `--yellow-ink` | `#17734a`, `#c63a32`, `#8a6200` | Approved, errors and removals, pending |
| `--orange`, `--teal`, `--blue` | `#f37346`, `#2cbaa4`, `#355fb5` | UptoSkills brand colours (landing page) |

- **Theme:** stored in `localStorage` (`snarp-theme`) and applied before the first render to avoid a flash.
- **Radius rule:** controls 6px, panels 8px, avatars round. Base font size 14px.
- **Font:** Geist Variable, self-hosted through `@fontsource-variable/geist`.
- **Icons:** Phosphor (`@phosphor-icons/react`).
- **Layout:** pages use up to 1280px with 32px side padding; the feed has a 320px right rail.
- **Responsive:** the right rail hides under 1180px, the sidebar becomes a slide-out menu under 960px, and two-column pages stack under 860px.
- **Motion:** subtle post entry and skeleton loading in the app; disabled when the OS asks for reduced motion.

### Landing page animations

All animations live in [`frontend/src/Landing.jsx`](frontend/src/Landing.jsx) and use GSAP 3 with its free plugins (ScrollTrigger, ScrollSmoother, SplitText, DrawSVG, Flip). Landing icons come from Hugeicons. The landing page is lazy-loaded, so logged-in users never download GSAP.

Content is fully visible without JavaScript, and every animation (including smooth scrolling) is skipped when the OS has "reduce motion" turned on (`gsap.matchMedia`).

| Section | Animation |
|---|---|
| Whole page | Smooth scrolling (ScrollSmoother); the floating nav hides while scrolling down and returns on the way up |
| Hero headline | Letters rise out of masks; the last word cycles through *readers / peers / reviewers / citations* in a solid block that morphs width and colour |
| Hero network | A "You" node connected to peers: lines draw in, nodes pop, packets travel along edges and arrivals show what happened ("cited you", "+1 citation"); the graph tilts toward the pointer and scrolls at a slower speed |
| Word strip | Endless marquee of big words that speeds up and leans with scroll velocity |
| Feature cards | Five full-colour cards pin and stack on desktop, each new card burying the last; each plays its own story: photos deal in, an "Approved" stamp slams down, community chips reshuffle (Flip), a real citation types out in APA then BibTeX, notifications drop in |
| How it works | Pins and pans horizontally on desktop; each giant step word rises letter by letter as its panel arrives |
| Statement | Words fill from faint to solid as you scroll |
| Call to action | Heading rises line by line; buttons are magnetic (follow the pointer) |
| Footer | Giant SNARP wordmark rises letter by letter |


---

## Security notes

- Passwords are hashed with bcrypt and never returned by the API.
- Unknown-account login attempts also run a bcrypt comparison to reduce timing-based account discovery.
- Access tokens have a unique session ID stored in PostgreSQL. Every protected request checks its session and current account role; logout revokes the session immediately. Tokens created before this change do not have a session row and users must sign in again after upgrading.
- Paper submissions require the Author role at the API, regardless of what the frontend displays.
- Uploaded PDFs are analysed in a separate worker thread with a 15-second time limit, a 256 MB memory cap, at most three at a time, and PDF.js script evaluation turned off, so a malformed or hostile file cannot stall or crash the API.
- Profile APIs never expose another user's email; profile links accept HTTPS URLs only. Post edits, comment deletion, and post deletion are checked against the authenticated owner in SQL.
- Every SQL query is parameterised.
- Production requires a unique `JWT_SECRET` of at least 32 bytes; local development generates one and saves it in `backend/.env`, which is **git-ignored**. Never commit `.env`.
- The API disables the Express version header and sends `nosniff`, same-origin frame, referrer, permissions and opener policy headers, plus a strict Content Security Policy (scripts from the same origin only, no plugins, no framing by other sites). In production over HTTPS it also sends HSTS. Terminate TLS at the proxy or platform.
- Rate limits: signup 5 per IP per hour; login 10 failed attempts per IP and 8 failed attempts per account per 15 minutes; password change 5 failed attempts per account per 15 minutes; posts, comments, messages, reports and uploads 30 per account per minute; the whole API 1500 requests per IP per 15 minutes. Counters use the process's in-memory store and reset on restart. Use a shared store before running multiple API instances.
- Changing a password requires the current one and revokes every other session for the account. Deleting an account requires the password, removes the user's data in one transaction and refuses to delete the last admin.
- Moderators and admins can remove any post or comment; post owners can remove comments on their posts. Removals by someone other than the author are written to the audit log.
- `TRUST_PROXY` is unset by default. Set it only to the known proxy hop count or trusted proxy IP/CIDRs so the rate limiter sees client addresses without trusting arbitrary forwarded headers.
- Uploaded files are validated by their **actual bytes**, not the filename or browser-reported type. SVG and other formats are rejected, which prevents script injection through images.
- Images are served with `X-Content-Type-Options: nosniff`.
- Image URLs use random UUIDs so `<img>` tags work without auth headers. Anyone with the exact URL can view that image (the same model most social platforms use).
- An image and its post are written in a single SQL statement, so a failure never leaves half-saved data.

---

## Testing

```bash
node --check backend/server.js
npm --prefix backend test
npm --prefix frontend test
npm --prefix frontend run lint
npm --prefix frontend run build
```

Backend unit tests cover validation, sessions, paper discovery SQL construction, and migration-runner behavior. Frontend tests cover citation helpers.

The smoke test runs the real server against a real database: health check, security headers, sign-up, posting, likes, comments, following and the Following feed (with a second temporary account), password change, logout, account deletion and (with `SMOKE_EXPECT_FRONTEND=true`) the served frontend.

```bash
npm --prefix backend run smoke http://localhost:5000
```

It signs up a temporary `smoke-*@example.test` account and deletes it (with its post) at the end, leaving only an `account.delete` audit record. Run it against CI or staging rather than production.

GitHub Actions runs three jobs on pushes and pull requests:

| Job | What it checks |
|---|---|
| `verify` | Backend syntax and unit tests, frontend tests, lint and production build |
| `integration` | Starts the production server against PostgreSQL 17, applies all migrations, runs the smoke test including the served frontend |
| `docker` | Builds the Docker image |

Deployment steps, health checks, environment configuration, pool sizing, migration rollout, and operational limits are documented in [DEPLOYMENT.md](DEPLOYMENT.md).

---

## Roadmap and known limitations

Remaining roadmap work, following `social_Academic_Research_Platform_Roadmap.docx`:

- [ ] Upgrade message polling to Socket.IO for real-time delivery
- [ ] PostgreSQL full-text search
- [x] Settings: change password and delete account
- [x] Light and dark mode
- [x] Production build: one-origin serving, Docker, CI integration test
- [x] Moderators can remove reported posts and comments
- [ ] Persist notification preferences
- [x] Likes, comments and saves on research papers
- [x] Follow researchers, Following feed and suggestions
- [ ] Cursor-based feed pagination for consistent pages as new posts arrive
- [ ] Shared rate-limit storage before running multiple API instances
- [ ] Forgot password flow

## Contributing to SNARP-Uptoskills

We welcome contributions that improve the platform's functionality, usability, and documentation.

### Contribution Workflow

1. Fork the repository.
2. Create a new branch for your changes.
3. Make your changes and test them.
4. Commit your changes with a clear message.
5. Push your branch to your fork.
6. Open a pull request against the original repository.

### Best Practices

- Keep changes focused and easy to review.
- Follow the existing project structure and coding conventions.
- Test changes before submitting a pull request.
- Never commit passwords, API keys, or database credentials.
- Update documentation when necessary.

## Contributors

- Preethi
- Abhinav Rahul
