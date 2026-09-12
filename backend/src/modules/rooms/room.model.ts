import { Schema, model, type Document, type Types } from "mongoose";

export type RoomStatus = "available" | "maintenance";

export interface RoomDocument extends Document {
  name: string;
  capacity: number;
  facilities: string[];
  hourlyRate: number;
  status: RoomStatus;
  description: string;
  createdAt: Date;
  updatedAt: Date;
}

const roomSchema = new Schema<RoomDocument>(
  {
    name: { type: String, required: true, unique: true, trim: true, maxlength: 32 },
    capacity: { type: Number, required: true, min: 1, max: 40 },
    facilities: { type: [String], default: [] },
    hourlyRate: { type: Number, required: true, min: 0 },
    status: { type: String, enum: ["available", "maintenance"], default: "available" },
    description: { type: String, default: "", maxlength: 200 },
  },
  { timestamps: true },
);

export const RoomModel = model<RoomDocument>("Room", roomSchema);

export interface RoomView {
  id: string;
  name: string;
  capacity: number;
  facilities: string[];
  hourlyRate: number;
  status: RoomStatus;
  description: string;
}

export function toRoomView(room: RoomDocument & { _id: Types.ObjectId }): RoomView {
  return {
    id: room._id.toString(),
    name: room.name,
    capacity: room.capacity,
    facilities: room.facilities,
    hourlyRate: room.hourlyRate,
    status: room.status,
    description: room.description,
  };
}
