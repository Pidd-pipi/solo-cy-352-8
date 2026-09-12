/* 本地功能检查用：启动一个数据落盘的 MongoDB（固定 dbPath，重启后数据仍在）。
   生产环境仍使用 docker-compose 中的 mongo 服务，此脚本不参与部署。
   本机为 aarch64 Debian，MongoDB 官方未提供 debian12/arm 包，
   使用 ubuntu2204 构建（glibc 兼容）。 */
process.env.MONGOMS_DISTRO = process.env.MONGOMS_DISTRO || "ubuntu-22.04";
const { MongoMemoryServer } = require("mongodb-memory-server");

async function main() {
  const server = await MongoMemoryServer.create({
    binary: { version: "7.0.14" },
    instance: {
      port: 27017,
      dbName: "app",
      storageEngine: "wiredTiger",
      dbPath: "/workspace/.mongo-data",
    },
  });
  console.log(`MONGO_READY ${server.getUri()}`);
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
