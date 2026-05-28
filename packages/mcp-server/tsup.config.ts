import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { cli: "src/cli.ts" },
    format: ["esm"],
    clean: true,
    splitting: false,
    noExternal: ["@lodis/core"],
    banner: { js: "#!/usr/bin/env node" },
  },
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    dts: false,
    splitting: false,
    noExternal: ["@lodis/core"],
  },
  {
    entry: ["src/http.ts"],
    format: ["esm"],
    splitting: false,
    noExternal: ["@lodis/core"],
  },
  {
    entry: ["src/cloud.ts"],
    format: ["esm"],
    splitting: false,
    noExternal: ["@lodis/core"],
  },
  {
    entry: ["src/serverless.ts"],
    format: ["esm"],
    splitting: false,
    noExternal: ["@lodis/core"],
  },
]);
