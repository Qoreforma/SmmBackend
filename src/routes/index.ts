import { Router } from "express";
import adminRoute from "./admin";
import clientRoute from "./client";

const router = Router();

router.use("/admin", adminRoute);
router.use("/", clientRoute);

router.get("/", (req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    service: `${process.env.APP_NAME} Api Running`,
  });
});

export default router;
