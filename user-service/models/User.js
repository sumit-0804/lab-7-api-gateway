const mongoose = require('mongoose');

// Same fields as the Lab 5 Student document; the resource is named User here
// because Order Service refers to it as a user.
const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    course: { type: String, required: true, trim: true },
    semester: { type: Number, required: true, min: 1, max: 8 }
  },
  { versionKey: false }
);

userSchema.set('toJSON', {
  transform: (_doc, ret) => {
    ret.id = ret._id.toString();
    delete ret._id;
    return ret;
  }
});

module.exports = mongoose.model('User', userSchema);
