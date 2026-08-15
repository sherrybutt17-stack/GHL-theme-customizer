import { config } from "dotenv";
import { resolve } from "node:path";

/**
 * Load `.env` from the REPO ROOT as well as the workspace directory.
 *
 * npm workspaces run scripts with `cwd = apps/server`, which is where plain
 * `dotenv/config` looks — but this repo keeps a single `.env` at the root. The result
 * was that `npm run dev:server`, the documented dev command, crashed on boot with
 * "Missing required env var: GHL_APP_CLIENT_ID", and every script had to re-solve it
 * privately (six of them did, one didn't).
 *
 * Order matters: the workspace-local file is loaded FIRST because dotenv never
 * overwrites a variable that is already set, so a per-workspace `.env` still wins over
 * the shared root one. Real process env beats both, which is what deployment needs —
 * on Render there is no file at all and the platform's variables are used untouched.
 *
 * `../../../..` resolves to the repo root from BOTH `src/services` and the compiled
 * `dist/services`, since tsconfig keeps rootDir `src` → outDir `dist` at the same depth.
 *
 * Import this before anything that reads `process.env` at module scope.
 */
config();
config({ path: resolve(__dirname, "../../../..", ".env") });
