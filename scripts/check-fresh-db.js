#!/usr/bin/env node
/**
 * Fresh-DB bootstrap check — #894.
 *
 * Repeatable check that a brand-new (empty) database can be provisioned by
 * `node migrate.js` through the numbered migration chain.
 *
 * Usage:
 *   createdb <scratch>   # an EMPTY database — this script does not create/drop DBs
 *   DATABASE_URL=postgresql://postgres@127.0.0.1:55433/<scratch> node scripts/check-fresh-db.js
 *
 * What it asserts (the #894 ratified acceptance):
 *   1. Every numbered migration (files matching /^\d+/) through 259 is recorded
 *      in `_migrations` — i.e. the chain did NOT halt at 238.
 *   2. `candidate_profiles` carries all nine columns that migration 004 defines
 *      but the migrate.js bootstrap originally omitted:
 *      bio, phone, github_url, photo_url, salary_min, salary_max,
 *      preferred_job_types, preferred_locations, years_experience.
 *      The bootstrap creates them at 004's exact types; the final types asserted
 *      here account for migration 047 (p2 hardening, runs early in the chain,
 *      same as on the live DB), which widens phone/github_url/photo_url
 *      varchar -> text.
 *   3. `v_candidate_full_profile` exists and is selectable.
 *
 * Known sibling defect (#1141, out of scope for #894): after the numbered
 * chain completes, the run currently halts at `p2_schema_hardening.sql`, so
 * `node migrate.js` itself exits 1 on a fresh DB. This script therefore does
 * NOT assert the migrate exit code by default. Once #1141 lands, set
 * STRICT_FULL_RUN=1 to also assert exit 0 to head — that one env flip is the
 * "full exit-0-to-head" assertion.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

// `types` = acceptable final data_types after the full chain (see header:
// migration 047 widens the three URL/phone varchars to text, as on live).
const EXPECTED_COLUMNS = {
  bio: { types: ['text'] },
  phone: { types: ['text', 'character varying'] },
  github_url: { types: ['text', 'character varying'] },
  photo_url: { types: ['text', 'character varying'] },
  salary_min: { types: ['integer'] },
  salary_max: { types: ['integer'] },
  preferred_job_types: { types: ['jsonb'] },
  preferred_locations: { types: ['jsonb'] },
  years_experience: { types: ['integer'] },
};

function numberedMigrationNames() {
  const dir = path.join(__dirname, '..', 'migrations');
  return fs
    .readdirSync(dir)
    .filter((f) => /^\d+/.test(f))
    .sort()
    .map((f) => {
      if (f.endsWith('.js')) {
        const m = require(path.join(dir, f));
        return m.name || f.replace(/\.js$/, '');
      }
      return f; // .sql migrations are recorded under their filename
    });
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('FAIL: DATABASE_URL is required (point it at an EMPTY scratch DB)');
    process.exit(2);
  }
  const failures = [];
  const ok = (msg) => console.log(`ok - ${msg}`);
  const fail = (msg) => { failures.push(msg); console.log(`FAIL - ${msg}`); };

  // 1. Run the real provisioning path.
  let migrateExit = 0;
  try {
    execFileSync(process.execPath, [path.join(__dirname, '..', 'migrate.js')], {
      env: process.env,
      stdio: 'pipe',
    });
  } catch (e) {
    migrateExit = e.status ?? 1;
  }
  console.log(`migrate.js exit code: ${migrateExit} (non-zero expected until #1141 fixes the p2 fresh-path halt)`);
  if (process.env.STRICT_FULL_RUN === '1' && migrateExit !== 0) {
    fail('STRICT_FULL_RUN: migrate.js did not exit 0');
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    // 2. Numbered chain through 259 applied.
    const expected = numberedMigrationNames();
    const { rows } = await client.query('SELECT name FROM _migrations');
    const applied = new Set(rows.map((r) => r.name));
    const missing = expected.filter((n) => !applied.has(n));
    if (missing.length === 0) ok(`all ${expected.length} numbered migrations applied (through 259)`);
    else fail(`numbered migrations missing: ${missing.join(', ')}`);

    // 3. Nine 004-parity columns present, with chain-final types.
    const cols = await client.query(
      `SELECT column_name, data_type
         FROM information_schema.columns
        WHERE table_name = 'candidate_profiles'`,
    );
    const byName = new Map(cols.rows.map((r) => [r.column_name, r]));
    for (const [name, want] of Object.entries(EXPECTED_COLUMNS)) {
      const got = byName.get(name);
      if (!got) fail(`candidate_profiles.${name} missing`);
      else if (!want.types.includes(got.data_type)) {
        fail(`candidate_profiles.${name} type is ${got.data_type}, want one of ${want.types.join('/')}`);
      } else ok(`candidate_profiles.${name} present (${got.data_type})`);
    }

    // 4. View exists and is selectable.
    try {
      await client.query('SELECT * FROM v_candidate_full_profile LIMIT 0');
      ok('v_candidate_full_profile exists and is selectable');
    } catch (e) {
      fail(`v_candidate_full_profile not selectable: ${e.message}`);
    }
  } finally {
    await client.end();
  }

  if (failures.length) {
    console.error(`\nFRESH-DB CHECK FAILED (${failures.length}): ${failures.join('; ')}`);
    process.exit(1);
  }
  console.log('\nFRESH-DB CHECK PASSED');
}

main().catch((e) => { console.error('FAIL - check errored:', e.message); process.exit(1); });
