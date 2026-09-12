import { Router } from "express";
import { listRooms } from "./room.controller";

export const roomRouter = Router();

roomRouter.get("/rooms", listRooms);
