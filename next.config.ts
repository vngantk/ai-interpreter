import { existsSync, readFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import type { NextConfig } from "next";

function localIpv4Addresses(): string[] {
  const addresses = new Set<string>();
  try {
    for (const entries of Object.values(networkInterfaces())) {
      for (const entry of entries ?? []) {
        if (entry.family === "IPv4" && !entry.internal) {
          addresses.add(entry.address);
        }
      }
    }
  } catch {
    // Sandboxed / restricted environments may not expose interfaces.
  }
  return [...addresses];
}

function hostsFromCertFile(): string[] {
  const hostsPath = join(process.cwd(), "certs", "dev-hosts.txt");
  if (!existsSync(hostsPath)) return [];
  return readFileSync(hostsPath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Next.js blocks cross-origin HMR (`/_next/webpack-hmr`) unless the page
 * origin hostname is allowlisted. LAN HTTPS access uses the machine IP, so
 * that IP must be listed here (CIDR / IP wildcards are not supported).
 */
const allowedDevOrigins = [
  ...new Set([
    ...hostsFromCertFile(),
    ...localIpv4Addresses(),
    "*.local",
  ]),
].filter((host) => host !== "localhost" && host !== "127.0.0.1" && host !== "::1");

const nextConfig: NextConfig = {
  allowedDevOrigins,
};

export default nextConfig;
