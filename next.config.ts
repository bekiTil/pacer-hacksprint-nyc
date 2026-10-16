import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Node-only SDKs used by core/ (engine); don't bundle them into server routes.
  serverExternalPackages: ['@daytonaio/sdk', '@aws-sdk/client-bedrock'],
};

export default nextConfig;
