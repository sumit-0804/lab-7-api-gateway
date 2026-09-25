const mongoose = require('mongoose');

// Only the ids of the referenced user and product are owned here. The readable
// fields are a snapshot taken at order time, so a later change in the other
// services does not rewrite history and no cross-database join is needed.
const orderSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true },
    productId: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    totalPrice: { type: Number, required: true, min: 0 },
    status: { type: String, required: true, default: 'CONFIRMED' },
    userSnapshot: {
      name: String,
      email: String
    },
    productSnapshot: {
      name: String,
      sku: String
    },
    createdAt: { type: Date, default: Date.now }
  },
  { versionKey: false }
);

orderSchema.set('toJSON', {
  transform: (_doc, ret) => {
    ret.id = ret._id.toString();
    delete ret._id;
    return ret;
  }
});

module.exports = mongoose.model('Order', orderSchema);
