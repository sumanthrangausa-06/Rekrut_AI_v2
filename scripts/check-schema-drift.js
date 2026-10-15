#!/usr/bin/env node
/**
 * check-schema-drift.js — #1184 STOP 1 audit tool / future CI guard.
 *
 * Extracts every column reference from server-side code (routes/, services/,
 * lib/, workers/, middleware/, server.js) and compares it, PER TABLE with
 * alias->table resolution, against the schema a FRESH database actually has
 * (information_schema of a DB built only by `node migrate.js`).
 *
 * Usage:
 *   DATABASE_URL=postgresql://postgres@127.0.0.1:55433/<scratch> node scripts/check-schema-drift.js [--json out.json] [--manifest out.md]
 *
 * Exit 1 if any finding exists, 0 if clean.
 *
 * Method notes / known limits (see audit report):
 *  - SQL is extracted from string/template literals. Interpolated template
 *    literals (${...}) are flagged DYNAMIC and their static parts still parsed.
 *  - SELECT * / alias.* + JS property access on result rows is handled by a
 *    property-access pass for variables assigned from `SELECT * FROM t` /
 *    `SELECT a.* FROM t a` queries in the same file.
 *  - Column-name arrays used to build dynamic SQL (allowlist pattern) are
 *    extracted when the array is iterated into a query in the same file and
 *    the target table is identifiable from a nearby FROM/UPDATE/INSERT.
 *  - JSONB object keys inside SQL string literals are NOT columns: string
 *    literals are stripped before parsing, and identifiers immediately
 *    followed by `->`/`->>`/`#>`/`#>>` or preceded by those operators are
 *    treated as JSON paths, not column references.
 *  - Unqualified references in multi-table queries are recorded as
 *    UNRESOLVED, never as present/missing.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SCAN_DIRS = ['routes', 'services', 'lib', 'workers', 'middleware'];
const SCAN_FILES = ['server.js'];
const VIEW_MIGRATIONS = [
  '236_unified_interviews_view.js',
  '237_unified_interviews_view_slot_ids.js',
  '238_v_candidate_full_profile.js',
  '240_extend_candidate_full_profile_view.js',
  '240_v_unified_assessments.js',
];
// Files that sort after the halting file in migrate.js's lexicographic sort.
// migrate.js:273 allFiles.sort(); p2_schema_hardening.sql halts a fresh run
// (0A000, view dependency) -> everything after it never executes.
const HALT_FILE = 'p2_schema_hardening.sql';

const KEYWORDS = new Set(('select from where join left right inner outer full cross on and or not null is in exists between like ilike as asc desc limit offset group by order having distinct union all case when then else end cast count sum avg min max coalesce nullif now true false any values into insert update delete set returning conflict do nothing excluded current_timestamp interval extract date_trunc to_char upper lower length round abs jsonb json text int integer uuid boolean timestamp varchar numeric date time').split(/\s+/));
const TYPE_FAMILY = (udt) => {
  if (['int2', 'int4', 'int8', 'integer', 'bigint', 'smallint', 'serial', 'bigserial'].includes(udt)) return 'integer';
  if (udt === 'uuid') return 'uuid';
  if (['varchar', 'text', 'bpchar', 'name'].includes(udt)) return 'text';
  if (['bool'].includes(udt)) return 'boolean';
  if (['timestamptz', 'timestamp', 'date', 'time'].includes(udt)) return 'temporal';
  if (['jsonb', 'json'].includes(udt)) return 'json';
  if (['float4', 'float8', 'numeric'].includes(udt)) return 'numeric';
  if (udt === 'vector') return 'vector';
  return udt;
};

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, out); }
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}
function lineOf(src, idx) { return src.slice(0, idx).split('\n').length; }

/** Extract string literals (', ", `) with start offsets. Template ${..} -> ' ? ' marker + dynamic flag. */
function extractStrings(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    if (c === "'" || c === '"' || c === '`') {
      const q = c, start = i; i++;
      let val = '', dynamic = false;
      while (i < src.length) {
        if (src[i] === '\\') { val += src[i + 1] || ''; i += 2; continue; }
        if (q === '`' && src[i] === '$' && src[i + 1] === '{') {
          dynamic = true; val += ' ? ';
          let depth = 1; i += 2;
          while (i < src.length && depth > 0) { if (src[i] === '{') depth++; else if (src[i] === '}') depth--; i++; }
          continue;
        }
        if (src[i] === q) { i++; break; }
        val += src[i]; i++;
      }
      out.push({ value: val, start, dynamic, quote: q });
      continue;
    }
    i++;
  }
  return out;
}

