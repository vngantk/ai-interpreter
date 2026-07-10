#!/usr/bin/env node
/**
 * Generate a self-signed TLS cert for local + LAN HTTPS development.
 * Includes localhost and detected IPv4 addresses as Subject Alternative Names.
 */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import { networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const certDir = join(root, "certs");
const keyPath = join(certDir, "dev-key.pem");
const certPath = join(certDir, "dev-cert.pem");
const hostsPath = join(certDir, "dev-hosts.txt");

function localIpv4Addresses() {
  const addresses = new Set();
  try {
    for (const entries of Object.values(networkInterfaces())) {
      for (const entry of entries ?? []) {
        if (entry.family === "IPv4" && !entry.internal) {
          addresses.add(entry.address);
        }
      }
    }
  } catch (error) {
    console.warn(
      "Could not enumerate network interfaces; cert will cover localhost only.",
      error instanceof Error ? error.message : error,
    );
  }

  const fromEnv = process.env.HTTPS_EXTRA_HOSTS?.split(",")
    .map((host) => host.trim())
    .filter(Boolean);
  for (const host of fromEnv ?? []) {
    addresses.add(host);
  }

  return [...addresses].sort();
}

function desiredHosts() {
  return ["localhost", "127.0.0.1", "::1", ...localIpv4Addresses()];
}

function hostsMatch(currentHosts) {
  if (!existsSync(hostsPath) || !existsSync(keyPath) || !existsSync(certPath)) {
    return false;
  }
  const previous = readFileSync(hostsPath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .sort();
  return (
    previous.length === currentHosts.length &&
    previous.every((host, index) => host === currentHosts[index])
  );
}

function opensslAvailable() {
  try {
    execFileSync("openssl", ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function generate(hosts) {
  if (!opensslAvailable()) {
    throw new Error(
      "openssl is required to generate HTTPS certificates. Install OpenSSL or use a system that provides it.",
    );
  }

  mkdirSync(certDir, { recursive: true });

  const san = hosts
    .map((host) =>
      host.includes(":") || /^\d+\.\d+\.\d+\.\d+$/.test(host)
        ? `IP:${host}`
        : `DNS:${host}`,
    )
    .join(",");

  const configPath = join(certDir, "openssl.cnf");
  writeFileSync(
    configPath,
    `[req]
distinguished_name = req_distinguished_name
x509_extensions = v3_req
prompt = no

[req_distinguished_name]
CN = AI Interpreter Dev

[v3_req]
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = ${san}
`,
  );

  try {
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-nodes",
        "-newkey",
        "rsa:2048",
        "-keyout",
        keyPath,
        "-out",
        certPath,
        "-days",
        "825",
        "-config",
        configPath,
        "-extensions",
        "v3_req",
      ],
      { stdio: "inherit" },
    );
  } finally {
    try {
      unlinkSync(configPath);
    } catch {
      // ignore
    }
  }

  writeFileSync(hostsPath, `${hosts.join("\n")}\n`);
}

const hosts = desiredHosts().sort();
if (hostsMatch(hosts)) {
  console.log(`HTTPS certs already cover: ${hosts.join(", ")}`);
  process.exit(0);
}

console.log(`Generating HTTPS certs for: ${hosts.join(", ")}`);
generate(hosts);
console.log(`Wrote ${keyPath}`);
console.log(`Wrote ${certPath}`);
console.log(
  "Browsers will warn about the self-signed certificate; accept it once per device.",
);
