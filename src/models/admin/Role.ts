import mongoose, { Schema, Document } from "mongoose";

export interface IRole extends Document {
    legacyRoleId?: string;
  name: string;
  slug: string;
  description?: string;
  permissions: string[];
  status: "active" | "inactive";
  createdAt: Date;
  updatedAt: Date;
}

const RoleSchema = new Schema<IRole>(
  {
     legacyRoleId: { type: String, index: true, sparse: true },
    name: { type: String, required: true },
    description: { type: String },
    permissions: [String],
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
      index: true,
    },
    createdAt: { type: Date, immutable: true },
  },
  {
    timestamps: true,
  }
);

export const Role = mongoose.model<IRole>("Role", RoleSchema);
