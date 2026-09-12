import { Schema, model, type Document, type Types } from "mongoose";

export type BookingStatus = "booked" | "cancelled";

export interface BookingDocument extends Document {
  room: Types.ObjectId;
  member: Types.ObjectId;
  startTime: Date;
  endTime: Date;
  hours: number;
  unitPrice: number;
  discount: number;
  totalAmount: number;
  pointsEarned: number;
  status: BookingStatus;
  cancelledAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const bookingSchema = new Schema<BookingDocument>(
  {
    room: { type: Schema.Types.ObjectId, ref: "Room", required: true, index: true },
    member: { type: Schema.Types.ObjectId, ref: "Member", required: true, index: true },
    startTime: { type: Date, required: true },
    endTime: { type: Date, required: true },
    hours: { type: Number, required: true, min: 0 },
    unitPrice: { type: Number, required: true, min: 0 },
    discount: { type: Number, required: true, min: 0, max: 1 },
    totalAmount: { type: Number, required: true, min: 0 },
    pointsEarned: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: ["booked", "cancelled"], default: "booked", index: true },
    cancelledAt: { type: Date },
  },
  { timestamps: true },
);

bookingSchema.index({ room: 1, status: 1, startTime: 1, endTime: 1 });

export const BookingModel = model<BookingDocument>("Booking", bookingSchema);

export interface BookingView {
  id: string;
  roomId: string;
  roomName: string;
  memberId: string;
  memberName: string;
  startTime: string;
  endTime: string;
  hours: number;
  unitPrice: number;
  discount: number;
  totalAmount: number;
  pointsEarned: number;
  status: BookingStatus;
  createdAt: string;
  cancelledAt?: string;
}
