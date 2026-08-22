import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Curated create can attach many photos (up to 5 MB each). Free plan allows
      // 10 curated picks; leave headroom for multipart overhead. Client also
      // compresses images before submit.
      bodySizeLimit: "55mb",
    },
  },
};

export default nextConfig;
