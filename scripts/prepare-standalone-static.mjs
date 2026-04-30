import { cp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const standaloneDir = path.join(root, ".next", "standalone");
const nextStaticSource = path.join(root, ".next", "static");
const nextStaticTarget = path.join(standaloneDir, ".next", "static");
const publicSource = path.join(root, "public");
const publicTarget = path.join(standaloneDir, "public");

async function copyDir(source, target) {
  if (!existsSync(source)) {
    throw new Error(`Required build asset directory is missing: ${path.relative(root, source)}`);
  }

  await rm(target, { recursive: true, force: true });
  await mkdir(path.dirname(target), { recursive: true });
  await cp(source, target, { recursive: true, force: true });
}

if (!existsSync(standaloneDir)) {
  throw new Error("Missing .next/standalone. Run next build before preparing standalone static assets.");
}

await copyDir(nextStaticSource, nextStaticTarget);
await copyDir(publicSource, publicTarget);

console.log("Prepared standalone static assets.");
