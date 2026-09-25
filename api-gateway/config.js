// Service registry. The gateway learns where each service lives only from these
// environment variables; the route table below never contains a URL.

const ROUTES = [
  { prefix: '/users', service: 'user-service', urlVar: 'USER_SERVICE_URL' },
  { prefix: '/products', service: 'product-service', urlVar: 'PRODUCT_SERVICE_URL' },
  { prefix: '/orders', service: 'order-service', urlVar: 'ORDER_SERVICE_URL' }
];

function readUrl(env, name) {
  const value = (env[name] || '').trim();
  if (!value) throw new Error(`${name} is not set`);

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} is not a valid URL: ${value}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${name} must start with http:// or https://`);
  }
  if (url.pathname !== '/' || url.search) {
    throw new Error(`${name} must be a base URL without a path, e.g. http://user-service:3001`);
  }
  return url.origin;
}

function readPositiveInt(env, name, fallback) {
  if (env[name] === undefined || env[name] === '') return fallback;
  const value = Number(env[name]);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function loadConfig(env) {
  return {
    port: readPositiveInt(env, 'PORT', 8080),
    // Cloud free tiers can take ~50s to wake a sleeping service, so this is configurable.
    proxyTimeoutMs: readPositiveInt(env, 'PROXY_TIMEOUT_MS', 10000),
    routes: ROUTES.map((route) => ({ ...route, target: readUrl(env, route.urlVar) }))
  };
}

module.exports = { loadConfig };
