# 🗄️ SNARP — Database Setup Guide

Complete step-by-step guide to install **PostgreSQL**, set up **pgAdmin 4**, create the project database, and connect everything to the SNARP backend.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Install PostgreSQL](#2-install-postgresql)
3. [Install pgAdmin 4](#3-install-pgadmin-4)
4. [Verify PostgreSQL Installation](#4-verify-postgresql-installation)
5. [Connect to PostgreSQL via pgAdmin 4](#5-connect-to-postgresql-via-pgadmin-4)
6. [Create the SNARP Database (Manual — Optional)](#6-create-the-snarp-database-manual--optional)
7. [Configure the Backend `.env` File](#7-configure-the-backend-env-file)
8. [Run the Backend (Auto-Creates DB & Tables)](#8-run-the-backend-auto-creates-db--tables)
9. [Verify Tables in pgAdmin](#9-verify-tables-in-pgadmin)
10. [Database Schema Reference](#10-database-schema-reference)
11. [Troubleshooting](#11-troubleshooting)

---

## 1. Prerequisites

| Requirement    | Details                                              |
| -------------- | ---------------------------------------------------- |
| **OS**         | Windows 10/11 (64-bit)                               |
| **Node.js**    | v22 or later (`node --version` to check)             |
| **Disk Space** | ~500 MB for PostgreSQL + pgAdmin 4                   |
| **Port**       | `5432` (default PostgreSQL port) must be free         |

---

## 2. Install PostgreSQL

### Step 1 — Download the Installer

1. Go to the official download page:  
   👉 **<https://www.postgresql.org/download/windows/>**
2. Click **"Download the installer"** (this redirects to the EDB installer page).
3. Select the **latest stable version** (e.g. PostgreSQL 16.x) for **Windows x86-64**.
4. Click **Download** and save the `.exe` file.

### Step 2 — Run the Installer

1. Double-click the downloaded `.exe` file to launch the installer.
2. Click **Next** on the welcome screen.

### Step 3 — Choose Installation Directory

- Keep the default path (e.g. `C:\Program Files\PostgreSQL\16`) or change it.
- Click **Next**.

### Step 4 — Select Components

Make sure **all** of these are checked:

- [x] PostgreSQL Server
- [x] pgAdmin 4
- [x] Stack Builder *(optional)*
- [x] Command Line Tools

> [!TIP]
> The installer bundles **pgAdmin 4** by default. If you check this box, you do NOT need a separate pgAdmin download (see [Section 3](#3-install-pgadmin-4) for standalone install if needed).

Click **Next**.

### Step 5 — Set Data Directory

- Keep the default (e.g. `C:\Program Files\PostgreSQL\16\data`).
- Click **Next**.

### Step 6 — Set Superuser Password 🔑

- Enter a **password** for the default `postgres` superuser.
- ⚠️ **Remember this password!** You will need it for the `.env` file later.
- Click **Next**.

### Step 7 — Set Port

- Default port: **`5432`** — keep this unless you have a conflict.
- Click **Next**.

### Step 8 — Select Locale

- Keep the default locale.
- Click **Next**.

### Step 9 — Install

- Review the summary and click **Next** to begin installation.
- Wait for the installation to complete (~2-5 minutes).
- **Uncheck** "Launch Stack Builder" on the final screen (not needed for this project).
- Click **Finish**.

---

## 3. Install pgAdmin 4

> [!NOTE]
> If you checked **pgAdmin 4** during the PostgreSQL installer (Step 4 above), it is already installed. Skip to [Section 4](#4-verify-postgresql-installation).

### Standalone Installation (if not bundled)

1. Go to: **<https://www.pgadmin.org/download/pgadmin-4-windows/>**
2. Download the latest **pgAdmin 4** `.exe` installer.
3. Run the installer and follow the prompts (defaults are fine).
4. Once installed, launch **pgAdmin 4** from the Start Menu.

### First Launch

1. Open **pgAdmin 4** from the Start Menu.
2. On the first launch, it will ask you to set a **Master Password**.
   - This is a local master password for pgAdmin itself (different from PostgreSQL password).
   - Set it and remember it.
3. pgAdmin will open in your **default web browser** at `http://127.0.0.1:xxxx/browser/`.

---

## 4. Verify PostgreSQL Installation

Open **PowerShell** or **Command Prompt** and run:

```powershell
psql --version
```

Expected output (version may differ):
```
psql (PostgreSQL) 16.x
```

If `psql` is not recognized, add PostgreSQL's `bin` folder to your system PATH:
```
C:\Program Files\PostgreSQL\16\bin
```

### Test the connection from the command line

```powershell
psql -U postgres -h localhost -p 5432
```

- Enter the **superuser password** you set during installation.
- If you see the `postgres=#` prompt, PostgreSQL is running correctly.
- Type `\q` to exit.

---

## 5. Connect to PostgreSQL via pgAdmin 4

### Step 1 — Open pgAdmin 4

Launch **pgAdmin 4** from the Start Menu. It opens in your browser.

### Step 2 — Register a New Server

1. In the left sidebar, right-click **Servers** → **Register** → **Server…**
2. Fill in the **General** tab:

   | Field    | Value                            |
   | -------- | -------------------------------- |
   | **Name** | `SNARP Local` (or any label)     |

3. Switch to the **Connection** tab:

   | Field                | Value            |
   | -------------------- | ---------------- |
   | **Host name/address**| `localhost`      |
   | **Port**             | `5432`           |
   | **Maintenance DB**   | `postgres`       |
   | **Username**         | `postgres`       |
   | **Password**         | *(your password from Step 6 of install)* |
   | **Save password?**   | ✅ Yes           |

4. Click **Save**.

### Step 3 — Confirm Connection

- In the left sidebar, expand **Servers → SNARP Local → Databases**.
- You should see the default `postgres` database listed.
- ✅ You are connected!

---

## 6. Create the SNARP Database (Manual — Optional)

> [!IMPORTANT]
> The backend server **auto-creates** the `snarp` database and all tables on first run (see [Section 8](#8-run-the-backend-auto-creates-db--tables)). This manual step is **only** if you want to create it ahead of time or need to troubleshoot.

### Option A — Via pgAdmin 4

1. In the left sidebar, right-click **Databases** → **Create** → **Database…**
2. Set:

   | Field      | Value   |
   | ---------- | ------- |
   | **Database**| `snarp` |
   | **Owner**  | `postgres` |

3. Click **Save**.

### Option B — Via Command Line

```powershell
psql -U postgres -h localhost -p 5432 -c "CREATE DATABASE snarp;"
```

---

## 7. Configure the Backend `.env` File

Navigate to the `backend/` folder and open (or create) the **`.env`** file:

```
backend/.env
```

Set the following values:

```env
# PostgreSQL Connection
PGHOST=localhost
PGPORT=5432
PGUSER=postgres
PGPASSWORD=your_actual_password_here
PGDATABASE=snarp

# Server Port
PORT=5000

# Max PDF upload size in bytes (default 10 MB)
PAPER_MAX_PDF_BYTES=10485760

# JWT Secret — leave empty on first run, the server auto-generates one
# JWT_SECRET=
```

> [!CAUTION]
> Replace `your_actual_password_here` with the real PostgreSQL superuser password you set during installation. **Never commit the `.env` file to Git** — it is already in `.gitignore`.

### Environment Variables Explained

| Variable              | Description                                     | Default     |
| --------------------- | ----------------------------------------------- | ----------- |
| `PGHOST`              | PostgreSQL server hostname                      | `localhost` |
| `PGPORT`              | PostgreSQL server port                          | `5432`      |
| `PGUSER`              | PostgreSQL username                             | `postgres`  |
| `PGPASSWORD`          | PostgreSQL user password                        | *(none)*    |
| `PGDATABASE`          | Database name for the SNARP project             | `snarp`     |
| `PORT`                | Express API server port                         | `5000`      |
| `PAPER_MAX_PDF_BYTES` | Maximum PDF upload size in bytes                | `10485760`  |
| `JWT_SECRET`          | Secret key for JWT tokens (auto-generated)      | *(auto)*    |

---

## 8. Run the Backend (Auto-Creates DB & Tables)

### Step 1 — Install Dependencies

```powershell
cd backend
npm install
```

### Step 2 — Start the Server

```powershell
npm run dev
```

### What Happens on First Run

The server's `setupDb()` function automatically:

1. **Connects** to the default `postgres` database.
2. **Checks** if a database named `snarp` exists.
3. **Creates** the `snarp` database if it doesn't exist.
4. **Creates** all required tables and indexes:
   - `users` — User accounts with roles (admin, moderator, author, user)
   - `images` — Post images stored as BYTEA
   - `posts` — Social-style posts with optional images
   - `papers` — Research paper submissions with PDF storage
5. **Generates** a `JWT_SECRET` and appends it to `.env` (if not already set).

Expected console output:
```
Created database snarp
Generated JWT_SECRET in backend/.env
API running on http://localhost:5000
```

On subsequent runs:
```
API running on http://localhost:5000
```

---

## 9. Verify Tables in pgAdmin

After the backend has run at least once:

1. Open **pgAdmin 4**.
2. In the left sidebar, navigate to:
   ```
   Servers → SNARP Local → Databases → snarp → Schemas → public → Tables
   ```
3. You should see these tables:

   | Table      | Description                           |
   | ---------- | ------------------------------------- |
   | `users`    | Registered user accounts              |
   | `images`   | Post image binary data                |
   | `posts`    | Social feed posts                     |
   | `papers`   | Research paper submissions            |

4. Right-click any table → **View/Edit Data** → **All Rows** to inspect its contents.

### Quick Query via pgAdmin

1. Click on the `snarp` database in the sidebar.
2. Click **Tools** → **Query Tool** (or press `Alt+Shift+Q`).
3. Run a test query:
   ```sql
   SELECT table_name
   FROM information_schema.tables
   WHERE table_schema = 'public';
   ```
4. You should see: `users`, `images`, `posts`, `papers`.

---

## 10. Database Schema Reference

### `users`
```sql
CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          VARCHAR(20) NOT NULL DEFAULT 'user'
                CHECK (role IN ('admin', 'moderator', 'author', 'user')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### `images`
```sql
CREATE TABLE images (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mime       VARCHAR(20) NOT NULL,
  data       BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### `posts`
```sql
CREATE TABLE posts (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL DEFAULT '',
  image_id   UUID REFERENCES images(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Constraint: body ≤ 5000 chars, and at least body or image must be present
-- Index on created_at DESC for feed ordering
```

### `papers`
```sql
CREATE TABLE papers (
  id                 BIGSERIAL PRIMARY KEY,
  user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title              VARCHAR(300) NOT NULL,
  abstract           TEXT NOT NULL,
  doi                VARCHAR(255),
  domain             VARCHAR(120) NOT NULL,
  tags               TEXT[] NOT NULL DEFAULT '{}',
  authors            JSONB NOT NULL,
  pdf_data           BYTEA NOT NULL,
  pdf_filename       VARCHAR(255) NOT NULL,
  pdf_content_type   VARCHAR(100) NOT NULL DEFAULT 'application/pdf',
  pdf_size           INTEGER NOT NULL CHECK (pdf_size > 0 AND pdf_size <= 10485760),
  additional_notes   TEXT,
  status             VARCHAR(20) NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'approved', 'rejected')),
  idempotency_key    UUID,
  reviewed_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at        TIMESTAMPTZ,
  rejection_reason   TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);
-- Index on (status, created_at DESC) for moderation queue
```

---

## 11. Troubleshooting

### ❌ `psql` is not recognized as a command

**Cause:** PostgreSQL `bin` directory is not in your system PATH.

**Fix:**
1. Open **System Properties** → **Environment Variables**.
2. Under **System variables**, find `Path` and click **Edit**.
3. Add: `C:\Program Files\PostgreSQL\16\bin` (adjust version number).
4. Restart your terminal.

---

### ❌ `password authentication failed for user "postgres"`

**Cause:** Wrong password in `.env` or during `psql` login.

**Fix:**
1. Confirm the password you set during PostgreSQL installation.
2. Update `PGPASSWORD` in `backend/.env`.
3. If you forgot the password, edit `pg_hba.conf` to temporarily allow trust authentication:
   - Find: `C:\Program Files\PostgreSQL\16\data\pg_hba.conf`
   - Change `scram-sha-256` to `trust` for the localhost line.
   - Restart PostgreSQL service.
   - Connect via `psql` and reset the password:
     ```sql
     ALTER USER postgres WITH PASSWORD 'new_password';
     ```
   - Revert `pg_hba.conf` back to `scram-sha-256` and restart the service.

---

### ❌ `Could not set up PostgreSQL: connection refused`

**Cause:** PostgreSQL service is not running.

**Fix:**
1. Open **Services** (press `Win + R`, type `services.msc`, hit Enter).
2. Find **postgresql-x64-16** (or similar).
3. Right-click → **Start**.
4. Set **Startup type** to **Automatic** so it starts on boot.

---

### ❌ Port `5432` is already in use

**Cause:** Another PostgreSQL instance or application is using port 5432.

**Fix:**
```powershell
netstat -ano | findstr :5432
```
Then kill the conflicting process or change `PGPORT` in `.env` to another port (e.g. `5433`).

---

### ❌ `database "snarp" already exists`

**Cause:** You manually created the database before running the server.

**Fix:** This is harmless — the server's `setupDb()` skips creation if the DB already exists.

---

### ❌ pgAdmin shows no tables under `snarp`

**Cause:** The backend hasn't run yet, or you're looking in the wrong schema.

**Fix:**
1. Run `npm run dev` in the `backend/` folder first.
2. In pgAdmin, navigate to: `snarp → Schemas → public → Tables`.
3. Right-click **Tables** → **Refresh** to reload.

---

<!-- ## ✅ Quick Checklist

- [ ] PostgreSQL installed and running on port `5432`
- [ ] pgAdmin 4 installed and connected to local server
- [ ] `backend/.env` file configured with correct `PGPASSWORD`
- [ ] `npm install` completed in the `backend/` folder
- [ ] `npm run dev` runs without errors
- [ ] Tables (`users`, `images`, `posts`, `papers`) visible in pgAdmin
- [ ] API accessible at `http://localhost:5000` -->

---

> **You're all set!** The SNARP database is now configured and ready for development. 🚀
