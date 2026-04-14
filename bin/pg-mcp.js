#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';

const CONFIG_DIR = path.join(os.homedir(), '.pg-mcp');
const ENV_FILE = path.join(CONFIG_DIR, '.env');

async function firstRunSetup() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise(resolve => rl.question(q, resolve));

  console.log('\npg-mcp: first-time setup');
  console.log('─────────────────────────');

  const portInput = await ask('Port to run on (default: 3000): ');
  rl.close();

  const port = portInput.trim() || '3000';

  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(ENV_FILE, `PORT=${port}\n`);

  console.log(`\nConfig saved to ${ENV_FILE}\n`);
}

async function main() {
  if (!fs.existsSync(ENV_FILE)) {
    await firstRunSetup();
  }

  await import('../index.js');
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
