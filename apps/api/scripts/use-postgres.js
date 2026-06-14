#!/usr/bin/env node
/*
 * use-postgres.js — flip the Prisma datasource to PostgreSQL for a prod build.
 *
 * Local development stays on SQLite (the committed schema), so the running dev
 * server / preview keeps working with `prisma/dev.db`. Production (Render) can't
 * use SQLite — Render's filesystem is ephemeral and resets on every deploy — so
 * the deploy build runs this script first to rewrite the datasource provider to
 * `postgresql`, then `prisma generate` + `prisma db push` build against the
 * managed Postgres pointed at by DATABASE_URL.
 *
 * The schema is otherwise identical between the two providers (all columns are
 * primitive types + JSON-as-String, no provider-specific attributes), so this
 * single-line swap is all that's needed. Idempotent: safe to run repeatedly.
 */
const fs = require('fs');
const path = require('path');

const schemaPath = path.join(__dirname, '..', 'prisma', 'schema.prisma');
const src = fs.readFileSync(schemaPath, 'utf8');

if (src.includes('provider = "postgresql"')) {
  console.log('[use-postgres] schema already on postgresql — nothing to do');
  process.exit(0);
}

const next = src.replace('provider = "sqlite"', 'provider = "postgresql"');
if (next === src) {
  console.error('[use-postgres] ERROR: could not find `provider = "sqlite"` in schema.prisma');
  process.exit(1);
}

fs.writeFileSync(schemaPath, next);
console.log('[use-postgres] datasource provider -> postgresql');
