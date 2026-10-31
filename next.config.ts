import type { NextConfig } from "next";

const nextConfig: NextConfig = process.env.TEEKO_NODE_RUNTIME === "1"
  ? { distDir: ".next-node", typescript: { tsconfigPath: "tsconfig.node.json" } }
  : {};

export default nextConfig;
