/* 本地功能检查用：启动一个数据落盘的 MongoDB（固定 dbPath，重启后数据仍在）。
   生产环境仍使用 docker-compose 中的 mongo 服务，此脚本不参与部署。
   本机为 aarch64 Debian，MongoDB 官方未提供 debian12/arm 包，
   使用 ubuntu2204 构建（glibc 兼容）。
   注意：mongodb-memory-server 不会自动创建 dbPath，目录不存在会
   报 ENOENT 启动失败，因此这里先递归创建。 */
process.env.MONGOMS_DISTRO = process.env.MONGOMS_DISTRO || "ubuntu-22.04";

const fs = require("fs");
const path = require("path");
const { MongoMemoryServer } = require("mongodb-memory-server");

const PORT = Number(process.env.MONGO_PORT || 27017);
const DB_PATH = process.env.MONGO_DB_PATH
  ? path.resolve(process.env.MONGO_DB_PATH)
  : path.resolve(__dirname, "../../.mongo-data");

async function main() {
  fs.mkdirSync(DB_PATH, { recursive: true });

  const server = await MongoMemoryServer.create({
    binary: { version: "7.0.14" },
    instance: {
      port: PORT,
      // 固定端口：端口被占用时直接报错，而不是静默改用随机端口（后端会连不上）
      portGeneration: false,
      dbName: "app",
      storageEngine: "wiredTiger",
      dbPath: DB_PATH,
    },
  });
  console.log(`MONGO_READY ${server.getUri()} (dbPath: ${DB_PATH})`);
  process.on("SIGTERM", async () => {
    await server.stop();
    process.exit(0);
  });
  process.on("SIGINT", async () => {
    await server.stop();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error("MONGO_FAILED", error);
  process.exit(1);
});
