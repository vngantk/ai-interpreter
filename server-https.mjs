#!/usr/bin/env node
/**
 * Production HTTPS server for AI Interpreter.
 * Uses certs/dev-*.pem by default, or HTTPS_KEY / HTTPS_CERT env paths.
 */
import { createServer } from "node:https";
import { readFileSync, existsSync } from "node:fs";
import { parse } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import next from "next";

const root = dirname(fileURLToPath(import.meta.url));
const keyPath = process.env.HTTPS_KEY ?? join(root, "certs", "dev-key.pem");
const certPath = process.env.HTTPS_CERT ?? join(root, "certs", "dev-cert.pem");
const port = Number(process.env.PORT ?? 3000);
const hostname = process.env.HOSTNAME ?? "0.0.0.0";

if (!existsSync(keyPath) || !existsSync(certPath)) {
  console.error(
    `Missing TLS files.\n  key:  ${keyPath}\n  cert: ${certPath}\nRun: npm run certs`,
  );
  process.exit(1);
}

const app = next({ dev: false, hostname, port });
const handle = app.getRequestHandler();

await app.prepare();

createServer(
  {
    key: readFileSync(keyPath),
    cert: readFileSync(certPath),
  },
  (req, res) => {
    const parsedUrl = parse(req.url ?? "/", true);
    handle(req, res, parsedUrl);
  },
).listen(port, hostname, () => {
  console.log(`AI Interpreter HTTPS ready on https://${hostname}:${port}`);
});
