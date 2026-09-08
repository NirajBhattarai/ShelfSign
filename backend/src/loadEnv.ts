import dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Side-effect module imported first from index.ts so process.env is
// populated before any other backend module reads it. Absolute path so
// launchd/npm cwd (monorepo root) does not matter.
dotenv.config({
  path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env"),
});
