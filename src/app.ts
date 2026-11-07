import express, { Application } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import routes from "./routes";
import biometricsV2Routes from "./routes/client/biometricsV2";
import { AppError, errorHandler } from "./middlewares/shared/errorHandler";
import { devLogger } from "./middlewares/shared/requestLogger";
import mongoSanitize from "express-mongo-sanitize";
import hpp from "hpp";
import { ERROR_CODES, HTTP_STATUS } from "./utils/constants";
import Sentry from "./config/sentry";
import logger from "./logger";
import { probeBlocker } from "./middlewares/shared/probeBlocker";
import { globalIpRateLimiter } from "./middlewares/shared/rateLimiter";
import { detectChannel } from "./middlewares/client/detectChannel";

const app: Application = express();

const corsOptions: cors.CorsOptions = {
  origin: true, // Allow all origins globally
  credentials: true,
};

// Security middleware
app.use(helmet());
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.set("trust proxy", 1);

// Early probe blocker (blocks WordPress, PHP, dotfile scans before reading request body)
app.use(probeBlocker);

// Global rate limiting (blocks volumetric flood / brute-force scraping)
app.use(globalIpRateLimiter(300, 60));

// Body parsing middleware with explicit safety limits
app.use(
  express.json({
    limit: "1mb",
    verify: (req: any, res, buf, encoding) => {
      req.rawBody = buf.toString("utf8");
    },
  }),
);
app.use(
  express.urlencoded({
    extended: true,
    limit: "100kb",
    parameterLimit: 100,
  }),
);
app.use(cookieParser());
// Sanitize against NoSQL operator injection ($gt, $ne, $where, $regex keys, etc.)
// in body, query, and params. Must run after body parsing, before routes.
app.use(
  mongoSanitize({
    replaceWith: "_",
    onSanitize: ({ req, key }) => {
      // Optional but recommended: lets you see who's actually probing this
      console.warn(
        `[mongo-sanitize] stripped key "${key}" from ${req.method} ${req.originalUrl}`,
      );
    },
  }),
);

// Block HTTP Parameter Pollution (?role=user&role=admin style duplicate keys)
app.use(hpp());

// Detect client channel (iOS, Android, Web, API) from headers/body/UA
app.use(detectChannel);

if (process.env.NODE_ENV !== "production") {
  app.use(devLogger);
}

// Collapses any doubled-up slashes in the request path (but leaves the query
// string alone) so route matching remains consistent across external callbacks.
app.use((req, res, next) => {
  const qIndex = req.url.indexOf("?");
  const pathPart = qIndex === -1 ? req.url : req.url.slice(0, qIndex);
  const queryPart = qIndex === -1 ? "" : req.url.slice(qIndex);
  const collapsed = pathPart.replace(/\/{2,}/g, "/");
  if (collapsed !== pathPart) {
    req.url = collapsed + queryPart;
  }
  next();
});



// API routes
app.use("/api/v1", routes);
app.use("/api/v2/biometrics", biometricsV2Routes);

app.use((req, res, next) => {
  const error = new AppError(
    `Cannot ${req.method} ${req.path}`,
    HTTP_STATUS.NOT_FOUND,
    ERROR_CODES.NOT_FOUND,
  );
  next(error);
});

Sentry.setupExpressErrorHandler(app);

// Error handling middleware (must be last)
app.use(errorHandler);

export default app;
