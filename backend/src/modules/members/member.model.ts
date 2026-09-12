import { Schema, model, type Document, type Types } from "mongoose";
import { MEMBER_LEVELS, type MemberLevel } from "../../common/membership";

export interface MemberDocument extends Document {
  name: string;
  phone: string;
  level: MemberLevel;
  balance: number;
  points: number;
  totalRecharged: number;
  createdAt: Date;
  updatedAt: Date;
}

const memberSchema = new Schema<MemberDocument>(
  {
    name: { type: String, required: true, trim: true, maxlength: 32 },
    phone: { type: String, required: true, unique: true, trim: true, maxlength: 20 },
    level: { type: String, enum: MEMBER_LEVELS, default: "NORMAL" },
    balance: { type: Number, default: 0, min: 0 },
    points: { type: Number, default: 0, min: 0 },
    totalRecharged: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
);

export const MemberModel = model<MemberDocument>("Member", memberSchema);

export interface MemberView {
  id: string;
  name: string;
  phone: string;
  level: MemberLevel;
  balance: number;
  points: number;
  totalRecharged: number;
  createdAt: string;
}

export function toMemberView(member: MemberDocument & { _id: Types.ObjectId }): MemberView {
  return {
    id: member._id.toString(),
    name: member.name,
    phone: member.phone,
    level: member.level,
    balance: member.balance,
    points: member.points,
    totalRecharged: member.totalRecharged,
    createdAt: member.createdAt.toISOString(),
  };
}
