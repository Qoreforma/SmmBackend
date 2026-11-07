import { Request, Response, NextFunction } from "express";
import * as Sentry from "@sentry/node";
import { sendErrorResponse } from "@/utils/helpers";
import { HTTP_STATUS, ERROR_CODES } from "@/utils/constants";

export class AppError extends Error {
  constructor(
    public message: string,
    public statusCode: number = HTTP_STATUS.INTERNAL_SERVER_ERROR,
    public errorCode: string = ERROR_CODES.INTERNAL_ERROR,
    public details?: any,
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

export const errorHandler = (
  err: Error | AppError,
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (err instanceof AppError) {
    // Only capture AppError if it's a 5xx status (server error)
    if (err.statusCode >= HTTP_STATUS.INTERNAL_SERVER_ERROR) {
      Sentry.captureException(err, {
        tags: {
          errorCode: err.errorCode,
          statusCode: err.statusCode.toString(),
        },
        contexts: {
          appError: {
            message: err.message,
            errorCode: err.errorCode,
            details: err.details,
          },
        },
      });
    }

    return sendErrorResponse(
      res,
      err.message,
      err.statusCode,
      err.errorCode,
      err.details,
    );
  }

  // BSON validation error
  if (err.name === "BSONError") {
    Sentry.captureException(err, {
      tags: {
        errorType: "BSONError",
        statusCode: HTTP_STATUS.BAD_REQUEST.toString(),
      },
      level: "warning",
    });

    return sendErrorResponse(
      res,
      "Invalid ID format",
      HTTP_STATUS.BAD_REQUEST,
      ERROR_CODES.BAD_REQUEST,
      err.message,
    );
  }

  // Mongoose validation error
  if (err.name === "ValidationError") {
    Sentry.captureException(err, {
      tags: {
        errorType: "ValidationError",
        statusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY.toString(),
      },
      level: "warning",
    });

    return sendErrorResponse(
      res,
      "Validation error",
      HTTP_STATUS.UNPROCESSABLE_ENTITY,
      ERROR_CODES.VALIDATION_ERROR,
      err.message,
    );
  }

  // Mongoose duplicate key error
  if (err.name === "MongoServerError" && (err as any).code === 11000) {
    Sentry.captureException(err, {
      tags: {
        errorType: "DuplicateKeyError",
        statusCode: HTTP_STATUS.CONFLICT.toString(),
      },
      level: "warning",
    });

    return sendErrorResponse(
      res,
      "Duplicate entry",
      HTTP_STATUS.CONFLICT,
      ERROR_CODES.DUPLICATE_ENTRY,
    );
  }

  // Mongoose version conflict error (optimistic concurrency)
  if (err.name === "VersionError") {
    Sentry.captureException(err, {
      tags: {
        errorType: "VersionError",
        statusCode: HTTP_STATUS.CONFLICT.toString(),
      },
      level: "warning",
    });

    return sendErrorResponse(
      res,
      "A concurrent update conflict occurred. Please try again.",
      HTTP_STATUS.CONFLICT,
      ERROR_CODES.CONFLICT,
      err.message,
    );
  }

  // JWT errors
  if (err.name === "JsonWebTokenError") {
    Sentry.captureException(err, {
      tags: {
        errorType: "JsonWebTokenError",
        statusCode: HTTP_STATUS.UNAUTHORIZED.toString(),
      },
      level: "warning",
    });

    return sendErrorResponse(
      res,
      "Invalid token",
      HTTP_STATUS.UNAUTHORIZED,
      ERROR_CODES.INVALID_TOKEN,
    );
  }

  if (err.name === "TokenExpiredError") {
    Sentry.captureException(err, {
      tags: {
        errorType: "TokenExpiredError",
        statusCode: HTTP_STATUS.UNAUTHORIZED.toString(),
      },
      level: "warning",
    });

    return sendErrorResponse(
      res,
      "Token expired",
      HTTP_STATUS.UNAUTHORIZED,
      ERROR_CODES.TOKEN_EXPIRED,
    );
  }

  // Handle client-side HTTP errors and body-parser exceptions (4xx)
  const clientStatus = (err as any).statusCode || (err as any).status;
  if (
    (typeof clientStatus === "number" && clientStatus >= 400 && clientStatus < 500) ||
    err.name === "PayloadTooLargeError"
  ) {
    const status = typeof clientStatus === "number" ? clientStatus : HTTP_STATUS.BAD_REQUEST;
    const isPayloadTooLarge =
      status === HTTP_STATUS.PAYLOAD_TOO_LARGE || err.name === "PayloadTooLargeError";
    const statusCode = isPayloadTooLarge ? HTTP_STATUS.PAYLOAD_TOO_LARGE : status;
    const errorCode = isPayloadTooLarge ? ERROR_CODES.PAYLOAD_TOO_LARGE : ERROR_CODES.BAD_REQUEST;

    return sendErrorResponse(
      res,
      err.message || (isPayloadTooLarge ? "Payload too large" : "Bad request"),
      statusCode,
      errorCode,
      (err as any).details,
    );
  }

  // Unhandled error - always capture
  console.error("Unhandled error:", err);
  Sentry.captureException(err, {
    tags: {
      errorType: err.name || "UnknownError",
      statusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR.toString(),
    },
    level: "error",
    contexts: {
      error: {
        message: err.message,
        stack: err.stack,
      },
    },
  });

  return sendErrorResponse(
    res,
    "Internal server error",
    HTTP_STATUS.INTERNAL_SERVER_ERROR,
    ERROR_CODES.INTERNAL_ERROR,
  );
};
