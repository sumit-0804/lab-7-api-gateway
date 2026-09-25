const mongoose = require('mongoose');

const RETRIES = Number(process.env.MONGO_CONNECT_RETRIES || 10);
const RETRY_DELAY_MS = Number(process.env.MONGO_CONNECT_RETRY_DELAY_MS || 3000);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function connectDB() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGO_URI is not set. Copy .env.example to .env and fill it in.');
    process.exit(1);
  }

  mongoose.connection.on('connected', () => console.log('order-db connected'));
  mongoose.connection.on('error', (err) => console.error('order-db error:', err.message));

  // The database container may still be starting when this service boots.
  for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
      return;
    } catch (err) {
      if (attempt === RETRIES) throw err;
      console.log(`order-db not reachable (attempt ${attempt}/${RETRIES}): ${err.message}`);
      await sleep(RETRY_DELAY_MS);
    }
  }
}

module.exports = connectDB;
