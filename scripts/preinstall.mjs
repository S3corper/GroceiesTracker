import { rmSync } from "node:fs";

if (!process.env.npm_config_user_agent?.startsWith("pnpm/")) {
  console.error("Use pnpm to install workspace dependencies.");
  process.exit(1);
}

for (const file of ["package-lock.json", "yarn.lock"]) {
  rmSync(new URL(`../${file}`, import.meta.url), { force: true });
}
