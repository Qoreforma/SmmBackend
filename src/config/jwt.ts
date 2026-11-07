import { Sign } from "crypto";
import jwt, { SignOptions } from "jsonwebtoken";

export interface JWTPayload {
  id: string;
  email: string;
  role?: string;
  rememberMe?: boolean;
}

export const generateAccessToken = (payload: JWTPayload): string => {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is not defined");
  }

  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "24h",
  } as SignOptions);
};

export const generateRefreshToken = (payload: JWTPayload): string => {
  let expiresIn;

  if (!process.env.JWT_REFRESH_SECRET) {
    throw new Error("JWT_REFRESH_SECRET is not defined");
  }

  if (payload.rememberMe) {
    expiresIn = "30d";
  } else {
    expiresIn = process.env.JWT_REFRESH_EXPIRES_IN || "20d";
  }

  return jwt.sign(payload, process.env.JWT_REFRESH_SECRET, {
    expiresIn,
  } as SignOptions);
};

export const verifyAccessToken = (token: string): JWTPayload => {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is not defined");
  }

  return jwt.verify(token, process.env.JWT_SECRET) as JWTPayload;
};

export const verifyRefreshToken = (token: string): JWTPayload => {
  if (!process.env.JWT_REFRESH_SECRET) {
    throw new Error("JWT_REFRESH_SECRET is not defined");
  }

  return jwt.verify(token, process.env.JWT_REFRESH_SECRET) as JWTPayload;
};
