import path from "node:path";
import type { NextConfig } from "next";

// The frontend imports shared code (hash helpers, generated ABIs, capability
// schemas) from ../agent-runtime/src/shared via the @shared alias. Turbopack
// only resolves files inside its root, so the root is the repo, one level up.
const repoRoot = path.join(__dirname, "..");

const nextConfig: NextConfig = {
  turbopack: {
    root: repoRoot,
  },
  outputFileTracingRoot: repoRoot,
};

export default nextConfig;
