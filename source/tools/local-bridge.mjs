#!/usr/bin/env node
import http from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateDeviceStatus } from "../src/core/device-schema.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};
const headers = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), serial=()",
};
export function isPrivateIPv4(ip) {
  if (typeof ip !== "string" || !/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(ip))
    return false;
  const p = ip.split(".").map(Number);
  return (
    p.every((n) => n <= 255) &&
    p[3] > 0 &&
    p[3] < 255 &&
    (p[0] === 10 || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168))
  );
}
function error(code) {
  return Object.assign(new Error(code), { code });
}
function exactObject(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).every((k) => keys.includes(k))
  );
}
function jsonBody(req) {
  return new Promise((resolve, reject) => {
    if (req.headers["content-type"]?.split(";")[0] !== "application/json") {
      reject(error("invalid_body"));
      req.resume();
      return;
    }
    let text = "";
    let done = false;
    const fail = () => {
      if (!done) {
        done = true;
        reject(error("invalid_body"));
      }
    };
    req.on("data", (chunk) => {
      if (done) return;
      text += chunk;
      if (Buffer.byteLength(text) > 1024) fail();
    });
    req.on("end", () => {
      if (done) return;
      done = true;
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(error("invalid_body"));
      }
    });
    req.on("error", fail);
    req.on("aborted", fail);
  });
}
/** Pure construction seam for HTTP integration tests. The CLI exposes no transport override. */
export function createLocalBridge({
  staticDir = resolve(root, "dist"),
  timeoutMs = 2000,
  request = http.request,
} = {}) {
  const csrfToken = randomBytes(32).toString("hex");
  let canonicalOrigin = "",
    expectedHost = "",
    connection = null,
    generation = 0,
    active = null,
    lastProgressAt = 0;
  const disconnect = () => {
    generation++;
    connection = null;
    active?.destroy(error("device_cancelled"));
    active = null;
  };
  const send = (res, status, body) => {
    if (!res.destroyed && !res.writableEnded) {
      res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers });
      res.end(JSON.stringify(body));
    }
  };
  function guard(req, mutation = false) {
    if (
      req.headers.host !== expectedHost ||
      Object.keys(req.headers).some((k) => k === "forwarded" || k.startsWith("x-forwarded-"))
    )
      return false;
    if (req.headers.origin !== undefined && req.headers.origin !== canonicalOrigin) return false;
    const site = req.headers["sec-fetch-site"];
    if (site !== undefined && site !== "same-origin" && site !== "none") return false;
    if (!mutation) return true;
    if (req.headers.origin !== canonicalOrigin || (site !== undefined && site !== "same-origin"))
      return false;
    const supplied = req.headers["x-roast-csrf"];
    return (
      typeof supplied === "string" &&
      /^[0-9a-f]{64}$/.test(supplied) &&
      timingSafeEqual(Buffer.from(supplied), Buffer.from(csrfToken))
    );
  }
  async function poll(ip, epoch) {
    if (active) throw error("device_busy");
    const started = performance.now();
    const result = await new Promise((resolve, reject) => {
      let completed = false,
        timer;
      const finish = (err, value) => {
        if (completed) return;
        completed = true;
        clearTimeout(timer);
        if (active === req) active = null;
        err ? reject(err) : resolve(value);
      };
      const req = request(
        {
          host: ip,
          port: 80,
          path: "/api/v1/status",
          method: "GET",
          headers: { Accept: "application/json", Connection: "close" },
          agent: false,
        },
        (res) => {
          if (res.statusCode !== 200) {
            finish(error("device_http_error"));
            req.destroy();
            return;
          }
          let text = "";
          res.on("data", (chunk) => {
            text += chunk;
            if (Buffer.byteLength(text) > 8192) {
              req.destroy();
              finish(error("device_response_too_large"));
            }
          });
          res.on("end", () => {
            try {
              finish(null, validateDeviceStatus(JSON.parse(text)));
            } catch {
              finish(error("device_schema_error"));
            }
          });
          res.on("error", () => finish(error("device_network_error")));
          res.on("aborted", () => finish(error("device_network_error")));
        },
      );
      active = req;
      req.on("error", (cause) =>
        finish(
          error(
            ["device_cancelled", "device_timeout"].includes(cause.code)
              ? cause.code
              : "device_network_error",
          ),
        ),
      );
      timer = setTimeout(() => req.destroy(error("device_timeout")), timeoutMs);
      req.end();
    });
    if (epoch !== generation) throw error("device_cancelled");
    const now = performance.now();
    if (connection) {
      if (result.session !== connection.status.session) throw error("device_reset");
      const delta = (result.uptime_ms - connection.status.uptime_ms) >>> 0;
      if (delta > 0x7fffffff) throw error("device_reset");
      if (delta === 0 && now - lastProgressAt > 3000) throw error("device_stale");
      if (delta > 0) lastProgressAt = now;
    } else lastProgressAt = now;
    connection = {
      ip,
      status: result,
      receivedAt: Date.now(),
      rttMs: Math.round(now - started),
      connected: true,
      readOnly: true,
    };
    return connection;
  }
  const server = http.createServer(async (req, res) => {
    if (!guard(req)) {
      send(res, 403, { error: "origin_rejected" });
      return;
    }
    const path = req.url ?? "";
    if (!["GET", "POST"].includes(req.method ?? "")) {
      send(res, 405, { error: "method_rejected" });
      return;
    }
    if (path === "/bridge/session" && req.method === "GET") {
      send(res, 200, { bridge: "roast-studio-local", version: 1, readOnly: true, csrfToken });
      return;
    }
    if (path.startsWith("/bridge/")) {
      if (
        !["/bridge/connect", "/bridge/poll", "/bridge/disconnect"].includes(path) ||
        req.method !== "POST"
      ) {
        send(res, 404, { error: "not_found" });
        return;
      }
      if (!guard(req, true)) {
        send(res, 403, { error: "origin_or_csrf_rejected" });
        return;
      }
      let body;
      try {
        body = await jsonBody(req);
      } catch {
        send(res, 400, { error: "invalid_body" });
        return;
      }
      if (!exactObject(body, path === "/bridge/connect" ? ["ip"] : [])) {
        send(res, 400, { error: "invalid_body" });
        return;
      }
      if (path === "/bridge/disconnect") {
        disconnect();
        send(res, 200, { connected: false, readOnly: true });
        return;
      }
      if (path === "/bridge/connect") {
        if (!isPrivateIPv4(body.ip)) {
          send(res, 400, { error: "invalid_private_ip" });
          return;
        }
        disconnect();
      } else if (!connection) {
        send(res, 409, { error: "not_connected" });
        return;
      }
      const ip = path === "/bridge/connect" ? body.ip : connection.ip,
        epoch = generation;
      try {
        send(res, 200, await poll(ip, epoch));
      } catch (cause) {
        if (epoch === generation && cause.code !== "device_busy") disconnect();
        send(res, cause.code === "device_busy" ? 409 : 502, {
          error: cause.code ?? "device_network_error",
          connected: false,
          readOnly: true,
        });
      }
      return;
    }
    if (
      req.method !== "GET" ||
      path.includes("?") ||
      path.includes("#") ||
      path.includes("%") ||
      path.includes("\\") ||
      path.split("/").some((v) => v === ".." || v === ".")
    ) {
      send(res, 404, { error: "not_found" });
      return;
    }
    const relative = path === "/" ? "index.html" : path.slice(1);
    if (!MIME[extname(relative)]) {
      send(res, 404, { error: "not_found" });
      return;
    }
    try {
      const base = await realpath(staticDir),
        file = await realpath(resolve(base, relative));
      if (!file.startsWith(base + sep) || (await stat(file)).size > 20 * 1024 * 1024) {
        send(res, 404, { error: "not_found" });
        return;
      }
      const content = await readFile(file);
      res.writeHead(200, { "Content-Type": MIME[extname(file)], ...headers });
      res.end(content);
    } catch {
      send(res, 404, { error: path === "/" ? "build_missing_run_npm_run_build" : "not_found" });
    }
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.maxHeadersCount = 32;
  return {
    get origin() {
      return canonicalOrigin;
    },
    async listen(port = 8787) {
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw error("invalid_port");
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => {
          server.removeListener("error", reject);
          resolve();
        });
      });
      const address = server.address();
      expectedHost = `127.0.0.1:${address.port}`;
      canonicalOrigin = `http://${expectedHost}`;
      return canonicalOrigin;
    },
    async close() {
      disconnect();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(() => resolve()));
    },
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  let port = 8787;
  if (args.length) {
    if (args.length !== 2 || args[0] !== "--port" || !/^\d+$/.test(args[1])) {
      console.error("Usage: node tools/local-bridge.mjs [--port 8787]");
      process.exitCode = 1;
    } else port = Number(args[1]);
  }
  if (!process.exitCode) {
    try {
      await stat(resolve(root, "dist/index.html"));
      if (port < 1024 || port > 65535) throw error("invalid_port");
      const bridge = createLocalBridge();
      await bridge.listen(port);
      console.log(
        `Coffee console (read only): ${bridge.origin}\nOpen this exact address. Stop with Ctrl+C. No credentials are required for read-only status.`,
      );
      for (const signal of ["SIGINT", "SIGTERM"])
        process.once(signal, () => {
          void bridge.close().then(() => process.exit(0));
        });
    } catch (cause) {
      console.error(
        cause.code === "ENOENT"
          ? "Built UI missing. Run npm install, then npm run build, then retry."
          : `Local bridge did not start (${cause.code ?? "startup_error"}).`,
      );
      process.exitCode = 1;
    }
  }
}
