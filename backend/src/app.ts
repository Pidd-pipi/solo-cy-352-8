import cors from "cors";
import express from "express";
import helmet from "helmet";
import { requireDatabase } from "./common/db-guard";
import { errorMiddleware } from "./common/errors";
import { bookingRouter } from "./modules/bookings/booking.routes";
import { memberRouter } from "./modules/members/member.routes";
import { overviewRouter } from "./modules/overview/overview.routes";
import { roomRouter } from "./modules/rooms/room.routes";

export const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

app.get("/health", (_request, response) => response.json({ status: "ok" }));
app.get("/api/health", (_request, response) => response.json({ status: "ok" }));

const businessRouters = [roomRouter, memberRouter, bookingRouter];

app.use("/", overviewRouter);
app.use("/api", overviewRouter);
for (const router of businessRouters) {
  app.use("/", requireDatabase, router);
  app.use("/api", requireDatabase, router);
}

app.use((_request, response) => {
  response.status(404).json({ message: "接口不存在" });
});

app.use(errorMiddleware);
