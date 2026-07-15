import { defineConfig } from "astro/config";
import node from "@astrojs/node";

// SSR so pages can fetch fresh data from the Express API per request.
export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  server: { port: 4321 },
});
