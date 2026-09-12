import type { NextFunction, Request, Response } from "express";

export class AppError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
  }
}

export const ERROR_MESSAGES = {
  overviewUnavailable: "Overview data is unavailable",
};

type AsyncHandler = (request: Request, response: Response, next: NextFunction) => Promise<unknown>;

export function asyncHandler(handler: AsyncHandler) {
  return (request: Request, response: Response, next: NextFunction) => {
    handler(request, response, next).catch(next);
  };
}

interface DuplicateKeyError extends Error {
  code?: number;
  keyValue?: Record<string, unknown>;
}

export function errorMiddleware(
  error: Error & { status?: number; type?: string },
  _request: Request,
  response: Response,
  _next: NextFunction,
) {
  if (error instanceof AppError) {
    response.status(error.statusCode).json({ message: error.message });
    return;
  }
  const duplicate = error as DuplicateKeyError;
  if (duplicate.code === 11000) {
    const field = Object.keys(duplicate.keyValue ?? {})[0] ?? "字段";
    const label = field === "phone" ? "手机号" : field;
    response.status(409).json({ message: `该${label}已被使用，请更换后重试` });
    return;
  }
  if (error.name === "ValidationError") {
    response.status(400).json({ message: `数据校验失败：${error.message}` });
    return;
  }
  if (error.name === "CastError") {
    response.status(400).json({ message: "请求中的 ID 格式无效" });
    return;
  }
  if (error instanceof SyntaxError && error.status === 400) {
    response.status(400).json({ message: "请求体不是有效的 JSON" });
    return;
  }
  if (/Transaction numbers are only allowed|not a replica set|replica set/i.test(error.message)) {
    response.status(503).json({ message: "数据库未以副本集模式运行，事务不可用，请检查数据库配置" });
    return;
  }
  response.status(500).json({ message: "服务器内部错误，请稍后重试" });
}
