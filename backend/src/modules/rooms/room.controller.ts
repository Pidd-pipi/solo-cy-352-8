import type { Request, Response } from "express";
import { asyncHandler } from "../../common/errors";
import { RoomModel, toRoomView } from "./room.model";

export const listRooms = asyncHandler(async (_request: Request, response: Response) => {
  const rooms = await RoomModel.find().sort({ name: 1 });
  response.json(rooms.map(toRoomView));
});
