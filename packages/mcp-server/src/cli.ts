const isCloud = process.argv.includes("--cloud") || process.env.ENGRAMS_CLOUD === "1";

if (isCloud) {
  import("./cloud.js").then(({ startCloudServer }) => startCloudServer());
} else {
  import("./server.js").then(({ startServer }) => startServer());
}
