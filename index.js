import 'dotenv/config';
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import pg from 'pg';
import { z } from 'zod';

const { Pool } = pg;

const pool = new Pool({
  host: process.env.PG_HOST,
  port: Number(process.env.PG_PORT) || 5432,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DB,
});

// Block any statement that isn't a read
const WRITE_PATTERN = /^\s*(insert|update|delete|drop|create|alter|truncate|grant|revoke|replace|merge)\b/i;

const app = express();
app.use(express.json());

app.post('/mcp', async (req, res) => {
  const server = new McpServer({ name: 'pg-mcp', version: '1.0.0' });

  server.tool(
    'query',
    'Run a read-only SQL query on the PostgreSQL database',
    { sql: z.string().describe('A SELECT (read-only) SQL statement') },
    async ({ sql }) => {
      if (WRITE_PATTERN.test(sql)) {
        return {
          content: [{ type: 'text', text: 'Blocked: only read-only queries are allowed.' }],
          isError: true,
        };
      }
      try {
        const result = await pool.query(sql);
        return {
          content: [{ type: 'text', text: JSON.stringify(result.rows, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `DB error: ${err.message}` }],
          isError: true,
        };
      }
    }
  );

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => console.log(`pg-mcp listening on port ${PORT}`));
