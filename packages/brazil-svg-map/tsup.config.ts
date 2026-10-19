import { copyFile, readFile, writeFile } from "node:fs/promises";
import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", data: "src/data.ts" },
  // ESM only: code splitting gives each state's municipalities its own chunk
  format: ["esm"],
  splitting: true,
  dts: true,
  clean: true,
  external: ["react"],
  async onSuccess() {
    // the component holds state, so the main entry is "use client" (Next.js App Router);
    // the "data" entry has no directive so it can be used from Server Components
    const code = await readFile("dist/index.js", "utf8");
    if (!code.startsWith('"use client"')) await writeFile("dist/index.js", `"use client";\n${code}`);
    await copyFile("src/styles.css", "dist/styles.css");
  },
});
