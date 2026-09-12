export type MemberLevel = "NORMAL" | "SILVER" | "GOLD" | "PLATINUM";

export interface LevelRule {
  level: MemberLevel;
  levelName: string;
  discount: number;
  /** 累计充值达到该金额（元）即自动升级到该等级 */
  minTotalRecharged: number;
}

export const LEVEL_RULES: LevelRule[] = [
  { level: "NORMAL", levelName: "普通会员", discount: 1, minTotalRecharged: 0 },
  { level: "SILVER", levelName: "银卡会员", discount: 0.95, minTotalRecharged: 500 },
  { level: "GOLD", levelName: "金卡会员", discount: 0.9, minTotalRecharged: 2000 },
  { level: "PLATINUM", levelName: "铂金会员", discount: 0.85, minTotalRecharged: 5000 },
];

export const MEMBER_LEVELS = LEVEL_RULES.map((rule) => rule.level) as MemberLevel[];

export function getLevelRule(level: MemberLevel): LevelRule {
  return LEVEL_RULES.find((rule) => rule.level === level) ?? LEVEL_RULES[0];
}

/** 根据累计充值金额计算应属等级（只升不降，由调用方决定是否覆盖） */
export function resolveLevelByTotalRecharged(totalRecharged: number): MemberLevel {
  let resolved: MemberLevel = "NORMAL";
  for (const rule of LEVEL_RULES) {
    if (totalRecharged >= rule.minTotalRecharged) {
      resolved = rule.level;
    }
  }
  return resolved;
}

/** 每消费 1 元累积 1 积分（向下取整） */
export function pointsEarnedForConsume(amount: number): number {
  return Math.floor(amount);
}

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
