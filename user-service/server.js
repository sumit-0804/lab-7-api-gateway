// Lab 6 - User Service. Owns the User resource and its own database (user-db).
// No other service reads this database directly; they call these REST endpoints.

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const connectDB = require('./db');
const User = require('./models/User');

const app = express();
const PORT = Number(process.env.PORT || 3001);
const SERVICE = 'user-service';

app.use(cors());
app.use(express.json());

// Every request is logged so `docker compose logs` shows the calls arriving
// from Order Service as well as the ones from Postman.
app.use((req, res, next) => {
  res.on('finish', () => {
    console.log(`[${SERVICE}] ${req.method} ${req.originalUrl} -> ${res.statusCode}`);
  });
  next();
});

function validateUser(body, partial) {
  const errors = [];
  const has = (field) => body[field] !== undefined;

  if (!partial || has('name')) {
    if (typeof body.name !== 'string' || body.name.trim() === '') {
      errors.push('name is required and must be a non-empty string');
    }
  }
  if (!partial || has('email')) {
    if (typeof body.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
      errors.push('email is required and must be a valid email address');
    }
  }
  if (!partial || has('course')) {
    if (typeof body.course !== 'string' || body.course.trim() === '') {
      errors.push('course is required and must be a non-empty string');
    }
  }
  if (!partial || has('semester')) {
    if (!Number.isInteger(body.semester) || body.semester < 1 || body.semester > 8) {
      errors.push('semester is required and must be an integer between 1 and 8');
    }
  }

  return errors;
}

const badRequest = (res, details) =>
  res.status(400).json({ status: 400, service: SERVICE, error: 'Bad Request', message: 'Validation failed', details });

const notFound = (res, id) =>
  res.status(404).json({ status: 404, service: SERVICE, error: 'Not Found', message: `User with id ${id} does not exist` });

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);
const isDuplicateEmail = (err) => err && err.code === 11000;

// GET /health -> 200 when this service owns a working database connection.
app.get('/health', (req, res) => {
  const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  const db = states[mongoose.connection.readyState] || 'unknown';
  res.status(db === 'connected' ? 200 : 503).json({ status: 'ok', service: SERVICE, port: PORT, db });
});

app.get('/users', async (req, res, next) => {
  try {
    res.status(200).json(await User.find().sort({ _id: 1 }));
  } catch (err) {
    next(err);
  }
});

app.get('/users/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) return notFound(res, id);

    const user = await User.findById(id);
    if (!user) return notFound(res, id);

    res.status(200).json(user);
  } catch (err) {
    next(err);
  }
});

app.post('/users', async (req, res, next) => {
  try {
    const errors = validateUser(req.body, false);
    if (errors.length > 0) return badRequest(res, errors);

    const user = await User.create({
      name: req.body.name,
      email: req.body.email,
      course: req.body.course,
      semester: req.body.semester
    });

    res.status(201).location(`/users/${user.id}`).json(user);
  } catch (err) {
    if (isDuplicateEmail(err)) return badRequest(res, ['email is already registered to another user']);
    next(err);
  }
});

app.put('/users/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) return notFound(res, id);

    const errors = validateUser(req.body, false);
    if (errors.length > 0) return badRequest(res, errors);

    const user = await User.findById(id);
    if (!user) return notFound(res, id);

    user.name = req.body.name;
    user.email = req.body.email;
    user.course = req.body.course;
    user.semester = req.body.semester;
    await user.save();

    res.status(200).json(user);
  } catch (err) {
    if (isDuplicateEmail(err)) return badRequest(res, ['email is already registered to another user']);
    next(err);
  }
});

app.delete('/users/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) return notFound(res, id);

    const user = await User.findByIdAndDelete(id);
    if (!user) return notFound(res, id);

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
