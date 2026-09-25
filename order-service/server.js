// Lab 6 - Order Service. Owns the Order resource and its own database (order-db).
// It never reads user-db or product-db; referenced data is fetched over REST
// from User Service and Product Service using their Docker service names.

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const connectDB = require('./db');
const Order = require('./models/Order');
const { callService, DependencyUnavailableError, TIMEOUT_MS, RETRIES } = require('./serviceClient');

const app = express();
const PORT = Number(process.env.PORT || 3003);
const SERVICE = 'order-service';

// Service URLs come from the environment, never hard-coded.
const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://user-service:3001';
const PRODUCT_SERVICE_URL = process.env.PRODUCT_SERVICE_URL || 'http://product-service:3002';

app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  res.on('finish', () => {
    console.log(`[${SERVICE}] ${req.method} ${req.originalUrl} -> ${res.statusCode}`);
  });
  next();
});

const badRequest = (res, details) =>
  res.status(400).json({ status: 400, service: SERVICE, error: 'Bad Request', message: 'Validation failed', details });

const notFound = (res, message) =>
  res.status(404).json({ status: 404, service: SERVICE, error: 'Not Found', message });

// A dependency that never answered is reported as 503, naming the dependency
// and what was tried, so the cause is visible from the response alone.
const dependencyUnavailable = (res, err) =>
  res.status(503).json({
    status: 503,
    service: SERVICE,
    error: 'Service Unavailable',
    message: `Cannot process the request because ${err.service} did not respond`,
    dependency: err.service,
    url: err.url,
    reason: err.reason,
    timeoutMs: TIMEOUT_MS,
    attempts: RETRIES + 1
  });

function validateOrder(body) {
  const errors = [];
  if (typeof body.userId !== 'string' || body.userId.trim() === '') {
    errors.push('userId is required and must be a non-empty string');
  }
  if (typeof body.productId !== 'string' || body.productId.trim() === '') {
    errors.push('productId is required and must be a non-empty string');
  }
  if (!Number.isInteger(body.quantity) || body.quantity < 1) {
    errors.push('quantity is required and must be an integer >= 1');
  }
  return errors;
}

// GET /health -> this service and its own database only.
app.get('/health', (req, res) => {
  const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  const db = states[mongoose.connection.readyState] || 'unknown';
  res.status(db === 'connected' ? 200 : 503).json({
    status: 'ok',
    service: SERVICE,
    port: PORT,
    db,
    dependencies: { userService: USER_SERVICE_URL, productService: PRODUCT_SERVICE_URL }
  });
});

// GET /health/dependencies -> live reachability of User and Product Service.
// Useful evidence when a dependency container is stopped.
app.get('/health/dependencies', async (req, res) => {
  const checks = {};

  for (const [name, base] of [['user-service', USER_SERVICE_URL], ['product-service', PRODUCT_SERVICE_URL]]) {
    try {
      const result = await callService(name, `${base}/health`);
      checks[name] = { url: `${base}/health`, reachable: true, status: result.status };
    } catch (err) {
      checks[name] = { url: err.url, reachable: false, reason: err.reason };
    }
  }

  const allUp = Object.values(checks).every((c) => c.reachable && c.status === 200);
  res.status(allUp ? 200 : 503).json({ service: SERVICE, dependencies: checks });
});

