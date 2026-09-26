import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // react-markdown v9 and remark-gfm v4 are ESM-only.
  // serverExternalPackages tells Next.js NOT to bundle them
  // server-side — they are resolved natively by Node at runtime.
  serverExternalPackages: [
    "react-markdown",
    "remark-gfm",
    "unified",
    "remark-parse",
    "remark-rehype",
    "rehype-stringify",
    "vfile",
    "mdast-util-from-markdown",
    "mdast-util-to-markdown",
    "mdast-util-gfm",
    "micromark",
    "micromark-extension-gfm",
  ],

  // Increase Vercel serverless function timeout for the /api/proxy route.
  // Default is 10s — HuggingFace Space takes 20-30s to complete a full report.
  // Without this, the proxy silently drops the connection and the frontend
  // loops forever receiving {status:"processing"} with no output.
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
};

export default nextConfig;
