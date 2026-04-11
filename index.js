import 'dotenv/config';
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import pg from 'pg';
import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DBS_FILE = path.join(__dirname, 'dbs.json');

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
  const { identifier, description, host, port, user, password, db, ssl } = req.body;
  if (!SLUG_RE.test(identifier)) return res.status(400).json({ error: 'Identifier must not contain spaces or whitespace' });
  if (dbs.find(d => d.identifier === identifier)) return res.status(400).json({ error: 'Identifier already exists' });

  const entry = { identifier, description, host, port: Number(port) || 5432, user, password, db, ssl: !!ssl, pool: null, status: 'unavailable' };
  dbs.push(entry);
  await initPool(entry);
  await persistDbs();
  const { pool, ...client } = entry;
  res.json(client);
});

// identifier is immutable — PUT only updates connection config
app.put('/api/dbs/:identifier', async (req, res) => {
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
});

app.delete('/api/dbs/:identifier', async (req, res) => {
  const idx = dbs.findIndex(d => d.identifier === req.params.identifier);
  if (idx === -1) return res.status(404).json({ error: 'DB not found' });

  await destroyPool(dbs[idx]);
  dbs.splice(idx, 1);
  await persistDbs();
  res.json({ ok: true });
});

// ── MCP ───────────────────────────────────────────────────────────────────────

app.post('/mcp', async (req, res) => {
  const server = new McpServer({ name: 'pg-mcp', version: '1.0.0' });

  server.tool(
    'list_dbs',
    'List all configured databases with their identifiers, descriptions, and availability status. Call this first to find the correct identifier before querying.',
    {},
    async () => {
      const list = dbs.map(d => `${d.identifier} [${d.status}] — ${d.description || 'no description'}`).join('\n');
      return { content: [{ type: 'text', text: list || 'No databases configured.' }] };
    }
  );

  server.tool(
    'query',
    'Run a read-only SQL query on a specific database. Use list_dbs first to get the correct identifier if unsure.',
    {
      identifier: z.string().describe('Exact identifier from list_dbs'),
      sql: z.string().describe('A SELECT (read-only) SQL statement'),
    },
    async ({ identifier, sql }) => {
      const entry = dbs.find(d => d.identifier === identifier);
      if (!entry) return { content: [{ type: 'text', text: `DB "${identifier}" not found. Use list_dbs to see available databases.` }], isError: true };
      if (entry.status === 'unavailable') return { content: [{ type: 'text', text: `DB "${identifier}" is unavailable. Ask the user to retry the connection from the UI.` }], isError: true };
      if (WRITE_PATTERN.test(sql)) return { content: [{ type: 'text', text: 'Blocked: only read-only queries are allowed.' }], isError: true };

      console.log(`[query:${identifier}] ${sql}`);
      try {
        const result = await entry.pool.query(sql);
        console.log(`[query:${identifier} done] ${result.rowCount} row(s) returned`);
        return { content: [{ type: 'text', text: JSON.stringify(result.rows, null, 2) }] };
      } catch (err) {
        console.error(`[query:${identifier} error] ${err.message}`);
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