// POST /orders -> validates the referenced user and product through REST calls.
app.post('/orders', async (req, res, next) => {
  try {
    const errors = validateOrder(req.body);
    if (errors.length > 0) return badRequest(res, errors);

    const { userId, productId, quantity } = req.body;

    // 1. Order -> User Service
    const userUrl = `${USER_SERVICE_URL}/users/${userId}`;
    const userResponse = await callService('user-service', userUrl);
    if (userResponse.status === 404) {
      return notFound(res, `User ${userId} does not exist (checked with user-service at ${userUrl})`);
    }
    if (userResponse.status !== 200) {
      return res.status(502).json({
        status: 502, service: SERVICE, error: 'Bad Gateway',
        message: `user-service answered ${userResponse.status} for ${userUrl}`
      });
    }

    // 2. Order -> Product Service
    const productUrl = `${PRODUCT_SERVICE_URL}/products/${productId}`;
    const productResponse = await callService('product-service', productUrl);
    if (productResponse.status === 404) {
      return notFound(res, `Product ${productId} does not exist (checked with product-service at ${productUrl})`);
    }
    if (productResponse.status !== 200) {
      return res.status(502).json({
        status: 502, service: SERVICE, error: 'Bad Gateway',
        message: `product-service answered ${productResponse.status} for ${productUrl}`
      });
    }

    const user = userResponse.body;
    const product = productResponse.body;

    // 3. Order -> Product Service: reserve stock through the API, not the database.
    const stockResponse = await callService('product-service', `${productUrl}/stock`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delta: -quantity })
    });
    if (stockResponse.status === 409) {
      return res.status(409).json({
        status: 409, service: SERVICE, error: 'Conflict',
        message: stockResponse.body?.message || `Insufficient stock for product ${productId}`
      });
    }
    if (stockResponse.status !== 200) {
      return res.status(502).json({
        status: 502, service: SERVICE, error: 'Bad Gateway',
        message: `product-service answered ${stockResponse.status} while reserving stock`
      });
    }

    const order = await Order.create({
      userId,
      productId,
      quantity,
      unitPrice: product.price,
      totalPrice: Number((product.price * quantity).toFixed(2)),
      status: 'CONFIRMED',
      userSnapshot: { name: user.name, email: user.email },
      productSnapshot: { name: product.name, sku: product.sku }
    });

    res.status(201).location(`/orders/${order.id}`).json(order);
  } catch (err) {
    if (err instanceof DependencyUnavailableError) return dependencyUnavailable(res, err);
    next(err);
  }
});

app.get('/orders', async (req, res, next) => {
  try {
    res.status(200).json(await Order.find().sort({ _id: 1 }));
  } catch (err) {
    next(err);
  }
});

// GET /orders/:id           -> the stored order
// GET /orders/:id?expand=true -> also fetches the live user and product records
app.get('/orders/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return notFound(res, `Order with id ${id} does not exist`);

    const order = await Order.findById(id);
    if (!order) return notFound(res, `Order with id ${id} does not exist`);

    if (req.query.expand !== 'true') return res.status(200).json(order);

    const userResponse = await callService('user-service', `${USER_SERVICE_URL}/users/${order.userId}`);
    const productResponse = await callService('product-service', `${PRODUCT_SERVICE_URL}/products/${order.productId}`);

    res.status(200).json({
      ...order.toJSON(),
      user: userResponse.status === 200 ? userResponse.body : { error: `user-service returned ${userResponse.status}` },
      product: productResponse.status === 200 ? productResponse.body : { error: `product-service returned ${productResponse.status}` }
    });
  } catch (err) {
    if (err instanceof DependencyUnavailableError) return dependencyUnavailable(res, err);
    next(err);
  }
});

app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400) {
    return res.status(400).json({ status: 400, service: SERVICE, error: 'Bad Request', message: 'Request body is not valid JSON' });
  }
  console.error(err);
  res.status(500).json({ status: 500, service: SERVICE, error: 'Internal Server Error', message: 'Unexpected server-side failure' });
});

app.use((req, res) => {
  res.status(404).json({ status: 404, service: SERVICE, error: 'Not Found', message: `No route for ${req.method} ${req.originalUrl}` });
});

connectDB()
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`${SERVICE} listening on port ${PORT}`);
      console.log(`USER_SERVICE_URL=${USER_SERVICE_URL}`);
      console.log(`PRODUCT_SERVICE_URL=${PRODUCT_SERVICE_URL}`);
    });
  })
  .catch((err) => {
    console.error(`${SERVICE} failed to connect to its database:`, err.message);
    process.exit(1);
  });
