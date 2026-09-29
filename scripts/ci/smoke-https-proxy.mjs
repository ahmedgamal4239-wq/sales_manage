import http from "node:http";
import https from "node:https";
import { readFileSync } from "node:fs";

const ports = {
  api: Number(process.env.SMOKE_API_PORT ?? 8080),
  web: Number(process.env.SMOKE_WEB_PORT ?? 4173),
  expo: Number(process.env.SMOKE_EXPO_PORT ?? 22356),
};
const proxyPort = Number(process.env.SMOKE_PROXY_PORT ?? 8443);
const keyPath = process.env.SMOKE_TLS_KEY;
const certPath = process.env.SMOKE_TLS_CERT;
if (!keyPath || !certPath) throw new Error("Set the temporary HTTPS certificate paths");

function serviceFor(pathname) {
  if (pathname === "/api" || pathname.startsWith("/api/")) return ports.api;
  if (
    pathname.startsWith("/sales-operations/") ||
    pathname.startsWith("/@vite/") ||
    pathname.startsWith("/@react-refresh")
  ) return ports.web;
  return ports.expo;
}

function proxyRequest(req, res) {
  const port = serviceFor(new URL(req.url ?? "/", "https://localhost").pathname);
  const upstream = http.request({
    hostname: "127.0.0.1",
    port,
    method: req.method,
    path: req.url,
    headers: {...req.headers, host: `127.0.0.1:${port}`, "x-forwarded-proto": "https"},
  }, response => {
    res.writeHead(response.statusCode ?? 502, response.headers);
    response.pipe(res);
  });
  upstream.on("error", () => {
    if (!res.headersSent) res.writeHead(502, {"content-type": "text/plain"});
    res.end("Smoke-test service unavailable");
  });
  req.pipe(upstream);
}

const server = https.createServer({
  key: readFileSync(keyPath),
  cert: readFileSync(certPath),
}, proxyRequest);

server.on("upgrade", (req, socket, head) => {
  const port = serviceFor(new URL(req.url ?? "/", "https://localhost").pathname);
  const upstream = http.request({
    hostname: "127.0.0.1",
    port,
    method: req.method,
    path: req.url,
    headers: {...req.headers, host: `127.0.0.1:${port}`, "x-forwarded-proto": "https"},
  });
  upstream.on("upgrade", (response, upstreamSocket, upstreamHead) => {
    const status = `HTTP/${response.httpVersion} ${response.statusCode} ${response.statusMessage}\r\n`;
    const headers = Object.entries(response.headers).flatMap(([name, value]) =>
      (Array.isArray(value) ? value : [value]).map(item => `${name}: ${item}\r\n`),
    ).join("");
    socket.write(`${status}${headers}\r\n`);
    if (upstreamHead.length) socket.write(upstreamHead);
    if (head.length) upstreamSocket.write(head);
    upstreamSocket.pipe(socket);
    socket.pipe(upstreamSocket);
  });
  upstream.on("response", response => {
    socket.write(`HTTP/${response.httpVersion} ${response.statusCode} ${response.statusMessage}\r\n\r\n`);
    response.pipe(socket);
  });
  upstream.on("error", () => socket.destroy());
  upstream.end();
});

server.listen(proxyPort, "127.0.0.1", () => {
  process.stdout.write(`Temporary HTTPS smoke proxy listening on ${proxyPort}.\n`);
});