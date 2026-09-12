export interface FeatureItem {
  id: number;
  title: string;
  description: string;
  status: string;
  metric: string;
}

export interface KpiItem {
  label: string;
  value: string;
  trend: string;
  tone: string;
}

export interface OperationRecord {
  key: string;
  name: string;
  owner: string;
  status: string;
  metric: string;
  priority: string;
}

export interface OverviewResponse {
  appName: string;
  appCode: string;
  description: string;
  features: FeatureItem[];
  kpis: KpiItem[];
  records: OperationRecord[];
}

export interface Room {
  id: string;
  name: string;
  capacity: number;
  facilities: string[];
  hourlyRate: number;
  status: "available" | "maintenance";
  description: string;
}

export interface Member {
  id: string;
  name: string;
  phone: string;
  level: string;
  levelName: string;
  discount: number;
  balance: number;
  points: number;
  totalRecharged: number;
  createdAt: string;
}

export interface Booking {
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
  status: "booked" | "cancelled";
  createdAt: string;
  cancelledAt?: string;
}

export interface BookingQuote {
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

export interface WalletTransaction {
  id: string;
  memberId: string;
  type: "recharge" | "consume" | "refund";
  amount: number;
  balanceAfter: number;
  pointsDelta: number;
  pointsAfter: number;
  bookingId?: string;
  note: string;
  createdAt: string;
}

export interface RechargeResult {
  member: Member;
  levelUpgraded: boolean;
  levelName: string;
}
