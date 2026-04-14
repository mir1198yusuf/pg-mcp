import dotenv from 'dotenv';
import os from 'os';
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import pg from 'pg';
import { z } from 'zod';
import fs from 'fs/promises';
import fss from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CONFIG_DIR = path.join(os.homedir(), '.pg-mcp');
const DBS_FILE = path.join(CONFIG_DIR, 'dbs.json');

// Load env from ~/.pg-mcp/.env (works for both npm global and local dev)
dotenv.config({ path: path.join(CONFIG_DIR, '.env') });

// Ensure config dir exists
fss.mkdirSync(CONFIG_DIR, { recursive: true });

// In-memory state — each entry: { identifier, description, host, port, user, password, db, ssl, pool, status }
// identifier: slug, no whitespace, set once, never changed — Claude uses this to identify the DB
let dbs = [];

async function initPool(entry) {
  try {
    const pool = new Pool({
      host: entry.host,
      port: Number(entry.port) || 5432,
      user: entry.user,
      password: entry.password,
      database: entry.db,
      ssl: entry.ssl ? { rejectUnauthorized: false } : false,
    });
    await pool.query('SELECT 1');
    entry.pool = pool;
    entry.status = 'available';
    console.log(`[db] ${entry.identifier} connected`);
  } catch (err) {
    entry.pool = null;
    entry.status = 'unavailable';
    console.warn(`[db] ${entry.identifier} unavailable: ${err.message}`);
  }
}

async function destroyPool(entry) {
  if (entry.pool) {
    try { await entry.pool.end(); } catch {}
    entry.pool = null;
    entry.status = 'unavailable';
  }
}

async function persistDbs() {
  const toSave = dbs.map(({ pool, status, ...rest }) => rest);
  await fs.writeFile(DBS_FILE, JSON.stringify(toSave, null, 2));
}

async function loadDbs() {
  try {
    const raw = await fs.readFile(DBS_FILE, 'utf8');
    const configs = JSON.parse(raw);
    for (const config of configs) {
      const entry = { ...config, pool: null, status: 'unavailable' };
      dbs.push(entry);
      await initPool(entry);
    }
  } catch (err) {
    if (err.code !== 'ENOENT') console.error(`[startup] Failed to load dbs.json: ${err.message}`);
  }
}

const SLUG_RE = /^\S+$/; // no whitespace
const WRITE_PATTERN = /^\s*(insert|update|delete|drop|create|alter|truncate|grant|revoke|replace|merge)\b/i;

const app = express();
app.use(express.json());

// ── UI ────────────────────────────────────────────────────────────────────────

app.get('/ui', (req, res) => res.sendFile(path.join(__dirname, 'ui.html')));

// ── REST API ──────────────────────────────────────────────────────────────────

app.get('/api/dbs', (req, res) => {
  res.json(dbs.map(({ pool, ...rest }) => rest));
});

app.post('/api/dbs', async (req, res) => {
  try {
    const { identifier, description, host, port, user, password, db, ssl } = req.body;
    if (!SLUG_RE.test(identifier)) return res.status(400).json({ error: 'Identifier must not contain spaces or whitespace' });
    if (dbs.find(d => d.identifier === identifier)) return res.status(400).json({ error: 'Identifier already exists' });

    const entry = { identifier, description, host, port: Number(port) || 5432, user, password, db, ssl: !!ssl, pool: null, status: 'unavailable' };
    dbs.push(entry);
    await initPool(entry);
    await persistDbs();
    const { pool, ...client } = entry;
    res.json(client);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// identifier is immutable — PUT only updates connection config
app.put('/api/dbs/:identifier', async (req, res) => {
  try {
    const idx = dbs.findIndex(d => d.identifier === req.params.identifier);
    if (idx === -1) return res.status(404).json({ error: 'DB not found' });

    const { description, host, port, user, password, db, ssl } = req.body;
    const entry = dbs[idx];
    await destroyPool(entry);
    Object.assign(entry, { description, host, port: Number(port) || 5432, user, password, db, ssl: !!ssl });
    await initPool(entry);
    await persistDbs();
    const { pool, ...client } = entry;
    res.json(client);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/dbs/:identifier', async (req, res) => {
  try {
    const idx = dbs.findIndex(d => d.identifier === req.params.identifier);
    if (idx === -1) return res.status(404).json({ error: 'DB not found' });

    await destroyPool(dbs[idx]);
    dbs.splice(idx, 1);
    await persistDbs();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── MCP ───────────────────────────────────────────────────────────────────────

app.post('/mcp', async (req, res) => {
  const server = new McpServer({ name: 'pg-mcp', version: '1.0.0' });

  server.tool(
    'list_dbs',
    'List all configured databases with their identifiers, descriptions, and availability status. Call this periodically before querying to get a fresh list — the user may have added or changed databases via the UI since the last time you called this.',
    {},
    async () => {
      const list = dbs.map(d => `${d.identifier} [${d.status}] — ${d.description || 'no description'}`).join('\n');
      return { content: [{ type: 'text', text: list || 'No databases configured.' }] };
    }
  );

  server.tool(
    'query',
    'Run a read-only SQL query on a specific database. If this returns an error saying the db_identifier was not found, call list_dbs to get a fresh database list and retry with the correct db_identifier.',
    {
      db_identifier: z.string().describe('Exact db_identifier from list_dbs'),
      sql: z.string().describe('A SELECT (read-only) SQL statement'),
    },
    async ({ db_identifier, sql }) => {
      const entry = dbs.find(d => d.identifier === db_identifier);
      if (!entry) return { content: [{ type: 'text', text: `DB "${db_identifier}" not found. Use list_dbs to see available databases.` }], isError: true };
      if (entry.status === 'unavailable') return { content: [{ type: 'text', text: `DB "${db_identifier}" is unavailable. Ask the user to retry the connection from the UI.` }], isError: true };
      if (WRITE_PATTERN.test(sql)) return { content: [{ type: 'text', text: 'Blocked: only read-only queries are allowed.' }], isError: true };

      console.log(`[query:${db_identifier}] ${sql}`);
      try {
        const result = await entry.pool.query(sql);
        console.log(`[query:${db_identifier} done] ${result.rowCount} row(s) returned`);
        return { content: [{ type: 'text', text: JSON.stringify(result.rows, null, 2) }] };
      } catch (err) {
        console.error(`[query:${db_identifier} error] ${err.message}`);
        return { content: [{ type: 'text', text: `DB error: ${err.message}` }], isError: true };
      }
    }
  );

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT) || 3000;
loadDbs().then(() => {
  app.listen(PORT, () => {
    console.log(`pg-mcp listening on port ${PORT}`);
    console.log(`UI: http://localhost:${PORT}/ui`);
  });
});