function parseQuery(sqlRaw, ctx, refs, dynamics) {
  // Strip SQL string literals (JSONB keys / values live there) and comments.
  let sql = sqlRaw.replace(/'(?:[^']|'')*'/g, "''").replace(/--[^\n]*/g, ' ');
  const isSql = /^\s*(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|WITH)\b/i.test(sql);
  if (!isSql) return;
  const lineAt = (idx) => ctx.line + (sql.slice(0, idx).split('\n').length - 1);
  if (ctx.dynamic) dynamics.push({ ...ctx, kind: 'interpolated-sql', snippet: sqlRaw.slice(0, 120).replace(/\s+/g, ' ') });

  const alias = new Map(); // alias -> table
  const tables = new Set();
  const addTable = (t, a) => {
    t = t.toLowerCase();
    if (KEYWORDS.has(t) || t === 'lateral') return;
    tables.add(t); alias.set(t, t);
    if (a && !KEYWORDS.has(a.toLowerCase()) && a.toLowerCase() !== t) alias.set(a.toLowerCase(), t);
  };
  let m;
  const fromRe = /\b(?:FROM|JOIN)\s+(?:[a-z_][\w]*\.)?([a-z_][\w]*)(\s*\()?\s*(?:AS\s+)?([a-z_][\w]*)?/gi;
  const cteRe = /\bWITH\b([\s\S]*?)\bSELECT\b/i;
  const cteNames = new Set();
  { const cm = sql.match(cteRe); if (cm) for (const nm of cm[1].matchAll(/\b([a-z_][\w]*)\s+AS\s*\(/gi)) cteNames.add(nm[1].toLowerCase()); }
  while ((m = fromRe.exec(sql))) { if (m[2]) continue; if (cteNames.has(m[1].toLowerCase())) continue; addTable(m[1], m[3]); }
  const insRe = /\bINSERT\s+INTO\s+([a-z_][\w]*)\s*\(([^)]*)\)/gi;
  while ((m = insRe.exec(sql))) {
    addTable(m[1]);
    for (const col of m[2].split(',')) {
      const c = col.trim().toLowerCase();
      if (/^[a-z_][\w]*$/.test(c)) refs.push({ table: m[1].toLowerCase(), column: c, ...ctx, line: lineAt(m.index), via: 'insert-list' });
    }
  }
  const updRe = /\bUPDATE\s+([a-z_][\w]*)(?:\s+(?:AS\s+)?([a-z_][\w]*))?\s+SET\s+([\s\S]*?)(?=\bWHERE\b|\bRETURNING\b|$)/gi;
  while ((m = updRe.exec(sql))) {
    addTable(m[1], m[2]);
    for (const part of m[3].split(',')) {
      const cm = part.trim().match(/^(?:([a-z_][\w]*)\.)?([a-z_][\w]*)\s*=/);
      if (cm) refs.push({ table: alias.get((cm[1] || m[1]).toLowerCase()) || m[1].toLowerCase(), column: cm[2].toLowerCase(), ...ctx, line: lineAt(m.index), via: 'update-set' });
    }
  }
  const delRe = /\bDELETE\s+FROM\s+([a-z_][\w]*)(?:\s+(?:AS\s+)?([a-z_][\w]*))?/gi;
  while ((m = delRe.exec(sql))) addTable(m[1], m[2]);

  // Qualified references alias.column (alias resolved per query — MUST-5).
  const qualRe = /\b([a-z_][\w]*)\.([a-z_][\w]*)\b(?!\s*\()/g;
  const joinPairs = [];
  while ((m = qualRe.exec(sql))) {
    const t = alias.get(m[1].toLowerCase());
    if (t) refs.push({ table: t, column: m[2].toLowerCase(), ...ctx, line: lineAt(m.index), via: 'qualified' });
    else if (ctx.knownTables && ctx.knownTables.has(m[1].toLowerCase()))
      refs.push({ table: m[1].toLowerCase(), column: m[2].toLowerCase(), ...ctx, line: lineAt(m.index), via: 'qualified-table-name' });
  }
  // JOIN equality pairs for TYPE_MISMATCH detection.
  const joinEqRe = /\b([a-z_][\w]*)\.([a-z_][\w]*)\s*=\s*([a-z_][\w]*)\.([a-z_][\w]*)\b/g;
  while ((m = joinEqRe.exec(sql))) {
    const t1 = alias.get(m[1].toLowerCase()), t2 = alias.get(m[3].toLowerCase());
    if (t1 && t2) joinPairs.push({ t1, c1: m[2].toLowerCase(), t2, c2: m[4].toLowerCase(), ...ctx });
  }
  ctx.joinPairs = (ctx.joinPairs || []).concat(joinPairs);

  // Outer-query scope: strip parenthesised subqueries (their tables are not
  // in the outer query's column-resolution scope).
  let outerSql = '', depth = 0;
  for (const ch of sql) { if (ch === '(') depth++; else if (ch === ')') depth--; else if (depth === 0) outerSql += ch; if (depth === 0 && ch === '(') outerSql += '('; }
  const outerTables = new Set();
  { const re2 = /\b(?:FROM|JOIN)\s+(?:[a-z_][\w]*\.)?([a-z_][\w]*)/gi; let mm; while ((mm = re2.exec(outerSql))) if (!cteNames.has(mm[1].toLowerCase())) outerTables.add(mm[1].toLowerCase()); }
  const insT = sql.match(/\bINSERT\s+INTO\s+([a-z_][\w]*)/i); if (insT) outerTables.add(insT[1].toLowerCase());
  const updT = sql.match(/\bUPDATE\s+([a-z_][\w]*)/i); if (updT) outerTables.add(updT[1].toLowerCase());

  // Bare columns: only unambiguous single-table queries, clause-scoped.
  if (outerTables.size === 1) {
    const t = [...outerTables][0];
    const outAliases = new Set([...sql.matchAll(/\bAS\s+"?([a-z_][\w]*)"?/gi)].map(x => x[1].toLowerCase()));
    const pushBare = (w, idx) => { if (!KEYWORDS.has(w) && w !== t && !outAliases.has(w)) refs.push({ table: t, column: w, ...ctx, line: lineAt(idx), via: 'bare-single-table' }); };
    // SELECT list: simple leading identifiers per comma part
    const sel = outerSql.match(/\bSELECT\b([\s\S]*?)\bFROM\b/i);
    if (sel) {
      let off = sel.index + sel[0].indexOf(sel[1]);
      for (const part of sel[1].split(',')) {
        const pm = part.trim().match(/^([a-z_][\w]*)(\s+AS\s+[a-z_][\w]*)?\s*$/i) || part.trim().match(/^([a-z_][\w]*)\s+[a-z_][\w]*\s*$/i);
        if (pm) pushBare(pm[1].toLowerCase(), off);
        off += part.length + 1;
      }
    }
    // WHERE / GROUP BY / ORDER BY / HAVING: identifiers adjacent to operators, commas, parens
    const fromIdx = sql.search(/\bFROM\b/i);
    const tail = fromIdx >= 0 ? sql.slice(fromIdx) : '';
    const clause = tail.match(/\b(WHERE|GROUP\s+BY|ORDER\s+BY|HAVING)\b([\s\S]*)$/i);
    if (clause) {
      const body = clause[2];
      const clauseBase = fromIdx + clause.index;
      for (const tok of body.matchAll(/\b([a-z_][\w]*)\b(?=\s*(=|<|>|!|\bIS\b|\bIN\b|\bLIKE\b|\bILIKE\b|,|\)|\bASC\b|\bDESC\b|$))/gi)) {
        const after = body.slice(tok.index + tok[1].length).trimStart();
        if (after.startsWith('(')) continue;
        pushBare(tok[1].toLowerCase(), clauseBase + tok.index);
      }
      for (const tok of body.matchAll(/(?:\(|,|\bAND\b|\bOR\b|\bNOT\b)\s*([a-z_][\w]*)\b/gi)) pushBare(tok[1].toLowerCase(), clauseBase + tok.index);
    }
  } else if (outerTables.size > 1) {
    const sel = sql.match(/\bSELECT\b([\s\S]*?)\bFROM\s+(?:[a-z_][\w]*\.)?([a-z_][\w]*)/i);
    if (sel) for (const part of sel[1].split(',')) {
      const pm = part.trim().match(/^([a-z_][\w]*)$/);
      if (pm && !KEYWORDS.has(pm[1].toLowerCase())) {
        const col = pm[1].toLowerCase();
        const inScope = [...outerTables].some(t => ctx.schemaCols && ctx.schemaCols.get(t) && ctx.schemaCols.get(t).has(col));
        if (!inScope && sel[2]) refs.push({ table: sel[2].toLowerCase(), column: col, ...ctx, via: 'bare-primary-table' });
        else dynamics.push({ ...ctx, kind: 'unqualified-multitable', snippet: pm[1] });
      }
    }
  }
  // SELECT * handling for the property-access pass.
  const star = sql.match(/\bSELECT\s+(?:[a-z_][\w]*\.)?\*\s+FROM\s+([a-z_][\w]*)/i);
  if (star) ctx.starTables = (ctx.starTables || []).concat(star[1].toLowerCase());
}

/** Parse migrate.js bootstrap CREATE TABLE blocks + migration-file twins (MUST-2). */
function parseCreateTables(src) {
  const map = new Map();
  const re = /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([a-z_][\w]*)\s*\(([\s\S]*?)\)\s*(?:ON\s+CONFLICT|;|,|\))/gi;
  let m;
  while ((m = re.exec(src))) {
    // balance parens from the '(' position
    const openIdx = src.indexOf('(', m.index);
    let depth = 0, end = openIdx;
    for (; end < src.length; end++) { if (src[end] === '(') depth++; else if (src[end] === ')') { depth--; if (!depth) break; } }
    const body = src.slice(openIdx + 1, end);
    const cols = new Map();
    for (const line of body.split(/,\s*\n|,(?![^()]*\))\s*/)) {
      const cm = line.trim().match(/^"?([a-z_][\w]*)"?\s+(UUID|INTEGER|INT|SERIAL|BIGSERIAL|VARCHAR|TEXT|BOOLEAN|TIMESTAMP|JSONB|JSON|DATE|NUMERIC|DOUBLE|REAL|BYTEA|VECTOR)/i);
      if (cm && !/^(primary|foreign|unique|check|constraint)$/i.test(cm[1])) cols.set(cm[1].toLowerCase(), cm[2].toLowerCase());
    }
    if (cols.size) map.set(m[1].toLowerCase(), cols);
  }
  return map;
}

