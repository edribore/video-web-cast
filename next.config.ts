import type { NextConfig } from "next";

function resolveAllowedDevOrigins() {
  const allowedOrigins = new Set<string>(["192.168.1.115"]);

  const addAllowedOrigin = (value: string | undefined) => {
    if (!value) {
      return;
    }

    for (const entry of value.split(",")) {
      const candidate = entry.trim();

      if (!candidate) {
        continue;
      }

      try {
        allowedOrigins.add(new URL(candidate).hostname);
      } catch {
        allowedOrigins.add(
          candidate.replace(/^https?:\/\//, "").split("/")[0].split(":")[0],
        );
      }
    }
  };

  addAllowedOrigin(process.env.PUBLIC_BASE_URL);
  addAllowedOrigin(process.env.NEXT_PUBLIC_PUBLIC_BASE_URL);
  addAllowedOrigin(process.env.CAST_BASE_URL);
  addAllowedOrigin(process.env.NEXT_PUBLIC_CAST_BASE_URL);
  addAllowedOrigin(process.env.PUBLIC_LAN_BASE_URL);
  addAllowedOrigin(process.env.NEXT_PUBLIC_PUBLIC_LAN_BASE_URL);
  addAllowedOrigin(process.env.LAN_PUBLIC_BASE_URL);
  addAllowedOrigin(process.env.DEV_ALLOWED_ORIGINS);

  return [...allowedOrigins];
}

const nextConfig: NextConfig = {
  allowedDevOrigins: resolveAllowedDevOrigins(),
  experimental: {
    serverActions: {
      bodySizeLimit: "250mb",
    },
  },
};

export default nextConfig;
