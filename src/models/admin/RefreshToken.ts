import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IRefreshToken extends Document {
    tokenId: string;
    userId: mongoose.Types.ObjectId;
    userType: 'user' | 'vendor' | 'admin';
    token: string;
    deviceInfo?: string;
    ipAddress?: string;
    userAgent?: string;
    isActive: boolean;
    expiresAt: Date;
    lastUsed?: Date;
    createdAt: Date;
    updatedAt: Date;

    deactivate(): Promise<IRefreshToken>;
}

const refreshTokenSchema = new Schema<IRefreshToken>({
    tokenId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    userId: {
        type: Schema.Types.ObjectId,
        required: true,
        index: true
    },
    userType: {
        type: String,
        required: true,
        enum: ['user', 'vendor', 'admin']
    },
    token: {
        type: String,
        required: true,
        select: false // Don't include in queries by default
    },
    deviceInfo: {
        type: String,
        default: null
    },
    ipAddress: {
        type: String,
        default: null
    },
    userAgent: {
        type: String,
        default: null
    },
    isActive: {
        type: Boolean,
        default: true,
        index: true
    },
    expiresAt: {
        type: Date,
        required: true,
        index: { expireAfterSeconds: 0 } // MongoDB TTL index
    },
    lastUsed: {
        type: Date,
        default: null
    }
}, {
    timestamps: true,
    collection: 'refresh_tokens'
});

// Compound indexes for better query performance
refreshTokenSchema.index({ userId: 1, isActive: 1 });
refreshTokenSchema.index({ userId: 1, userType: 1, isActive: 1 });
refreshTokenSchema.index({ tokenId: 1, isActive: 1 });

// Method to deactivate token
refreshTokenSchema.methods.deactivate = async function (this: IRefreshToken): Promise<void> {
    this.isActive = false;
    await this.save();
};

// Method to update last used
refreshTokenSchema.methods.updateLastUsed = async function (this: IRefreshToken): Promise<void> {
    this.lastUsed = new Date();
    await this.save();
};

// Static method to find active token
refreshTokenSchema.statics.findActiveToken = function (tokenId: string) {
    return this.findOne({ tokenId, isActive: true, expiresAt: { $gt: new Date() } });
};

// Static method to deactivate all user tokens
refreshTokenSchema.statics.deactivateAllUserTokens = async function (userId: string, userType: string) {
    return this.updateMany(
        { userId, userType, isActive: true },
        { $set: { isActive: false } }
    );
};

// Static method to clean expired tokens
refreshTokenSchema.statics.cleanExpiredTokens = async function () {
    return this.deleteMany({
        $or: [
            { expiresAt: { $lt: new Date() } },
            { isActive: false, updatedAt: { $lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } } // 7 days old inactive tokens
        ]
    });
};

// Static method to get user active sessions
refreshTokenSchema.statics.getUserActiveSessions = function (userId: string, userType: string) {
    return this.find({
        userId,
        userType,
        isActive: true,
        expiresAt: { $gt: new Date() }
    }).select('tokenId deviceInfo ipAddress lastUsed createdAt');
};

// Transform JSON output
// refreshTokenSchema.set('toJSON', {
//     transform: function (doc, ret) {
//         delete ret.token;
//         delete ret.__v;
//         ret.id = ret._id;
//         delete ret._id;
//         return ret;
//     }
// });

// Pre-save middleware to set expiry if not set
refreshTokenSchema.pre('save', function (this: IRefreshToken, next) {
    if (this.isNew && !this.expiresAt) {
        const expiryDays = parseInt(process.env.JWT_REFRESH_EXPIRES_IN?.replace('d', '') || '30');
        this.expiresAt = new Date(Date.now() + (expiryDays * 24 * 60 * 60 * 1000));
    }
    next();
});

export interface IRefreshTokenModel extends Model<IRefreshToken> {
    deactivateAllUserTokens(userId: string, userType: string): Promise<any>;
    findActiveToken(tokenId: string): Promise<IRefreshToken | null>;
    cleanExpiredTokens(): Promise<any>;
    getUserActiveSessions(userId: string, userType: string): Promise<IRefreshToken[]>;
    deactivate(tokenId: string): Promise<void>;
    updateLastUsed(tokenId: string): Promise<void>;
}

export const RefreshToken = mongoose.model<IRefreshToken, IRefreshTokenModel>('RefreshToken', refreshTokenSchema);
export default RefreshToken;