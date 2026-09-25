// Lab 7 - API Gateway. The single public entry point: it routes /users, /products
// and /orders to the owning service and handles logging and errors. No business logic.

require('dotenv').config();

const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { loadConfig } = require('./config');

const SERVICE = 'api-gateway';

let config;
try {
  config = loadConfig(process.env);
} catch (err) {
  console.error(`${SERVICE} configuration error: ${err.message}`);
  process.exit(1);
}

const app = express();
app.disable('x-powered-by');

// One line per request: method, path, target service, status, time taken.
app.use((req, res, next) => {
  const started = Date.now();
  res.on('finish', () => {
    const target = res.locals.route ? `${res.locals.route.service} (${res.locals.route.target})` : SERVICE;
    console.log(`[${SERVICE}] ${req.method} ${req.originalUrl} -> ${target} ${res.statusCode} ${Date.now() - started}ms`);
  });
  next();
});

// Answered by the gateway itself, never proxied.
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: SERVICE,
    uptimeSeconds: Math.round(process.uptime()),
    routes: config.routes.map((r) => ({ prefix: r.prefix, service: r.service }))
  });
});

// Asks each registered service for its own /health, to check the registry points somewhere live.
app.get('/health/services', async (req, res) => {
  const services = await Promise.all(config.routes.map(async (route) => {
    try {
      const response = await fetch(`${route.target}/health`, { signal: AbortSignal.timeout(config.proxyTimeoutMs) });
      return { service: route.service, reachable: true, status: response.status, health: await response.json().catch(() => null) };
    } catch (err) {
      return { service: route.service, reachable: false, reason: err.cause?.code || err.name };
    }
  }));

  const allUp = services.every((s) => s.reachable && s.status === 200);
  res.status(allUp ? 200 : 503).json({ service: SERVICE, services });
});

// Codes meaning the service never answered at all: DNS failure, refused, timed out.
const UNREACHABLE_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'ETIMEDOUT', 'ECONNRESET']);

function proxyError(route) {
  return (err, req, res) => {
    const unreachable = UNREACHABLE_CODES.has(err.code);
    const status = unreachable ? 503 : 502;
    console.error(`[${SERVICE}] ${req.method} ${req.originalUrl} -> ${route.service} failed: ${err.code || err.message}`);

    // Not an HTTP response (e.g. a websocket upgrade) or already half-sent: just close it.
    if (typeof res.status !== 'function' || res.headersSent) return res.end();

    res.status(status).json({
      status,
      service: SERVICE,
      error: unreachable ? 'Service Unavailable' : 'Bad Gateway',
      message: unreachable
        ? `${route.service} is not reachable right now, please try again later`
        : `${route.service} returned an invalid response`,
      target: route.service,
      reason: err.code || 'PROXY_ERROR'
    });
  };
}

for (const route of config.routes) {
  const proxy = createProxyMiddleware({
    target: route.target,
    changeOrigin: true,
    xfwd: true,
    proxyTimeout: config.proxyTimeoutMs,
    on: { error: proxyError(route) }
  });

  // Match "/users" and "/users/..." but not "/usersX". The path is forwarded unchanged.
  app.use((req, res, next) => {
    if (req.path !== route.prefix && !req.path.startsWith(`${route.prefix}/`)) return next();
    res.locals.route = route;
    return proxy(req, res, next);
  });
}

app.use((req, res) => {
  res.status(404).json({ status: 404, service: SERVICE, error: 'Not Found', message: `No route for ${req.method} ${req.originalUrl}` });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ status: 500, service: SERVICE, error: 'Internal Server Error', message: 'Unexpected gateway failure' });
});

app.listen(config.port, '0.0.0.0', () => {
  console.log(`${SERVICE} listening on port ${config.port}`);
  for (const r of config.routes) console.log(`  ${r.prefix}/* -> ${r.service} at ${r.target} (from ${r.urlVar})`);
});
