# pg-mcp

![Built with Claude Code](https://img.shields.io/badge/Built%20with-Claude%20Code-orange)

A minimal, local MCP server that gives Claude Code read-only access to your PostgreSQL databases. No cloud, no third-party service — runs entirely on your machine. Supports multiple databases. Also has UI dashboard for easy setup.

![DB list](https://raw.githubusercontent.com/mir1198yusuf/pg-mcp/main/assets/ui-list.png)

## How it works

Claude connects to this server over HTTP. When it needs data, it first calls `list_dbs` to find the right database, then calls `query` with a SQL statement. The server blocks any write operations before they reach the DB.

## Setup

```bash
npm install -g pg-mcp
```

## Run

```bash
pg-mcp
```

First run will ask you:

```
pg-mcp: first-time setup
─────────────────────────
Port to run on (default: 3000):
```

Config is saved to `~/.pg-mcp/.env`. Every run after that starts the server directly.

## Add databases

Open the UI in your browser:

```
http://localhost:3000/ui
```

Use it to add your database connections. Details are saved to `~/.pg-mcp/dbs.json` — never committed, stays on your machine.

## Connect Claude Code

Run this once in your terminal:

```bash
claude mcp add --transport http --scope local pgmcplocal http://localhost:3000/mcp
```

Restart Claude Code. It will now have access to all your configured databases.

## UI

Visit `http://localhost:3000/ui` to manage databases:

- **Add** a new database connection
- **Edit** an existing one (description, credentials, anything)
- **Retry** a failed connection without restarting the server
- **Delete** a connection

![Add DB form](https://raw.githubusercontent.com/mir1198yusuf/pg-mcp/main/assets/ui-form.png)

Each database shows a live availability status. If a DB is unreachable at startup the server still starts — Claude will be told that DB is unavailable.

## Tools exposed to Claude

| Tool | Input | Description |
|------|-------|-------------|
| `list_dbs` | — | Lists all databases with identifiers, descriptions, and availability status. Claude calls this periodically to get a fresh list — database properties and availability can change while the server is running. |
| `query` | `db_identifier`, `sql` | Runs a read-only SQL statement on the identified database and returns rows as JSON. If the db_identifier is not found, Claude is instructed to call `list_dbs` again and retry — this handles cases where a database was added or modified after the last list. |

## Security

- **Never share `~/.pg-mcp/dbs.json`** — it contains your database credentials in plain text. Never commit or share it.
- **Read-only enforced server-side** — `INSERT`, `UPDATE`, `DELETE`, `DROP`, `CREATE`, `ALTER`, `TRUNCATE`, `GRANT`, `REVOKE`, `REPLACE`, `MERGE` are all blocked before reaching the DB.
- **Do not run this MCP server on a public server** — this is intended to run locally on your own machine only. Running it on a VPS or any publicly reachable host exposes your databases to anyone who can reach the port.

