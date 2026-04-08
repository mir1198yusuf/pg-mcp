# pg-mcp

A minimal, local MCP server that gives Claude Code read-only access to your PostgreSQL database. No cloud, no third-party service — runs entirely on your machine.

## How it works

Claude connects to this server over HTTP. When it needs data from your DB, it calls the `query` tool with a SQL statement. The server blocks any write operations and forwards the rest to PostgreSQL.

## Setup

```bash
git clone https://github.com/mir1198yusuf/pg-mcp
cd pg-mcp
npm install
cp .env.example .env   # fill in your DB credentials
```

## Configuration

Edit `.env`:

```env
PG_HOST=localhost
PG_PORT=5432
PG_USER=postgres
PG_PASSWORD=yourpassword
PG_DB=mydb
PG_SSL=false          # set to true if your DB requires SSL
PORT=3000
```

## Run

```bash
node index.js
```

## Connect Claude Code

Add this to your Claude Code MCP settings (`~/.claude/settings.json` or claude_desktop_config.json):

```json
{
  "mcpServers": {
    "pg-mcp": {
      "type": "http",
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

Restart Claude Code. It will now have a `query` tool to read from your database.

## Security

- **Read-only enforced server-side** — `INSERT`, `UPDATE`, `DELETE`, `DROP`, `CREATE`, `ALTER`, `TRUNCATE`, `GRANT`, `REVOKE`, `REPLACE`, `MERGE` are all blocked before reaching the DB.
- **Local only** — the server binds to `localhost`. Never expose it to the internet.
- **No logging** — query contents are not written to disk.

## Tool exposed to Claude

| Tool | Input | Description |
|------|-------|-------------|
| `query` | `sql: string` | Runs a read-only SQL statement and returns rows as JSON |
