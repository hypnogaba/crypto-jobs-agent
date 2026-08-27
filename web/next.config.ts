import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Shared hosting reports 32 CPUs but the account's LVE resource
  // governor can't actually spawn that many build workers — cap parallelism
  // or `next build` fails with `spawn EAGAIN`.
  experimental: {
    cpus: 1,
    workerThreads: false,
  },
  output: "standalone",
  // Type checking is done locally (`tsc --noEmit`) and in the repo's own
  // history — skip it during the production build on this constrained host,
  // where it stalls under the LVE CPU governor rather than failing outright.
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
