import { Router } from "express";
import { sendErrorResponse } from "@/utils/helpers";
import { HTTP_STATUS } from "@/utils/constants";
import { validateRequest } from "@/middlewares/shared/validation";
import { mediaSchemaValidation } from "@/validations/mediaValidation";
import { ImageKitService } from "@/services/core/ImagekitService";
import { CacheService } from "@/services/core/CacheService";

const router = Router();
const imagekitService = new ImageKitService();
const cacheService = new CacheService();

const ALLOWED_FOLDERS = [
  "vendor-logos",
  "featured-images",
  "portfolio-images",
  "portfolio-videos",
  "banners",
];

// Frontend doesn't send a user token on this flow, so we can't use
// `authenticate` without breaking uploads. This is a dedicated, isolated
// IP limiter just for this route — its own cache keys, not shared with
// login rate limiting — so it can't cause unrelated lockouts elsewhere.
const mediaSignatureRateLimit = async (req: any, res: any, next: any) => {
  try {
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const key = `media_sig_rl:${ip}`;
    const attempts = await cacheService.increment(key, 3600); // 1 hour window

    if (attempts > 30) {
      // ~30 signature requests/hour/IP — generous for real users
      // (a handful of uploads per session), tight for scripted abuse.
      return sendErrorResponse(
        res,
        "Too many requests. Please try again later.",
        HTTP_STATUS.TOO_MANY_REQUESTS
      );
    }
    next();
  } catch (error) {
    // Fail open — never block real uploads because Redis hiccuped
    next();
  }
};

router.use(mediaSignatureRateLimit);

router.get(
  "/signatureWithDetails",
  validateRequest(mediaSchemaValidation),
  async (req, res) => {
    try {
      const { folder, fileName } = req.body;

      if (!ALLOWED_FOLDERS.includes(folder)) {
        return sendErrorResponse(res, "Invalid folder", HTTP_STATUS.BAD_REQUEST);
      }

      const signature =
        await imagekitService.generateUploadSignatureWithDetails(
          folder as string,
          fileName as string
        );
      res.status(200).json(signature);
    } catch (error) {
      sendErrorResponse(
        res,
        "Failed to generate signature",
        HTTP_STATUS.INTERNAL_SERVER_ERROR
      );
    }
  }
);

router.get("/signature", async (req, res) => {
  try {
    const signature = await imagekitService.generateUploadSignature();
    res.status(200).json(signature);
  } catch (error) {
    sendErrorResponse(
      res,
      "Failed to generate signature",
      HTTP_STATUS.INTERNAL_SERVER_ERROR
    );
  }
});

export default router;