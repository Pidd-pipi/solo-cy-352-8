import mongoose from "mongoose";
import { env } from "./env";
import { logger } from "../common/logger";

export function buildMongoUri(): string {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }
  return `mongodb://${encodeURIComponent(env.dbUser)}:${encodeURIComponent(env.dbPassword)}@${env.dbHost}:${env.dbPort}/${env.dbName}?authSource=admin`;
}

export function isDatabaseReady(): boolean {
  return mongoose.connection.readyState === 1;
}

export async function connectDatabase(maxRetries = 10): Promise<boolean> {
  const uri = buildMongoUri();
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
      logger.info(`MongoDB connected: ${env.dbHost}:${env.dbPort}/${env.dbName}`);
      return true;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      logger.error(`MongoDB connect attempt ${attempt}/${maxRetries} failed: ${reason}`);
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
  }
  return false;
}
