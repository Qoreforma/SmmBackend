import { Request, Response, NextFunction } from "express";

export const detectChannel = (req: Request, res: Response, next: NextFunction) => {
  const userAgent = req.headers["user-agent"] || "";
  const rawHeader =
    (req.headers["x-channel"] as string) ||
    (req.headers["channel"] as string) ||
    "";
  const rawBody =
    req.body && typeof req.body.channel === "string" ? req.body.channel : "";
  const candidate = (rawHeader || rawBody || "").toLowerCase().trim();

  let channel: "ios" | "android" | "web" | "api" = "web";
  if (candidate && ["ios", "android", "web", "api"].includes(candidate)) {
    channel = candidate as "ios" | "android" | "web" | "api";
  } else if (candidate === "mobile") {
    if (userAgent.includes("iPhone") || userAgent.includes("iPad")) {
      channel = "ios";
    } else {
      channel = "android";
    }
  } else if (userAgent.includes("iPhone") || userAgent.includes("iPad")) {
    channel = "ios";
  } else if (userAgent.includes("Android")) {
    channel = "android";
  }

  (req as any).channel = channel;

  next();
};