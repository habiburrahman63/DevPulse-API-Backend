import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 60 },
    // `unique` already creates the index; declaring it twice triggers a Mongoose warning.
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
  },
  { timestamps: true }
);

userSchema.methods.toPublic = function toPublic() {
  return { id: this.id, name: this.name, email: this.email, role: this.role, createdAt: this.createdAt };
};

export default mongoose.models.User || mongoose.model('User', userSchema);
