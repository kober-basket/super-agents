#!/usr/bin/env node
import { main } from "./super-agents.mjs";

main(process.argv.slice(2), { executableName: "super-agents-admin" }).catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: { message } }, null, 2)}\n`);
  } else {
    process.stderr.write(`${message}\n`);
  }
  process.exitCode = error?.exitCode ?? 1;
});
