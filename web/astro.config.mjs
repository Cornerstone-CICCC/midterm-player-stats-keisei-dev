import { defineConfig } from "astro/config";
import node from "@astrojs/node";

// SSR so pages can fetch from the Express API at request time
// (server-side pagination, search, sort via query params).
export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  server: { port: 4321 },
});
