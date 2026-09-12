import { Schema, model, type Document, type Types } from "mongoose";

export type TransactionType = "recharge" | "consume" | "refund";

export interface TransactionDocument extends Document {
  member: Types.ObjectId;
  type: TransactionType;
  amount: number;
  balanceAfter: number;
  pointsDelta: number;
  pointsAfter: number;
  booking?: Types.ObjectId;
  note: string;
  createdAt: Date;
  updatedAt: Date;
}

const transactionSchema = new Schema<TransactionDocument>(
  {
    member: { type: Schema.Types.ObjectId, ref: "Member", required: true, index: true },
    type: { type: String, enum: ["recharge", "consume", "refund"], required: true },
    amount: { type: Number, required: true, min: 0 },
    balanceAfter: { type: Number, required: true, min: 0 },
    pointsDelta: { type: Number, default: 0 },
    pointsAfter: { type: Number, required: true, min: 0 },
    booking: { type: Schema.Types.ObjectId, ref: "Booking" },
    note: { type: String, default: "", maxlength: 200 },
  },
  { timestamps: true },
);

transactionSchema.index({ member: 1, createdAt: -1 });

export const TransactionModel = model<TransactionDocument>("Transaction", transactionSchema);

export interface TransactionView {
  id: string;
  memberId: string;
  type: TransactionType;
  amount: number;
  balanceAfter: number;
  pointsDelta: number;
  pointsAfter: number;
  bookingId?: string;
  note: string;
  createdAt: string;
}

export function toTransactionView(
  transaction: TransactionDocument & { _id: Types.ObjectId },
): TransactionView {
  return {
    id: transaction._id.toString(),
    memberId: transaction.member.toString(),
    type: transaction.type,
    amount: transaction.amount,
    balanceAfter: transaction.balanceAfter,
    pointsDelta: transaction.pointsDelta,
    pointsAfter: transaction.pointsAfter,
    bookingId: transaction.booking ? transaction.booking.toString() : undefined,
    note: transaction.note,
    createdAt: transaction.createdAt.toISOString(),
  };
}
