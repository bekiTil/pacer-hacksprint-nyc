// Shared. Loads .env.local for scripts and the MCP server (Next.js loads it on its own).
// Import this first in any entry point that runs outside Next.js: `import '../core/env';`
import { config } from 'dotenv';
import path from 'node:path';

export const REPO_ROOT = path.resolve(__dirname, '..');

config({ path: path.join(REPO_ROOT, '.env.local'), quiet: true });
config({ path: path.join(REPO_ROOT, '.env'), quiet: true });
