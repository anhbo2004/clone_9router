import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const runtimeRoot = path.join(root, ".next-runtime");
const manifestFile = path.join(runtimeRoot, "current.json");

if (!existsSync(manifestFile)) {
  throw new Error("Missing .next-runtime/current.json. Run npm.cmd run build before npm.cmd start.");
}

const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
const serverFile = path.join(runtimeRoot, manifest.runtime, "server.js");

if (!existsSync(serverFile)) {
  throw new Error(`Missing runtime server: ${path.relative(root, serverFile)}. Run npm.cmd run build again.`);
}

const child = spawn(process.execPath, [serverFile], {
  cwd: root,
  env: {
    ...process.env,
    NODE_ENV: "production",
  },
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
