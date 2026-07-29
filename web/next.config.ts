import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Shared hosting (hypnosit) reports 32 CPUs but the account's LVE resource
  // governor can't actually spawn that many build workers — cap parallelism
  // or `next build` fails with `spawn EAGAIN`.
  experimental: {
    cpus: 1,
    workerThreads: false,
  },
  output: "standalone",
};

export default nextConfig;
