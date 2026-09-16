import { Schema, model } from "mongoose";
import { isBannedSlug } from "../utils/bannedwords";
import argon2 from "argon2";

const noteSchema = new Schema(
  {
    id: { type: String, required: true, unique: true },
    password: { type: String, required: false },
    content: {
      type: String,
      // 1. Remove required: true entirely
      // 2. Add a custom validator to ensure it's a string, even if empty
      validate: {
        validator: (value: any) => typeof value === "string",
        message: "Content is required and must be a string",
      },
    },
  },
  { timestamps: true },
);

noteSchema.index({ id: 1 }, { unique: true });

noteSchema.pre("save", function () {
  // Fix math: 5MB in characters/bytes is exactly 5 * 1024 * 1024
  if (this.content && this.content.length > 5242880) {
    throw new Error("Note content exceeds the maximum allowed size of 5MB");
  }
  if (isBannedSlug(this.id)) {
    throw new Error("Note ID is banned");
  }
  if (this.password) {
    if (argon2.needsRehash(this.password)) {
      throw new Error("Password must be hashed using argon2");
    }
  }
});

const Note = model("Note", noteSchema);
export default Note;
