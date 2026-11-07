import { Document, Schema } from "mongoose";
import { Request } from "express";
export interface AdminJWTPayload {
  id: string;
  adminId: string;
  email: string;
  adminLevel: string;
  permissions?: string[];
  department?: string;
  tokenId?: string;
  generation?: string | number;
  family?: string;
  deviceId?: string;
  iat?: number;
  exp?: number;
  iss?: string;
  aud?: string;
}

export interface CreateAdminRequest {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  adminLevel: string;
  permissions?: string[];
  department?: string;
  phone?: string;
  status?: "active" | "pending_verification" | "suspended" | "deactivated";
}

export interface UpdateAdminRequest {
  firstName?: string;
  lastName?: string;
  adminLevel?: string;
  permissions?: string[];
  department?: string;
  phone?: string;
  status?: "active" | "pending_verification" | "suspended" | "deactivated";
}

export interface IAdmin extends Document {
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
  totalLogins: number;
  createdBy?: string;
  updatedBy?: string;
  createdAt: Date;
  updatedAt: Date;

  // Virtual fields
  fullName: string;

  // Instance methods
  comparePassword(candidatePassword: string): Promise<boolean>;
  incrementLoginAttempts(): Promise<void>;
  resetLoginAttempts(): Promise<void>;
  checkAccountLock(): boolean;
  hasPermission(permission: string): boolean;
  updateLastActive(): Promise<void>;
  isLocked(): boolean;
}

// Static methods interface
export interface IAdminModel {
  findByEmail(email: string): Promise<IAdmin | null>;
  createAdmin(adminData: Partial<IAdmin>): Promise<IAdmin>;
}

// Pagination interface
export interface PaginationResult<T> {
  data: T[];
  pagination: {
    current: number;
    pages: number;
    total: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

// Admin statistics interface
export interface AdminStatistics {
  byLevel: Array<{
    _id: string;
    count: number;
    active: number;
    suspended: number;
    deactivated: number;
  }>;
  overall: {
    total: number;
    active: number;
    recentLogins: number;
  };
}
