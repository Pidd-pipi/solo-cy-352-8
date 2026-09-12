import { Types } from "mongoose";
import { AppError } from "../../common/errors";
import { getLevelRule, pointsEarnedForConsume, roundMoney } from "../../common/membership";
import { MemberModel } from "../members/member.model";
import { RoomModel, type RoomDocument } from "../rooms/room.model";
import { TransactionModel } from "../transactions/transaction.model";
import { BookingModel, type BookingDocument, type BookingView } from "./booking.model";

const MIN_DURATION_MINUTES = 30;
const MAX_DURATION_HOURS = 24;

export interface QuoteView {
  roomId: string;
  roomName: string;
  memberId: string;
  memberName: string;
  levelName: string;
  startTime: string;
  endTime: string;
  hours: number;
  unitPrice: number;
  discount: number;
  grossAmount: number;
  totalAmount: number;
  balance: number;
  balanceSufficient: boolean;
}

interface TimeRangeInput {
  roomId?: string;
  memberId?: string;
  startTime?: string;
  endTime?: string;
}

function parseTimeRange(payload: TimeRangeInput) {
  const { roomId, memberId, startTime, endTime } = payload;
  if (!roomId || !Types.ObjectId.isValid(roomId)) {
    throw new AppError(400, "请选择要预约的包厢");
  }
  if (!memberId || !Types.ObjectId.isValid(memberId)) {
    throw new AppError(400, "请选择预约会员");
  }
  if (!startTime || !endTime) {
    throw new AppError(400, "请选择预约的开始和结束时间");
  }
  const start = new Date(startTime);
  const end = new Date(endTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new AppError(400, "预约时间格式无效");
  }
  if (end <= start) {
    throw new AppError(400, "结束时间必须晚于开始时间");
  }
  const durationMinutes = (end.getTime() - start.getTime()) / 60000;
  if (durationMinutes < MIN_DURATION_MINUTES) {
    throw new AppError(400, `预约时长不能少于 ${MIN_DURATION_MINUTES} 分钟`);
  }
  if (durationMinutes > MAX_DURATION_HOURS * 60) {
    throw new AppError(400, `单次预约时长不能超过 ${MAX_DURATION_HOURS} 小时`);
  }
  if (start.getTime() < Date.now() - 60 * 1000) {
    throw new AppError(400, "开始时间不能早于当前时间");
  }
  return { roomId, memberId, start, end };
}

function formatTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

async function loadRoomAndMember(roomId: string, memberId: string) {
  const room = await RoomModel.findById(roomId);
  if (!room) {
    throw new AppError(404, "包厢不存在，可能已被下架");
  }
  const member = await MemberModel.findById(memberId);
  if (!member) {
    throw new AppError(404, "会员不存在，可能已被删除");
  }
  return { room, member };
}

function computeQuote(room: RoomDocument, discount: number, start: Date, end: Date) {
  const hours = Math.round(((end.getTime() - start.getTime()) / 3600000) * 100) / 100;
  const grossAmount = roundMoney(room.hourlyRate * hours);
  const totalAmount = roundMoney(grossAmount * discount);
  return { hours, grossAmount, totalAmount };
}

async function findConflict(roomId: string, start: Date, end: Date) {
  return BookingModel.findOne({
    room: roomId,
    status: "booked",
    startTime: { $lt: end },
    endTime: { $gt: start },
  }).sort({ startTime: 1 });
}

function toView(booking: BookingDocument & { _id: Types.ObjectId }): BookingView {
  const room = booking.room as unknown as { _id: Types.ObjectId; name?: string };
  const member = booking.member as unknown as { _id: Types.ObjectId; name?: string };
  return {
    id: booking._id.toString(),
    roomId: room._id.toString(),
    roomName: room.name ?? "未知包厢",
    memberId: member._id.toString(),
    memberName: member.name ?? "未知会员",
    startTime: booking.startTime.toISOString(),
    endTime: booking.endTime.toISOString(),
    hours: booking.hours,
    unitPrice: booking.unitPrice,
    discount: booking.discount,
    totalAmount: booking.totalAmount,
    pointsEarned: booking.pointsEarned,
    status: booking.status,
    createdAt: booking.createdAt.toISOString(),
    cancelledAt: booking.cancelledAt ? booking.cancelledAt.toISOString() : undefined,
  };
}

