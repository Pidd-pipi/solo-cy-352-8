import { app } from "./app";
import { connectDatabase } from "./config/db";
import { env } from "./config/env";
import { seedDatabase } from "./config/seed";
import { logger } from "./common/logger";

async function bootstrap() {
  app.listen(env.port, "0.0.0.0", () => {
    logger.info(`API listening on port ${env.port}`);
  });

  const connected = await connectDatabase();
  if (connected) {
    try {
      await seedDatabase();
    } catch (error) {
      logger.error(`Seed failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    logger.error("MongoDB unavailable: 包厢/会员接口将返回 503，总览接口不受影响");
  }
}

void bootstrap();
