import mongoose, { Schema, Document, Types } from "mongoose";

export interface IFCMToken {
  token: string;
  deviceType: "ios" | "android";
  deviceId: string;
  lastUsedAt: Date;
}

// IBiometricToken — add frontendToken field
export interface IBiometricToken {
  tokenHash: string;
  frontendToken?: string; // stored plain for retrieval; tokenHash is still used for verification
  createdAt: Date;
}

export interface IUser extends Document {
  firstname: string;
  lastname: string;
  email: string;
  phoneCode?: string;
  phone?: string;
  username?: string;
  gender?: "male" | "female" | "other";
  refCode?: string;
  referredBy?: Types.ObjectId | undefined;
  avatar?: string | null;
  country?: string | null;
  state?: string;
  city?: string;
  address?: string;
  postalCode?: string;
  bvnVerified: boolean;
  bvnValidated: boolean;
  emailVerifiedAt?: Date;
  phoneVerifiedAt?: Date;
  lifecycleEmails?: {
    profileIncompleteSentAt?: Date;
    day3NoTxnSentAt?: Date;
    day7NoTxnSentAt?: Date;
    inactivitySent?: number[]; // thresholds already emailed, e.g. [30, 60]
  };
  pinActivatedAt?: Date;
  twoFactorEnabledAt?: Date;
  twofactorEnabled?: boolean;
  loginBiometricEnabled?: boolean;
  transactionBiometricEnabled?: boolean;
  biometricEnabled?: boolean;

  // New token arrays (multi-device, max 5)
  loginBiometricTokens?: IBiometricToken[];
  transactionBiometricTokens?: IBiometricToken[];

  twoFactorForcedBySystem?: boolean;

  password: string;
  status: "active" | "inactive" | "suspended" | "fraudulent" | "shadow-banned";
  fcmTokens: string[];
  authType: "password" | "biometric" | "social";
  userType: "regular" | "influencer" | "micro-influencer" | "vendor";
  refereeBonusClaimed?: boolean;
  refereeBonusClaimedAt?: Date;
  influencerRules?: {
    accountCompletion?: { isActive: boolean; rewardAmount: number };
    firstBillPayment?: { isActive: boolean; rewardAmount: number };
    transactionVolume?: { isActive: boolean; rewardAmount: number; targetVolume: number };
    kycCompletion?: { isActive: boolean; rewardAmount: number };
    refereeFirstTransaction?: {
      isActive: boolean;
      discountPercentage: number;
      cap: number;
    };
  };
  pin?: string;
  otp?: string;
  otpExpiry?: Date;
  virtualAccount?: any;
  dateOfBirth: Date;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
  legacyUserId?: string;
  partner?: IUserPartner;

  //system
  isSystemUser?: boolean;
  adminLevel?: string;



  // new fields
  bvn: string;
  nin: string;

  // Xixapay KYC linkage
  xixapayCustomerId?: string;
  xixapayKyc?: {
    address?: string;
    state?: string;
    city?: string;
    postalCode?: string;
    idCardUrl?: string;
    utilityBillUrl?: string;
    verifiedAt?: Date;
    status?: "pending" | "verified" | "failed";
  };
  pendingCashbackOffer?: {
    expiresAt: Date;
    status: "pending" | "used";
    percentage?: number;
    cap?: number;
    usedAt?: Date;
    usedOnTransactionId?: string;
    bonusAmountAwarded?: number;
  };
  appVersion?: string;
  preferredProvider?: string;
  tierCode?: string;
  isTierLocked?: boolean;
  lastStreakClaimAt?: Date;
  streakCount?: number;
}

export interface IUserResponse {
  id: string;
  firstname: string;
  lastname: string;
  email: string;
  phoneCode?: string | null;
  phone?: string | null;
  username?: string | null;
  gender?: "male" | "female" | "other" | null;
  refCode?: string | null;
  referredBy?: string | Types.ObjectId | null;
  avatar?: string | null;
  country?: string | null;
  state?: string | null;
  city?: string | null;
  address?: string | null;
  postalCode?: string | null;
  legacyUserId?: string;
  partner?: IUserPartner | null;

  status?:
  | "active"
  | "inactive"
  | "suspended"
  | "fraudulent"
  | "shadow-banned"
  | null;
  authType?: "password" | "biometric" | "social" | null;
  twofactorEnabled?: boolean;

  userType?: "regular" | "influencer" | "micro-influencer" | "vendor";
  influencerRules?: {
    accountCompletion?: { isActive: boolean; rewardAmount: number };
    firstBillPayment?: { isActive: boolean; rewardAmount: number };
    transactionVolume?: { isActive: boolean; rewardAmount: number; targetVolume: number };
    kycCompletion?: { isActive: boolean; rewardAmount: number };
  };

  // Replace the two array fields added earlier
  loginBiometricToken?: string | null;
  transactionBiometricToken?: string | null;

  bvnVerified?: boolean;
  bvnValidated?: boolean;

  emailVerifiedAt?: Date | null;
  phoneVerifiedAt?: Date | null;
  pinActivatedAt?: Date | null;
  twoFactorEnabledAt?: Date | null;
  dateOfBirth?: Date | null;
  loginBiometricEnabled?: boolean;
  transactionBiometricEnabled?: boolean;
  biometricEnabled?: boolean;

  twoFactorForcedBySystem?: boolean;

  fcmTokens: string[];
  virtualAccount?: any | null;
  createdAt?: Date | null;
  updatedAt?: Date | null;
  deletedAt?: Date | null;
  lastLoginAt?: Date;

  // new fields
  bvn?: string | null;
  nin?: string | null;
  appVersion?: string | null;
  preferredProvider?: string | null;
}

