import mongoose, { Types } from "mongoose";
import { AppError } from "../../common/errors";
import { getLevelRule, pointsEarnedForConsume, roundMoney } from "../../common/membership";
import { MemberModel } from "../members/member.model";
import { RoomModel, type RoomDocument } from "../rooms/room.model";
import { TransactionModel } from "../transactions/transaction.model";
import { BookingModel, type BookingDocument, type BookingView } from "./booking.model";

const MIN_DURATION_MINUTES = 30;
const MAX_DURATION_HOURS = 24;

/** 事务配置：快照读 + 多数派写，配合 withTransaction 自动重试 TransientTransactionError */
const TXN_OPTIONS = {
  readConcern: { level: "snapshot" as const },
  writeConcern: { w: "majority" as const },
  readPreference: "primary" as const,
};

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

async function toPopulatedView(bookingId: Types.ObjectId): Promise<BookingView> {
  const booking = await BookingModel.findById(bookingId)
    .populate("room", "name")
    .populate("member", "name");
  return toView(booking!);
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

  /**
   * 下单：扣款、预约、流水在同一个 MongoDB 事务中提交，全部成功或全部回滚。
   * 事务内先对包厢文档做一次写操作（bookingSeq 自增）作为每包厢写锁，
   * 并发下单时后提交的事务会因 WriteConflict 重试并看到已提交的预约，
   * 从而避免“各自读到无冲突、最终时段重叠”的写偏斜。
   */
  async createBooking(payload: TimeRangeInput): Promise<BookingView> {
    const { roomId, memberId, start, end } = parseTimeRange(payload);
    const { room, member } = await loadRoomAndMember(roomId, memberId);
    if (room.status !== "available") {
      throw new AppError(400, `包厢「${room.name}」正在维护，暂不可预约`);
    }
    const rule = getLevelRule(member.level);
    const { hours, totalAmount } = computeQuote(room, rule.discount, start, end);
    const pointsEarned = pointsEarnedForConsume(totalAmount);

    const session = await mongoose.startSession();
    let bookingId: Types.ObjectId | undefined;
    try {
      await session.withTransaction(async () => {
        await RoomModel.updateOne({ _id: room._id }, { $inc: { bookingSeq: 1 } }, { session });

        const conflict = await BookingModel.findOne({
          room: room._id,
          status: "booked",
          startTime: { $lt: end },
          endTime: { $gt: start },
        })
          .sort({ startTime: 1 })
          .session(session);
        if (conflict) {
          throw new AppError(
            409,
            `包厢「${room.name}」在 ${formatTime(conflict.startTime)} 至 ${formatTime(conflict.endTime)} 已被预约，时段不能重叠`,
          );
        }

        const freshMember = await MemberModel.findById(memberId).session(session);
        if (!freshMember) {
          throw new AppError(404, "会员不存在，可能已被删除");
        }
        if (freshMember.balance < totalAmount) {
          throw new AppError(
            400,
            `余额不足：本次预约需 ¥${totalAmount.toFixed(2)}（${rule.levelName} ${rule.discount * 10} 折），当前余额 ¥${freshMember.balance.toFixed(2)}，请先充值`,
          );
        }

        freshMember.balance = roundMoney(freshMember.balance - totalAmount);
        freshMember.points += pointsEarned;
        await freshMember.save({ session });

        const [booking] = await BookingModel.create(
          [
            {
              room: room._id,
              member: freshMember._id,
              startTime: start,
              endTime: end,
              hours,
              unitPrice: room.hourlyRate,
              discount: rule.discount,
              totalAmount,
              pointsEarned,
              status: "booked",
            },
          ],
          { session },
        );
        bookingId = booking._id;

        await TransactionModel.create(
          [
            {
              member: freshMember._id,
              type: "consume",
              amount: totalAmount,
              balanceAfter: freshMember.balance,
              pointsDelta: pointsEarned,
              pointsAfter: freshMember.points,
              booking: booking._id,
              note: `预约包厢「${room.name}」${formatTime(start)} 至 ${formatTime(end)}`,
            },
          ],
          { session },
        );

        // 故障注入点（仅测试环境设置 FAULT_INJECT_BOOKING=1 时生效）：
        // 模拟流水写入后、事务提交前发生故障，用于验证全部写入回滚
        if (process.env.FAULT_INJECT_BOOKING === "1") {
          throw new AppError(500, "注入故障：模拟下单事务提交前失败");
        }
      }, TXN_OPTIONS);
    } finally {
      await session.endSession();
    }

    return toPopulatedView(bookingId!);
  }

  /** 取消：退款、预约状态、流水同样在一个事务中提交 */
  async cancelBooking(id: string): Promise<BookingView> {
    if (!Types.ObjectId.isValid(id)) {
      throw new AppError(400, "预约 ID 格式无效");
    }

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const booking = await BookingModel.findById(id).session(session);
        if (!booking) {
          throw new AppError(404, "预约记录不存在");
        }
        if (booking.status === "cancelled") {
          throw new AppError(400, "该预约已取消，请勿重复操作");
        }

        const member = await MemberModel.findById(booking.member).session(session);
        if (!member) {
          throw new AppError(404, "关联会员不存在，无法退款");
        }
        const room = await RoomModel.findById(booking.room).session(session);

        member.balance = roundMoney(member.balance + booking.totalAmount);
        const pointsToDeduct = Math.min(member.points, booking.pointsEarned);
        member.points -= pointsToDeduct;
        await member.save({ session });

        booking.status = "cancelled";
        booking.cancelledAt = new Date();
        await booking.save({ session });

        await TransactionModel.create(
          [
            {
              member: member._id,
              type: "refund",
              amount: booking.totalAmount,
              balanceAfter: member.balance,
              pointsDelta: -pointsToDeduct,
              pointsAfter: member.points,
              booking: booking._id,
              note: `取消预约「${room?.name ?? "未知包厢"}」，退款 ¥${booking.totalAmount.toFixed(2)}`,
            },
          ],
          { session },
        );

        // 故障注入点（FAULT_INJECT_CANCEL=1）：验证取消的退款与状态变更整体回滚
        if (process.env.FAULT_INJECT_CANCEL === "1") {
          throw new AppError(500, "注入故障：模拟取消事务提交前失败");
        }
      }, TXN_OPTIONS);
    } finally {
      await session.endSession();
    }

    return toPopulatedView(new Types.ObjectId(id));
  }
}
