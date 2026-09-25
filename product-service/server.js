// Lab 6 - Product Service. Owns the Product resource and its own database (product-db).

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const connectDB = require('./db');
const Product = require('./models/Product');

const app = express();
const PORT = Number(process.env.PORT || 3002);
const SERVICE = 'product-service';

app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  res.on('finish', () => {
    console.log(`[${SERVICE}] ${req.method} ${req.originalUrl} -> ${res.statusCode}`);
  });
  next();
});

function validateProduct(body, partial) {
  const errors = [];
  const has = (field) => body[field] !== undefined;

  if (!partial || has('name')) {
    if (typeof body.name !== 'string' || body.name.trim() === '') {
      errors.push('name is required and must be a non-empty string');
    }
  }
  if (!partial || has('sku')) {
    if (typeof body.sku !== 'string' || !/^[A-Za-z0-9-]{3,20}$/.test(body.sku)) {
      errors.push('sku is required and must be 3-20 letters, digits or hyphens');
    }
  }
  if (!partial || has('price')) {
    if (typeof body.price !== 'number' || Number.isNaN(body.price) || body.price < 0) {
      errors.push('price is required and must be a number >= 0');
    }
  }
  if (!partial || has('stock')) {
    if (!Number.isInteger(body.stock) || body.stock < 0) {
      errors.push('stock is required and must be an integer >= 0');
    }
  }
  if (!partial || has('category')) {
    if (typeof body.category !== 'string' || body.category.trim() === '') {
      errors.push('category is required and must be a non-empty string');
    }
  }

  return errors;
}

const badRequest = (res, details) =>
  res.status(400).json({ status: 400, service: SERVICE, error: 'Bad Request', message: 'Validation failed', details });

const notFound = (res, id) =>
  res.status(404).json({ status: 404, service: SERVICE, error: 'Not Found', message: `Product with id ${id} does not exist` });

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);
const isDuplicateSku = (err) => err && err.code === 11000;

app.get('/health', (req, res) => {
  const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  const db = states[mongoose.connection.readyState] || 'unknown';
  res.status(db === 'connected' ? 200 : 503).json({ status: 'ok', service: SERVICE, port: PORT, db });
});

app.get('/products', async (req, res, next) => {
  try {
    res.status(200).json(await Product.find().sort({ _id: 1 }));
  } catch (err) {
    next(err);
  }
});

app.get('/products/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) return notFound(res, id);

    const product = await Product.findById(id);
    if (!product) return notFound(res, id);

    res.status(200).json(product);
  } catch (err) {
    next(err);
  }
});

app.post('/products', async (req, res, next) => {
  try {
    const errors = validateProduct(req.body, false);
    if (errors.length > 0) return badRequest(res, errors);

    const product = await Product.create({
      name: req.body.name,
      sku: req.body.sku,
      price: req.body.price,
      stock: req.body.stock,
      category: req.body.category
    });

    res.status(201).location(`/products/${product.id}`).json(product);
  } catch (err) {
    if (isDuplicateSku(err)) return badRequest(res, ['sku is already used by another product']);
    next(err);
  }
});

app.put('/products/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) return notFound(res, id);

    const errors = validateProduct(req.body, false);
    if (errors.length > 0) return badRequest(res, errors);

    const product = await Product.findById(id);
    if (!product) return notFound(res, id);

    product.name = req.body.name;
    product.sku = req.body.sku;
    product.price = req.body.price;
    product.stock = req.body.stock;
    product.category = req.body.category;
    await product.save();

    res.status(200).json(product);
  } catch (err) {
    if (isDuplicateSku(err)) return badRequest(res, ['sku is already used by another product']);
    next(err);
  }
});

// PATCH /products/:id/stock  { "delta": -2 }
// Called by Order Service to reserve stock. Kept as an API so Order Service
// never writes to product-db itself.
app.patch('/products/:id/stock', async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) return notFound(res, id);
    if (!Number.isInteger(req.body.delta)) return badRequest(res, ['delta is required and must be an integer']);

    const product = await Product.findById(id);
    if (!product) return notFound(res, id);

    const updated = product.stock + req.body.delta;
    if (updated < 0) {
      return res.status(409).json({
        status: 409,
        service: SERVICE,
        error: 'Conflict',
        message: `Insufficient stock for product ${id}: available ${product.stock}, requested ${-req.body.delta}`
      });
    }

    product.stock = updated;
    await product.save();

    res.status(200).json(product);
  } catch (err) {
    next(err);
  }
});

app.delete('/products/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) return notFound(res, id);

    const product = await Product.findByIdAndDelete(id);
    if (!product) return notFound(res, id);

    res.status(204).send();
  } catch (err) {
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
    app.listen(PORT, '0.0.0.0', () => console.log(`${SERVICE} listening on port ${PORT}`));
  })
  .catch((err) => {
    console.error(`${SERVICE} failed to connect to its database:`, err.message);
    process.exit(1);
  });
