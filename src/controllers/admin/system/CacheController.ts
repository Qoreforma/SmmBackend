import { Request, Response, NextFunction } from "express";
import { CacheService } from "@/services/core/CacheService";
import { HTTP_STATUS } from "@/utils/constants";
import { sendSuccessResponse, sendErrorResponse } from "@/utils/helpers";

export class CacheController {
  private cacheService: CacheService;

  constructor() {
    this.cacheService = new CacheService();
  }

  getCacheStats = async(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const stats = await this.cacheService.getStats();
      
      // Parse the Redis INFO string into an object
      const parsedStats = this.parseRedisInfo(stats);

      sendSuccessResponse(res, parsedStats, "Cache stats retrieved");
    } catch (error: any) {
      sendErrorResponse(res, error.message, HTTP_STATUS.INTERNAL_SERVER_ERROR);
    }
  }

  flushCache = async(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      await this.cacheService.clearAll();
      sendSuccessResponse(res, null, "All cache flushed successfully");
    } catch (error: any) {
      sendErrorResponse(res, error.message, HTTP_STATUS.INTERNAL_SERVER_ERROR);
    }
  }

  // Basic utility to parse Redis INFO string into a JSON object
  private parseRedisInfo(infoString: string | null) {
    if (!infoString) return {};
    
    const lines = infoString.split('\r\n');
    const result: any = {};
    let currentSection = 'general';

    lines.forEach(line => {
      line = line.trim();
      if (!line) return;

      if (line.startsWith('#')) {
        currentSection = line.substring(1).trim().toLowerCase();
        result[currentSection] = {};
        return;
      }

      const [key, value] = line.split(':');
      if (key && value !== undefined) {
        if (!result[currentSection]) {
          result[currentSection] = {};
        }
        result[currentSection][key] = value;
      }
    });

    return result;
  }
}
