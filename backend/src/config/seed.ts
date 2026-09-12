import { logger } from "../common/logger";
import { MemberModel } from "../modules/members/member.model";
import { RoomModel } from "../modules/rooms/room.model";

const seedRooms = [
  {
    name: "青松小包",
    capacity: 4,
    facilities: ["投影", "桌游架", "空调"],
    hourlyRate: 38,
    status: "available" as const,
    description: "适合 2-4 人轻策与聚会游戏",
  },
  {
    name: "白鹭中包",
    capacity: 8,
    facilities: ["投影", "音响", "桌游架", "空调"],
    hourlyRate: 68,
    status: "available" as const,
    description: "适合 5-8 人聚会与阵营游戏",
  },
  {
    name: "麒麟大包",
    capacity: 12,
    facilities: ["投影", "音响", "独立吧台", "空调"],
    hourlyRate: 98,
    status: "available" as const,
    description: "适合 9-12 人狼人杀、剧本杀",
  },
  {
    name: "星野主题房",
    capacity: 6,
    facilities: ["氛围灯", "投影", "音响", "空调"],
    hourlyRate: 88,
    status: "maintenance" as const,
    description: "沉浸式主题包厢（设备维护中）",
  },
];

const seedMembers = [
  { name: "张明", phone: "13800000001", level: "GOLD" as const, balance: 500, points: 120, totalRecharged: 2600 },
  { name: "李婷", phone: "13800000002", level: "SILVER" as const, balance: 200, points: 45, totalRecharged: 800 },
];

export async function seedDatabase(): Promise<void> {
  const roomCount = await RoomModel.estimatedDocumentCount();
  if (roomCount === 0) {
    await RoomModel.insertMany(seedRooms);
    logger.info(`Seeded ${seedRooms.length} rooms`);
  }
  const memberCount = await MemberModel.estimatedDocumentCount();
  if (memberCount === 0) {
    await MemberModel.insertMany(seedMembers);
    logger.info(`Seeded ${seedMembers.length} members`);
  }
}