async function main() {
  const args = process.argv.slice(2);
  const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
  const manifestOut = args.includes('--manifest') ? args[args.indexOf('--manifest') + 1] : null;
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('DATABASE_URL required (fresh DB built by node migrate.js)'); process.exit(2); }
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: url, ssl: false });
  const { rows } = await pool.query(
    `SELECT table_name, column_name, data_type, udt_name FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name, ordinal_position`);
  const { rows: tblRows } = await pool.query(
    `SELECT table_name, table_type FROM information_schema.tables WHERE table_schema='public'`);
  await pool.end();
  const schema = new Map(); // table -> Map(col -> {data_type, udt_name, kind})
  for (const r of rows) {
    if (!schema.has(r.table_name)) schema.set(r.table_name, new Map());
    schema.get(r.table_name).set(r.column_name, r);
  }
  const tableKind = new Map(tblRows.map(r => [r.table_name, r.table_type]));
  const knownTables = new Set(schema.keys());

  // DDL presence index over migrations/ + migrate.js, for chain-status classification.
  const migDir = path.join(ROOT, 'migrations');
  const migFiles = fs.readdirSync(migDir).filter(f => f.endsWith('.js') || f.endsWith('.sql')).sort();
  const neverRun = new Set(migFiles.filter(f => f > HALT_FILE || f === HALT_FILE));
  const ddlIndex = new Map(); // table.column -> Set(file)
  const addDdl = (file, tableMap) => { for (const [t, cols] of tableMap) for (const c of cols.keys()) { const k = `${t}.${c}`; if (!ddlIndex.has(k)) ddlIndex.set(k, new Set()); ddlIndex.get(k).add(file); } };
  const migSrc = fs.readFileSync(path.join(ROOT, 'migrate.js'), 'utf8');
  const bootstrap = parseCreateTables(migSrc);
  addDdl('migrate.js(bootstrap)', bootstrap);
  // ALTER TABLE ... ADD COLUMN in migration sources
  for (const f of migFiles) {
    const src = fs.readFileSync(path.join(migDir, f), 'utf8');
    addDdl(f, parseCreateTables(src));
    for (const blk of src.matchAll(/ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([a-z_][\w]*)([\s\S]*?);/gi)) {
      for (const ac of blk[2].matchAll(/ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][\w]*)/gi)) {
        const k = `${blk[1].toLowerCase()}.${ac[1].toLowerCase()}`; if (!ddlIndex.has(k)) ddlIndex.set(k, new Set()); ddlIndex.get(k).add(f);
      }
    }
  }

  // ---- static extraction ----
  const refs = [], dynamics = [], joinPairsAll = [];
  const files = [...SCAN_DIRS.flatMap(d => walk(path.join(ROOT, d))), ...SCAN_FILES.map(f => path.join(ROOT, f)).filter(fs.existsSync),
    ...VIEW_MIGRATIONS.map(f => path.join(migDir, f)).filter(fs.existsSync)];
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    const rel = path.relative(ROOT, file);
    const starOccurrences = [];
    for (const s of extractStrings(src)) {
      const ctx = { file: rel, line: lineOf(src, s.start), dynamic: s.dynamic, knownTables, joinPairs: [], schemaCols: new Map([...schema].map(([t, cols]) => [t, new Set(cols.keys())])) };
      parseQuery(s.value, ctx, refs, dynamics);
      joinPairsAll.push(...(ctx.joinPairs || []));
      if (ctx.starTables) for (const t of ctx.starTables) starOccurrences.push({ table: t, start: s.start });
    }
    // (a) SELECT * + JS property access, scoped precisely: the star query must be
    // the argument of an assignment `const X = await ....query(<this string>)`;
    // row vars are `Y = X.rows[0]` / destructured rows; only Y.<prop> accesses count.
    for (const occ of starOccurrences) {
      const before = src.slice(Math.max(0, occ.start - 400), occ.start);
      const am = before.match(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+[\w.]+\.query\(\s*$/);
      if (!am) { dynamics.push({ file: rel, line: lineOf(src, occ.start), kind: 'select-star-untracked', snippet: occ.table }); continue; }
      const resVar = am[1];
      const after = src.slice(occ.start, occ.start + 6000);
      const rowVars = new Set();
      for (const mm of after.matchAll(new RegExp(`\\b([A-Za-z_$][\\w$]*)\\s*=\\s*${resVar}\\.rows\\[0\\]`, 'g'))) rowVars.add(mm[1]);
      for (const mm of after.matchAll(new RegExp(`\\b([A-Za-z_$][\\w$]*)\\s*=\\s*${resVar}\\.rows\\b`, 'g'))) rowVars.add(mm[1]);
      for (const v of rowVars) {
        for (const pm of after.matchAll(new RegExp(`\\b${v}\\.([a-z_][\\w]*)`, 'g'))) {
          const col = pm[1].toLowerCase();
          if (!KEYWORDS.has(col) && !['length','rows'].includes(col))
            refs.push({ table: occ.table, column: col, file: rel, line: lineOf(src, occ.start + pm.index), via: 'select-star-property' });
        }
      }
      // rows.map(r => r.col) pattern
      for (const mm of after.matchAll(new RegExp(`${resVar}\\.rows\\.map\\(\\s*\\(?\\s*([A-Za-z_$][\\w$]*)`, 'g'))) {
        const v = mm[1];
        const seg = after.slice(mm.index, mm.index + 800);
        for (const pm of seg.matchAll(new RegExp(`\\b${v}\\.([a-z_][\\w]*)`, 'g'))) {
          const col = pm[1].toLowerCase();
          if (!KEYWORDS.has(col)) refs.push({ table: occ.table, column: col, file: rel, line: lineOf(src, occ.start + mm.index + pm.index), via: 'select-star-property' });
        }
      }
    }
    // (c) column-name arrays feeding dynamic SQL: array literal of snake_case strings
    // iterated / joined in the same file that also names a target table in SQL.
    const fileTables = new Set(refs.filter(r => r.file === rel).map(r => r.table));
    for (const am of src.matchAll(/\[((?:\s*'[a-z_][\w]*'\s*,?){3,})\]/g)) {
      const cols = [...am[1].matchAll(/'([a-z_][\w]*)'/g)].map(x => x[1]);
      const region = src.slice(am.index, am.index + 4000);
      if (cols.every(c => c.includes('_')) && /push\(\s*`[^`]*\$\{\w+\}\s*=|\$\{\w+\}\s*=\s*\$/.test(region) && fileTables.size >= 1) {
        dynamics.push({ file: rel, line: lineOf(src, am.index), kind: 'column-name-array', snippet: cols.join(',') });
        // attribute to the single most common table in file if unambiguous context names one
        const tblMatch = region.match(/\b(?:FROM|UPDATE|INTO)\s+([a-z_][\w]*)/i);
        if (tblMatch) for (const c of cols) refs.push({ table: tblMatch[1].toLowerCase(), column: c, file: rel, line: lineOf(src, am.index), via: 'column-array' });
      }
    }
    // (b) client-payload-derived expectations: req.body destructured fields that are
    // passed as values into INSERT/UPDATE of a table in the same handler file are
    // already captured via insert-list/update-set; fields destructured AND used in
    // a COALESCE($n, field) SET pattern are captured by update-set parsing.
  }

  // ---- compare ----
  const findings = new Map();
  const manifest = new Map(); // table.column -> {refs:[], exists, type}
  for (const r of refs) {
    const key = `${r.table}.${r.column}`;
    if (!manifest.has(key)) manifest.set(key, { table: r.table, column: r.column, refs: [], exists: false, udt: null });
    const e = manifest.get(key);
    e.refs.push(`${r.file}:${r.line}(${r.via})`);
    const tbl = schema.get(r.table);
    if (tbl && tbl.has(r.column)) { e.exists = true; e.udt = tbl.get(r.column).udt_name; continue; }
    if (!findings.has(key)) {
      const ddlFiles = ddlIndex.get(key) || new Set();
      let status;
      if ([...ddlFiles].length && [...ddlFiles].every(f => neverRun.has(f))) status = 'CREATED_POST_P2_HALT';
      else if ([...ddlFiles].length) status = 'NEVER_CREATED'; // DDL exists in executed chain but shadowed/no-op (bootstrap twin) or otherwise never lands
      else {
        let elsewhere = false;
        for (const [t, cols] of schema) if (cols.has(r.column)) { elsewhere = true; break; }
        status = elsewhere ? 'WRONG_TABLE' : 'NEVER_CREATED';
      }
      findings.set(key, { table: r.table, column: r.column, status, refs: [], ddl: [...ddlFiles], tableExists: schema.has(r.table), tableKind: tableKind.get(r.table) || 'MISSING_TABLE' });
    }
    findings.get(key).refs.push(`${r.file}:${r.line}(${r.via})`);
  }
  // TYPE_MISMATCH from join pairs
  for (const p of joinPairsAll) {
    const a = schema.get(p.t1)?.get(p.c1), b = schema.get(p.t2)?.get(p.c2);
    if (a && b && TYPE_FAMILY(a.udt_name) !== TYPE_FAMILY(b.udt_name)) {
      const key = `${p.t1}.${p.c1}=${p.t2}.${p.c2}`;
      findings.set(key, { table: p.t1, column: p.c1, status: 'TYPE_MISMATCH', refs: [`${p.file}:${p.line}(join)`], ddl: [], detail: `${p.t1}.${p.c1} ${a.udt_name} vs ${p.t2}.${p.c2} ${b.udt_name}`, tableExists: true });
    }
  }
  // Tables referenced but entirely missing
  const missingTables = new Map();
  for (const r of refs) if (!schema.has(r.table)) {
    if (!missingTables.has(r.table)) missingTables.set(r.table, []);
    missingTables.get(r.table).push(`${r.file}:${r.line}`);
  }

  // MUST-2 bootstrap shadow register: twin columns (later CREATE TABLE) absent from fresh DB
  const shadow = [];
  for (const [t, cols] of bootstrap) {
    for (const f of migFiles) {
      const twin = parseCreateTables(fs.readFileSync(path.join(migDir, f), 'utf8')).get(t);
      if (!twin) continue;
      for (const [c, ty] of twin) {
        if (!cols.has(c) && !(schema.get(t)?.has(c))) shadow.push({ table: t, column: c, twinFile: f, twinType: ty, referencedByCode: manifest.has(`${t}.${c}`) });
      }
      break; // first twin only
    }
  }

  const list = [...findings.values()].sort((a, b) => (a.table + a.column).localeCompare(b.table + b.column));
  console.log(`# schema-drift audit — tables in fresh DB: ${schema.size}, code refs checked: ${refs.length}, distinct table.column: ${manifest.size}`);
  console.log(`# findings: ${list.length}`);
  for (const f of list) console.log(`${f.table}.${f.column}\t${f.status}\t${f.detail || ''}\tDDL:${f.ddl.join('|') || '-'}\tREFS:${[...new Set(f.refs)].slice(0, 6).join(' ; ')}`);
  console.log(`# missing tables referenced: ${[...missingTables.keys()].join(', ') || 'none'}`);
  console.log(`# dynamic/unresolved register: ${dynamics.length}`);
  for (const d of dynamics.slice(0, 200)) console.log(`DYNAMIC\t${d.kind}\t${d.file}:${d.line}\t${(d.snippet || '').slice(0, 100)}`);
  console.log(`# bootstrap shadow register (twin cols absent from fresh DB): ${shadow.length}`);
  for (const s of shadow) console.log(`SHADOW\t${s.table}.${s.column}\ttwin:${s.twinFile}(${s.twinType})\tcode-ref:${s.referencedByCode}`);

  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ findings: list, dynamics, shadow, missingTables: [...missingTables.entries()], manifestSize: manifest.size, refsCount: refs.length }, null, 2));
  if (manifestOut) {
    const lines = ['| table.column | exists on fresh DB | type (udt) | code references (first 3) |', '|---|---|---|---|'];
    for (const e of [...manifest.values()].sort((a, b) => (a.table + a.column).localeCompare(b.table + b.column)))
      lines.push(`| ${e.table}.${e.column} | ${e.exists ? 'yes' : 'NO'} | ${e.udt || '-'} | ${[...new Set(e.refs)].slice(0, 3).join('<br>')} |`);
    fs.writeFileSync(manifestOut, lines.join('\n') + '\n');
  }
  process.exit(list.length ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(2); });
