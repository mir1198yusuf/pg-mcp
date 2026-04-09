# pg-mcp

A minimal, local MCP server that gives Claude Code read-only access to your PostgreSQL databases. No cloud, no third-party service — runs entirely on your machine. Supports multiple databases.

## How it works

Claude connects to this server over HTTP. When it needs data, it first calls `list_dbs` to find the right database, then calls `query` with a SQL statement. The server blocks any write operations before they reach the DB.

## Setup

```bash
git clone https://github.com/mir1198yusuf/pg-mcp
cd pg-mcp
npm install
cp .env.example .env   # set PORT if needed (default 3000)
```

## Add databases

Start the server and open the UI:

```bash
npm start
# open http://localhost:3000/ui
```

Use the UI to add your databases. Connection details are saved to `dbs.json` (gitignored — never committed).

You can also bootstrap from the example file:

```bash
cp dbs.json.example dbs.json  # then edit with your credentials
```

## Connect Claude Code

Run this once in your terminal:

```bash
claude mcp add --transport http --scope local pgmcplocal http://localhost:3000/mcp
```

Restart Claude Code. It will now have access to all your configured databases.

## UI

Visit `http://localhost:3000/ui` to manage databases:

- **Add** a new database connection
- **Edit** an existing one (name, credentials, anything)
- **Retry** a failed connection without restarting the server
- **Delete** a database

Each database shows a live availability status. If a DB is unreachable at startup the server still starts — Claude will be told that DB is unavailable.

## Tools exposed to Claude

| Tool | Input | Description |
|------|-------|-------------|
| `list_dbs` | — | Lists all databases with names, descriptions, and availability. Claude calls this first when unsure which DB to use. |
| `query` | `db_name`, `sql` | Runs a read-only SQL statement on the named database and returns rows as JSON. |

## Security

- **Read-only enforced server-side** — `INSERT`, `UPDATE`, `DELETE`, `DROP`, `CREATE`, `ALTER`, `TRUNCATE`, `GRANT`, `REVOKE`, `REPLACE`, `MERGE` are all blocked before reaching the DB.
- **Do not run on a public server** — this is intended to run locally on your own machine only. Running it on a VPS or any publicly reachable host exposes your databases to anyone who can reach the port.

## Roadmap

- **Docker / npm package** — ship as an npm-installable package that spins up the server in a Docker container, so Node.js is not required on the host machine.
