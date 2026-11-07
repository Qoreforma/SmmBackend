import mongoose, { Schema, Document, Types } from "mongoose";
import bcrypt from "bcryptjs";

export interface ITrustedDevice {
  deviceId: string;
  userAgent?: string;
  label?: string;
  knownIpRange?: string;
  createdAt: Date;
  lastUsedAt: Date;
}

export interface IAllowedIpRange {
  cidr: string;
  label?: string;
  addedBy?: Types.ObjectId;
  addedAt: Date;
}

export interface IAdmin extends Document {
  _id: Types.ObjectId;
  legacyAdminId?: string;
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  status: "active" | "pending_verification" | "suspended" | "deactivated";
  adminLevel: string;
  permissions: string[];
  twoFactorEnabled: boolean;
  activeTokenId?: string | null;
  department?: string;
  loginAttempts: number;
  lockUntil?: Date;
  lastLogin?: Date;
  passwordHistory: string[];
  phone?: string;
  profilePicture?: string;
  lastActiveAt?: Date;
  isSystemSecured?: boolean;
  totalLogins: number;
  trustedDevices: ITrustedDevice[];
  allowedIpRanges: IAllowedIpRange[];
  createdBy?: string;
  updatedBy?: string;
  createdAt: Date;
  updatedAt: Date;
  fullName: string;
  comparePassword(candidatePassword: string): Promise<boolean>;
  incrementLoginAttempts(): Promise<void>;
  resetLoginAttempts(): Promise<void>;
  checkAccountLock(): boolean;
  hasPermission(permission: string): boolean;
  updateLastActive(): Promise<void>;
  isLocked(): boolean;
}

const AdminSchema = new Schema<IAdmin>(
  {
    legacyAdminId: { type: String, index: true,sparse: true  }, // this is id of the admin migrated from other dbs
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      index: true,
    },
    password: { type: String, required: true },
    status: {
      type: String,
      enum: ["active", "pending_verification", "suspended", "deactivated"],
      default: "active",
      index: true,
    },
    adminLevel: { type: String, required: true, index: true },
    permissions: [{ type: String }],
    twoFactorEnabled: { type: Boolean, default: false },
    isSystemSecured: { type: Boolean, default: false },
    activeTokenId: { type: String },
    department: { type: String },
    loginAttempts: { type: Number, default: 0 },
    lockUntil: { type: Date },
    lastLogin: { type: Date },
    passwordHistory: [{ type: String }],
    phone: { type: String },
    profilePicture: { type: String },
    lastActiveAt: { type: Date },
    totalLogins: { type: Number, default: 0 },
    trustedDevices: [
      {
        deviceId: { type: String, required: true },
        userAgent: { type: String },
        label: { type: String },
        knownIpRange: { type: String },
        createdAt: { type: Date, default: Date.now },
        lastUsedAt: { type: Date, default: Date.now },
      },
    ],
    allowedIpRanges: [
      {
        cidr: { type: String, required: true },
        label: { type: String },
        addedBy: { type: Schema.Types.ObjectId, ref: "Admin" },
        addedAt: { type: Date, default: Date.now },
      },
    ],
    createdBy: { type: String },
    updatedBy: { type: String },
    createdAt: { type: Date, immutable: true },
  },
  {
    timestamps: true,
  },
);

// Virtual for full name
AdminSchema.virtual("fullName").get(function () {
  return `${this.firstName} ${this.lastName}`;
});

// Hash password before saving
AdminSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Compare password method
AdminSchema.methods.comparePassword = async function (
  candidatePassword: string,
): Promise<boolean> {
  const convertedHash = this.password.replace(/^\$2y\$/, "$2a$");

  return await bcrypt.compare(candidatePassword, convertedHash);
};

// Increment login attempts
AdminSchema.methods.incrementLoginAttempts = async function (): Promise<void> {
  if (this.lockUntil && this.lockUntil < new Date()) {
    await this.updateOne({
      $set: { loginAttempts: 1 },
      $unset: { lockUntil: 1 },
    });
  } else {
    const updates: any = { $inc: { loginAttempts: 1 } };
    if (this.loginAttempts + 1 >= 5 && !this.isLocked()) {
      updates.$set = { lockUntil: new Date(Date.now() + 2 * 60 * 60 * 1000) }; // 2 hours
    }
    await this.updateOne(updates);
  }
};

// Reset login attempts
AdminSchema.methods.resetLoginAttempts = async function (): Promise<void> {
  await this.updateOne({
    $set: { loginAttempts: 0 },
    $unset: { lockUntil: 1 },
  });
};

// Check if account is locked
AdminSchema.methods.checkAccountLock = function (): boolean {
  return !!(this.lockUntil && this.lockUntil > new Date());
};

// Check if admin has permission
AdminSchema.methods.hasPermission = function (permission: string): boolean {
  return (
    this.permissions.includes(permission) || this.permissions.includes("*")
  );
};

// Update last active
AdminSchema.methods.updateLastActive = async function (): Promise<void> {
  await this.updateOne({ $set: { lastActiveAt: new Date() } });
};

// Check if locked
AdminSchema.methods.isLocked = function (): boolean {
  return !!(this.lockUntil && this.lockUntil > new Date());
};

// Indexes
AdminSchema.index({ createdAt: -1 });

export const Admin = mongoose.model<IAdmin>("Admin", AdminSchema);
