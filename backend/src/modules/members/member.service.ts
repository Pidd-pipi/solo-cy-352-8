import { Types } from "mongoose";
import { AppError } from "../../common/errors";
import {
  getLevelRule,
  resolveLevelByTotalRecharged,
  roundMoney,
  type MemberLevel,
} from "../../common/membership";
import { MemberModel, toMemberView, type MemberView } from "./member.model";
import {
  TransactionModel,
  toTransactionView,
  type TransactionView,
} from "../transactions/transaction.model";

export interface MemberDetailView extends MemberView {
  levelName: string;
  discount: number;
}

export interface RechargeResult {
  member: MemberDetailView;
  levelUpgraded: boolean;
  levelName: string;
}

function withLevelInfo(member: MemberView): MemberDetailView {
  const rule = getLevelRule(member.level);
  return { ...member, levelName: rule.levelName, discount: rule.discount };
}

export class MemberService {
  async listMembers(): Promise<MemberDetailView[]> {
    const members = await MemberModel.find().sort({ createdAt: 1 });
    return members.map((member) => withLevelInfo(toMemberView(member)));
  }

  async getMember(id: string): Promise<MemberDetailView> {
    if (!Types.ObjectId.isValid(id)) {
      throw new AppError(400, "会员 ID 格式无效");
    }
    const member = await MemberModel.findById(id);
    if (!member) {
      throw new AppError(404, "会员不存在，可能已被删除");
    }
    return withLevelInfo(toMemberView(member));
  }

  async createMember(payload: { name?: string; phone?: string; level?: string }): Promise<MemberDetailView> {
    const name = (payload.name ?? "").trim();
    const phone = (payload.phone ?? "").trim();
    if (!name) {
      throw new AppError(400, "会员姓名不能为空");
    }
    if (!/^1\d{10}$/.test(phone)) {
      throw new AppError(400, "手机号格式不正确，应为 11 位数字且以 1 开头");
    }
    const level = (payload.level ?? "NORMAL") as MemberLevel;
    if (!["NORMAL", "SILVER", "GOLD", "PLATINUM"].includes(level)) {
      throw new AppError(400, "会员等级无效");
    }
    const existing = await MemberModel.findOne({ phone });
    if (existing) {
      throw new AppError(409, `手机号 ${phone} 已注册会员（${existing.name}），请直接选择该会员`);
    }
    const member = await MemberModel.create({ name, phone, level });
    return withLevelInfo(toMemberView(member));
  }

  async recharge(id: string, payload: { amount?: number }): Promise<RechargeResult> {
    if (!Types.ObjectId.isValid(id)) {
      throw new AppError(400, "会员 ID 格式无效");
    }
    const amount = Number(payload.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new AppError(400, "充值金额必须大于 0");
    }
    if (amount > 1000000) {
      throw new AppError(400, "单笔充值金额不能超过 1,000,000 元");
    }
    const member = await MemberModel.findById(id);
    if (!member) {
      throw new AppError(404, "会员不存在，可能已被删除");
    }

    const previousLevel = member.level;
    member.balance = roundMoney(member.balance + amount);
    member.totalRecharged = roundMoney(member.totalRecharged + amount);
    const resolvedLevel = resolveLevelByTotalRecharged(member.totalRecharged);
    // 等级只升不降
    const order = ["NORMAL", "SILVER", "GOLD", "PLATINUM"];
    if (order.indexOf(resolvedLevel) > order.indexOf(member.level)) {
      member.level = resolvedLevel;
    }
    await member.save();

    await TransactionModel.create({
      member: member._id,
      type: "recharge",
      amount: roundMoney(amount),
      balanceAfter: member.balance,
      pointsDelta: 0,
      pointsAfter: member.points,
      note: `账户充值 ¥${roundMoney(amount).toFixed(2)}`,
    });

    const view = withLevelInfo(toMemberView(member));
    return {
      member: view,
      levelUpgraded: member.level !== previousLevel,
      levelName: view.levelName,
    };
  }

  async listTransactions(id: string): Promise<TransactionView[]> {
    if (!Types.ObjectId.isValid(id)) {
      throw new AppError(400, "会员 ID 格式无效");
    }
    const member = await MemberModel.findById(id);
    if (!member) {
      throw new AppError(404, "会员不存在，可能已被删除");
    }
    const transactions = await TransactionModel.find({ member: member._id })
      .sort({ createdAt: -1 })
      .limit(100);
    return transactions.map(toTransactionView);
  }
}
