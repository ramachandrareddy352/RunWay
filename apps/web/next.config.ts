import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript sources with NodeNext-style ".js" import specifiers.
  transpilePackages: ["@runway/sdk", "@runway/config", "@runway/fx"],
  webpack: (cfg) => {
    cfg.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] };
    return cfg;
  },
};

export default config;
