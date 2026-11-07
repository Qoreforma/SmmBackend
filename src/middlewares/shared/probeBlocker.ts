import { Request, Response, NextFunction } from "express";
import logger from "@/logger";

// Pre-compiled regex patterns for common bot/scanner probes
const BLOCKED_PATH_PATTERNS: RegExp[] = [
  // PHP endpoints and common CMS/WordPress paths
  /\.php($|\?)/i,
  /^\/wp-(admin|content|includes|login|json)/i,
  /^\/(xmlrpc|phpmyadmin|pma|adminer|myadmin)/i,

  // Framework & server probes
  /^\/(actuator|cgi-bin|solr|telescope|telescope-api)/i,

  // Sensitive dotfiles and environment configurations
  /^\/\.(env|git|svn|htaccess|htpasswd|aws|ssh|config)/i,

  // Legacy scripts and probes
  /\.(aspx?|jsp|action|do)($|\?)/i,
];

// Dangerous or scanner HTTP methods
const BLOCKED_HTTP_METHODS = new Set(["TRACE", "TRACK"]);

/**
 * Early Probe Blocker Middleware
 * 
 * Must run BEFORE body-parser (express.json / express.urlencoded).
 * Immediately terminates requests from automated scanners and exploit bots targeting
 * WordPress, PHP scripts, or sensitive dotfiles, without reading or buffering request bodies.
 */
export const probeBlocker = (req: Request, res: Response, next: NextFunction): void => {
  // Block unsupported/dangerous HTTP methods (Cross-Site Tracing)
  if (BLOCKED_HTTP_METHODS.has(req.method.toUpperCase())) {
    res.status(405).json({
      success: false,
      message: "Method Not Allowed",
    });
    return;
  }

  const rawPath = req.path || req.url || "";

  for (const pattern of BLOCKED_PATH_PATTERNS) {
    if (pattern.test(rawPath)) {
      const clientIp = req.ip || req.socket.remoteAddress || "unknown";
      logger.warn(`[PROBE_BLOCKED] Rejected bot probe: ${req.method} ${rawPath} from IP: ${clientIp}`);

      // Fast exit without body parsing or Sentry alerting
      res.status(404).json({
        success: false,
        message: "Resource not found",
      });
      return;
    }
  }

  next();
};
