import type { NextFunction, Request, Response } from "express";
import { isDatabaseReady } from "../config/db";

/** 数据库未就绪时，业务接口返回 503 与明确原因（总览等静态接口不受影响） */
export function requireDatabase(_request: Request, response: Response, next: NextFunction) {
  if (!isDatabaseReady()) {
    response.status(503).json({ message: "数据库暂未连接，请稍后重试" });
    return;
  }
  next();
}