export interface IUserPartner {
  isPartner: boolean;
  status: "pending" | "active" | "suspended";
  companyName: string;
  contactPerson: string;
  webhookUrl: string | null;
  webhookSecret: string;
  createdAt: Date;
}

const PartnerSchema = new Schema<IUserPartner>({
  isPartner: { type: Boolean, default: false, index: true },
  status: {
    type: String,
    enum: ["pending", "active", "suspended"],
    default: "pending",
  },
  companyName: { type: String },
  contactPerson: { type: String },
  webhookUrl: { type: String },
  webhookSecret: { type: String },
  createdAt: { type: Date },
});

const BiometricTokenSchema = new Schema<IBiometricToken>(
  {
    tokenHash: { type: String, required: true },
    frontendToken: { type: String }, // add this line
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const UserSchema = new Schema<IUser>(
  {
    firstname: { type: String, required: true },
    lastname: { type: String },
    email: {
      type: String,
      required: true,
      lowercase: true,
      index: true,
    },
    phoneCode: { type: String },
    phone: { type: String, sparse: true, index: true },
    username: { type: String, unique: true, sparse: true, index: true, lowercase: true },
    gender: { type: String, enum: ["male", "female", "other"] },
    refCode: { type: String, unique: true, sparse: true, index: true },
    referredBy: { type: Schema.Types.ObjectId, ref: "User" },
    avatar: { type: String },
    country: { type: String },
    state: { type: String },
    city: { type: String },
    address: { type: String },
    postalCode: { type: String },

    bvnVerified: { type: Boolean, default: false },
    bvnValidated: { type: Boolean, default: false },

    userType: {
      type: String,
      enum: ["regular", "influencer", "micro-influencer", "vendor"],
      default: "regular",
    },
    refereeBonusClaimed: { type: Boolean, default: false, index: true },
    refereeBonusClaimedAt: { type: Date },
    influencerRules: {
      accountCompletion: {
        isActive: { type: Boolean, default: false },
        rewardAmount: { type: Number },
      },
      firstBillPayment: {
        isActive: { type: Boolean, default: false },
        rewardAmount: { type: Number },
      },
      transactionVolume: {
        isActive: { type: Boolean, default: false },
        rewardAmount: { type: Number },
        targetVolume: { type: Number },
      },
      kycCompletion: {
        isActive: { type: Boolean, default: false },
        rewardAmount: { type: Number },
      },
      refereeFirstTransaction: {
        isActive: { type: Boolean, default: false },
        discountPercentage: { type: Number, default: 10 },
        cap: { type: Number, default: 200 },
      },
    },
    emailVerifiedAt: { type: Date },
    phoneVerifiedAt: { type: Date },
    lifecycleEmails: {
      profileIncompleteSentAt: { type: Date },
      day3NoTxnSentAt: { type: Date },
      day7NoTxnSentAt: { type: Date },
      inactivitySent: { type: [Number], default: [] },
    },
    pinActivatedAt: { type: Date },
    twoFactorEnabledAt: { type: Date },
    twoFactorForcedBySystem: { type: Boolean, default: false },
    dateOfBirth: { type: Date },
    twofactorEnabled: { type: Boolean, default: false },

    loginBiometricEnabled: { type: Boolean, default: false },
    transactionBiometricEnabled: { type: Boolean, default: false },
    biometricEnabled: { type: Boolean, default: false },

    // New token arrays (max 5 devices each)
    loginBiometricTokens: {
      type: [BiometricTokenSchema],
      default: [],
    },
    transactionBiometricTokens: {
      type: [BiometricTokenSchema],
      default: [],
    },

    password: { type: String, required: true },
    status: {
      type: String,
      enum: ["active", "inactive", "suspended", "fraudulent", "shadow-banned"],
      default: "active",
    },
    fcmTokens: {
      type: [String],
      default: [],
    },
    authType: {
      type: String,
      enum: ["password", "biometric", "social"],
      default: "password",
    },
    legacyUserId: { type: String, index: true, sparse: true },
    pin: { type: String },
    otp: { type: String },
    otpExpiry: { type: Date },
    virtualAccount: { type: Schema.Types.Mixed },
    deletedAt: { type: Date },
    lastLoginAt: { type: Date },
    appVersion: { type: String, sparse: true, index: true },

    isSystemUser: { type: Boolean, default: false, index: true },

    bvn: { type: String },
    nin: { type: String },
    xixapayCustomerId: { type: String, sparse: true, index: true },
    xixapayKyc: {
      address: { type: String },
      state: { type: String },
      city: { type: String },
      postalCode: { type: String },
      idCardUrl: { type: String },
      utilityBillUrl: { type: String },
      verifiedAt: { type: Date },
      status: {
        type: String,
        enum: ["pending", "verified", "failed"],
      },
    },
    preferredProvider: { type: String, sparse: true, index: true },
    tierCode: { type: String, default: "regular", index: true },
    isTierLocked: { type: Boolean, default: false },
    lastStreakClaimAt: { type: Date },
    streakCount: { type: Number, default: 0 },

    createdAt: { type: Date, immutable: true },

    pendingCashbackOffer: {
      expiresAt: { type: Date },
      status: { type: String, enum: ["pending", "used"] },
      percentage: { type: Number, default: 5 },
      cap: { type: Number, default: 200 },
      usedAt: { type: Date },
      usedOnTransactionId: { type: String },
      bonusAmountAwarded: { type: Number },
    },
  },
  {
    timestamps: true,
  },
);

UserSchema.add({
  partner: PartnerSchema,
});

UserSchema.pre("save", async function (next) {
  next();
});

UserSchema.pre("findOneAndUpdate", async function (next) {
  next();
});

// Indexes
UserSchema.index({ status: 1 });
UserSchema.index({ createdAt: -1 });


export const User = mongoose.model<IUser>("User", UserSchema);
