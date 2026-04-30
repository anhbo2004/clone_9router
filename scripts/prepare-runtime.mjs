import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const standaloneDir = path.join(root, ".next", "standalone");
const buildIdFile = path.join(root, ".next", "BUILD_ID");
const runtimeRoot = path.join(root, ".next-runtime");
const manifestFile = path.join(runtimeRoot, "current.json");

if (!existsSync(standaloneDir)) {
  throw new Error("Missing .next/standalone. Run next build before preparing runtime.");
}

const rawBuildId = existsSync(buildIdFile)
  ? (await readFile(buildIdFile, "utf8")).trim()
  : new Date().toISOString();
const safeBuildId = rawBuildId.replace(/[^a-zA-Z0-9._-]/g, "-");
const runtimeName = `${safeBuildId}-${Date.now()}`;
const runtimeDir = path.join(runtimeRoot, runtimeName);

await mkdir(runtimeRoot, { recursive: true });
await rm(runtimeDir, { recursive: true, force: true });
await cp(standaloneDir, runtimeDir, { recursive: true, force: true });
await writeFile(
  manifestFile,
  JSON.stringify(
    {
      runtime: runtimeName,
      preparedAt: new Date().toISOString(),
      buildId: rawBuildId,
    },
    null,
    2
  ),
  "utf8"
);

console.log(`Prepared runtime: .next-runtime/${runtimeName}`);
