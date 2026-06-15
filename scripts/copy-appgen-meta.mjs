import { cp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";

const metaDir = "dist/_appgen_meta";

await rm(metaDir, { recursive: true, force: true });
await mkdir(metaDir, { recursive: true });

if (existsSync(".openai/hosting.json")) {
  await cp(".openai/hosting.json", `${metaDir}/appgarden.json`);
}

if (existsSync("drizzle")) {
  await cp("drizzle", `${metaDir}/drizzle`, { recursive: true });
}
