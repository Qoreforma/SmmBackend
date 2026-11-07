import { Socket } from "socket.io";
import jwt from "jsonwebtoken";
import { CacheService } from "@/services/core/CacheService";
import { CACHE_KEYS } from "@/utils/constants";
import logger from "@/logger";

const cacheService = new CacheService();

export interface AuthedSocket extends Socket {
  userId?: string;
}

export const socketAuth = async (
  socket: AuthedSocket,
  next: (err?: Error) => void,
) => {
  try {
    const token =
      socket.handshake.auth?.token ||
      (socket.handshake.headers.authorization?.startsWith("Bearer ")
        ? socket.handshake.headers.authorization.substring(7)
        : undefined);

    if (!token) return next(new Error("No token provided"));
    if (!process.env.JWT_SECRET) return next(new Error("Server misconfigured"));

    const isBlacklisted = await cacheService.exists(
      CACHE_KEYS.TOKEN_BLACKLIST(token),
    );
    if (isBlacklisted) return next(new Error("Token has been revoked"));

    const decoded = jwt.verify(token, process.env.JWT_SECRET) as any;
    socket.userId = decoded.id;
    next();
  } catch (err) {
    logger.warn("Socket auth failed", err);
    next(new Error("Authentication failed"));
  }
};
