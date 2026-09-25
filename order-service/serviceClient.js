// HTTP client used for every call to another service.
//
// Two failure kinds are kept apart on purpose:
//   - the dependency answered, but the resource is missing  -> 404 to the client
//   - the dependency could not be reached at all            -> 503 to the client
// Without this split, a stopped container would look like "user not found".

const TIMEOUT_MS = Number(process.env.DEPENDENCY_TIMEOUT_MS || 3000);
const RETRIES = Number(process.env.DEPENDENCY_RETRIES || 1);
const RETRY_DELAY_MS = Number(process.env.DEPENDENCY_RETRY_DELAY_MS || 300);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class DependencyUnavailableError extends Error {
  constructor(service, url, reason) {
    super(`${service} is unavailable (${reason})`);
    this.name = 'DependencyUnavailableError';
    this.service = service;
    this.url = url;
    this.reason = reason;
  }
}

// Returns { status, body }. Throws DependencyUnavailableError when the
// dependency never answered within the timeout and retry budget.
async function callService(service, url, options = {}) {
  let lastReason = 'unknown error';

  for (let attempt = 1; attempt <= RETRIES + 1; attempt += 1) {
    // Timeout: stop waiting instead of hanging on a dead container.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      const text = await response.text();
      let body = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = { raw: text };
      }

      console.log(`[order-service] -> ${options.method || 'GET'} ${url} : ${response.status}`);
      return { status: response.status, body };
    } catch (err) {
      lastReason = err.name === 'AbortError' ? `no response within ${TIMEOUT_MS}ms` : err.message;
      console.error(`[order-service] -> ${url} failed (attempt ${attempt}/${RETRIES + 1}): ${lastReason}`);
      // Retry: one limited repeat attempt covers a container that is restarting.
      if (attempt <= RETRIES) await sleep(RETRY_DELAY_MS);
    } finally {
      clearTimeout(timer);
    }
  }

  throw new DependencyUnavailableError(service, url, lastReason);
}

module.exports = { callService, DependencyUnavailableError, TIMEOUT_MS, RETRIES };
