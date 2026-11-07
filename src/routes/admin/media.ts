import logger from "@/logger";
import { adminAuth } from "@/middlewares/admin/adminAuth";
import { ImageKitService } from "@/services/core/ImagekitService";
import { HTTP_STATUS } from "@/utils/constants";
import { sendErrorResponse } from "@/utils/helpers";
import { Router } from "express";

const router = Router();
router.use(adminAuth);
const imagekitService = new ImageKitService();

router.get("/signature", async (req, res) => {
  try {
    const signature = await imagekitService.generateUploadSignature();
    res.status(200).json(signature);
  } catch (error: any) {
    sendErrorResponse(
      res,
      "Failed to generate signature",
      HTTP_STATUS.INTERNAL_SERVER_ERROR
    );
    logger.error("Error generating ImageKit signature:", {
      message: error.message || "Error generating ImageKit signature",
      adminId: (req as any).admin?._id || "unknown",
    });
  }
});

export default router;