export class BookingService {
  async listBookings(status?: string): Promise<BookingView[]> {
    const filter: Record<string, unknown> = {};
    if (status === "booked" || status === "cancelled") {
      filter.status = status;
    }
    const bookings = await BookingModel.find(filter)
      .populate("room", "name")
      .populate("member", "name")
      .sort({ startTime: -1 })
      .limit(200);
    return bookings.map(toView);
  }

  async quote(payload: TimeRangeInput): Promise<QuoteView> {
    const { roomId, memberId, start, end } = parseTimeRange(payload);
    const { room, member } = await loadRoomAndMember(roomId, memberId);
    if (room.status !== "available") {
      throw new AppError(400, `包厢「${room.name}」正在维护，暂不可预约`);
    }
    const rule = getLevelRule(member.level);
    const { hours, grossAmount, totalAmount } = computeQuote(room, rule.discount, start, end);
    return {
      roomId: room._id.toString(),
      roomName: room.name,
      memberId: member._id.toString(),
      memberName: member.name,
      levelName: rule.levelName,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      hours,
      unitPrice: room.hourlyRate,
      discount: rule.discount,
      grossAmount,
      totalAmount,
      balance: member.balance,
      balanceSufficient: member.balance >= totalAmount,
    };
  }

  async createBooking(payload: TimeRangeInput): Promise<BookingView> {
    const { roomId, memberId, start, end } = parseTimeRange(payload);
    const { room, member } = await loadRoomAndMember(roomId, memberId);
    if (room.status !== "available") {
      throw new AppError(400, `包厢「${room.name}」正在维护，暂不可预约`);
    }

    const conflict = await findConflict(roomId, start, end);
    if (conflict) {
      throw new AppError(
        409,
        `包厢「${room.name}」在 ${formatTime(conflict.startTime)} 至 ${formatTime(conflict.endTime)} 已被预约，时段不能重叠`,
      );
    }

    const rule = getLevelRule(member.level);
    const { hours, totalAmount } = computeQuote(room, rule.discount, start, end);
    if (member.balance < totalAmount) {
      throw new AppError(
        400,
        `余额不足：本次预约需 ¥${totalAmount.toFixed(2)}（${rule.levelName} ${rule.discount * 10} 折），当前余额 ¥${member.balance.toFixed(2)}，请先充值`,
      );
    }

    const pointsEarned = pointsEarnedForConsume(totalAmount);
    member.balance = roundMoney(member.balance - totalAmount);
    member.points += pointsEarned;
    await member.save();

    const booking = await BookingModel.create({
      room: room._id,
      member: member._id,
      startTime: start,
      endTime: end,
      hours,
      unitPrice: room.hourlyRate,
      discount: rule.discount,
      totalAmount,
      pointsEarned,
      status: "booked",
    });

    await TransactionModel.create({
      member: member._id,
      type: "consume",
      amount: totalAmount,
      balanceAfter: member.balance,
      pointsDelta: pointsEarned,
      pointsAfter: member.points,
      booking: booking._id,
      note: `预约包厢「${room.name}」${formatTime(start)} 至 ${formatTime(end)}`,
    });

    const created = await BookingModel.findById(booking._id)
      .populate("room", "name")
      .populate("member", "name");
    return toView(created!);
  }

  async cancelBooking(id: string): Promise<BookingView> {
    if (!Types.ObjectId.isValid(id)) {
      throw new AppError(400, "预约 ID 格式无效");
    }
    const booking = await BookingModel.findById(id);
    if (!booking) {
      throw new AppError(404, "预约记录不存在");
    }
    if (booking.status === "cancelled") {
      throw new AppError(400, "该预约已取消，请勿重复操作");
    }

    const room = await RoomModel.findById(booking.room);
    const member = await MemberModel.findById(booking.member);
    if (!member) {
      throw new AppError(404, "关联会员不存在，无法退款");
    }

    member.balance = roundMoney(member.balance + booking.totalAmount);
    const pointsToDeduct = Math.min(member.points, booking.pointsEarned);
    member.points -= pointsToDeduct;
    await member.save();

    booking.status = "cancelled";
    booking.cancelledAt = new Date();
    await booking.save();

    await TransactionModel.create({
      member: member._id,
      type: "refund",
      amount: booking.totalAmount,
      balanceAfter: member.balance,
      pointsDelta: -pointsToDeduct,
      pointsAfter: member.points,
      booking: booking._id,
      note: `取消预约「${room?.name ?? "未知包厢"}」，退款 ¥${booking.totalAmount.toFixed(2)}`,
    });

    const updated = await BookingModel.findById(booking._id)
      .populate("room", "name")
      .populate("member", "name");
    return toView(updated!);
  }
}
