/* 功能检查脚本：对运行中的后端执行端到端业务流验证并输出结果。
   设计为可在同一数据库上重复执行：每轮使用唯一的会员手机号与预约时段，
   断言基于本轮新建数据的增量（delta），不依赖固定的历史数据。 */
const BASE = process.env.API_BASE_URL || "http://localhost:29512/api";

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL  ${name} ${detail}`);
  }
}

async function api(path, options = {}) {
  const response = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

function futureTime(dayOffset, hour, minute = 0) {
  const date = new Date();
  date.setDate(date.getDate() + dayOffset);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

async function main() {
  // 每轮唯一标识：手机号与预约时段均按轮次生成，避免与历史轮次冲突
  const runId = `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
  const phoneA = `1${String(Date.now()).slice(-9)}${Math.floor(Math.random() * 10)}`;
  const phoneB = `1${String(Date.now() + 1).slice(-9)}${Math.floor(Math.random() * 10)}`;
  const dayOffset = 7 + (Date.now() % 280);
  const baseHour = 8 + (Date.now() % 10);
  console.log(`运行标识 ${runId}：会员A手机 ${phoneA}，会员B手机 ${phoneB}，预约日偏移 +${dayOffset} 天 ${baseHour} 时起`);

  console.log("== 1. 原总览接口保持不变 ==");
  const overview = await api("/overview");
  check("GET /overview 返回 200", overview.status === 200);
  check("总览 appCode 正确", overview.body?.appCode === "lpboardgame");
  check("总览 features 仍为 5 项", Array.isArray(overview.body?.features) && overview.body.features.length === 5);
  check("总览 kpis 仍为 4 项", Array.isArray(overview.body?.kpis) && overview.body.kpis.length === 4);
  check("总览 records 仍为 5 条", Array.isArray(overview.body?.records) && overview.body.records.length === 5);
  check("总览含包厢预约与会员储值模块", overview.body?.features?.some((f) => f.title === "包厢预约与会员储值"));

  console.log("== 2. 包厢与会员列表 ==");
  const rooms = await api("/rooms");
  check("GET /rooms 返回 4 个包厢", rooms.status === 200 && rooms.body.length === 4);
  const roomBailu = rooms.body.find((r) => r.name === "白鹭中包");
  const roomQilin = rooms.body.find((r) => r.name === "麒麟大包");
  const roomMaint = rooms.body.find((r) => r.name === "星野主题房");
  check("白鹭中包 68 元/小时可预约", roomBailu?.hourlyRate === 68 && roomBailu?.status === "available");
  check("麒麟大包 98 元/小时可预约", roomQilin?.hourlyRate === 98 && roomQilin?.status === "available");
  check("星野主题房为维护中", roomMaint?.status === "maintenance");

  const members = await api("/members");
  check("GET /members 返回会员列表", members.status === 200 && members.body.length >= 2);
  const zhangming = members.body.find((m) => m.name === "张明");
  check("种子会员张明为金卡 9 折", zhangming?.level === "GOLD" && zhangming?.discount === 0.9);

  console.log("== 3. 会员创建与校验 ==");
  const badPhone = await api("/members", { method: "POST", body: { name: "测试", phone: "123", level: "NORMAL" } });
  check("错误手机号返回 400 与原因", badPhone.status === 400 && badPhone.body?.message?.includes("手机号"));
  const noName = await api("/members", { method: "POST", body: { name: "", phone: phoneA, level: "NORMAL" } });
  check("空姓名返回 400 与原因", noName.status === 400 && noName.body?.message?.includes("姓名"));
  const createdA = await api("/members", { method: "POST", body: { name: `检查会员A-${runId}`, phone: phoneA, level: "NORMAL" } });
  check("创建会员A成功 201", createdA.status === 201 && !!createdA.body?.id);
  const createdB = await api("/members", { method: "POST", body: { name: `检查会员B-${runId}`, phone: phoneB, level: "GOLD" } });
  check("创建会员B（金卡）成功 201", createdB.status === 201 && createdB.body?.discount === 0.9);
  const dup = await api("/members", { method: "POST", body: { name: "重复", phone: phoneA, level: "NORMAL" } });
  check("重复手机号返回 409 与原因", dup.status === 409 && dup.body?.message?.includes("已注册"));
  const memberA = createdA.body;
  const memberB = createdB.body;

  console.log("== 4. 充值、余额、积分与升级 ==");
  const badRecharge = await api(`/members/${memberA.id}/recharge`, { method: "POST", body: { amount: -50 } });
  check("负数充值返回 400 与原因", badRecharge.status === 400 && badRecharge.body?.message?.includes("大于 0"));
  const recharge1 = await api(`/members/${memberA.id}/recharge`, { method: "POST", body: { amount: 300 } });
  check("充值 300 后余额 300", recharge1.status === 200 && recharge1.body?.member?.balance === 300);
  check("累计 300 仍为普通会员", recharge1.body?.member?.level === "NORMAL" && recharge1.body?.levelUpgraded === false);
  const recharge2 = await api(`/members/${memberA.id}/recharge`, { method: "POST", body: { amount: 300 } });
  check("累计充值 600 自动升级银卡", recharge2.body?.member?.level === "SILVER" && recharge2.body?.levelUpgraded === true);
  check("升级后折扣 0.95", recharge2.body?.member?.discount === 0.95);
  const walletA = await api(`/members/${memberA.id}`);
  check("会员A详情余额 600 积分 0", walletA.body?.balance === 600 && walletA.body?.points === 0);
  const txAfterRecharge = await api(`/members/${memberA.id}/transactions`);
  check("充值产生 2 条流水", txAfterRecharge.body?.filter((t) => t.type === "recharge").length === 2);
  check("流水含余额快照 600", txAfterRecharge.body?.[0]?.balanceAfter === 600);
  await api(`/members/${memberB.id}/recharge`, { method: "POST", body: { amount: 500 } });
  const walletB0 = await api(`/members/${memberB.id}`);
  check("会员B充值 500 后余额 500", walletB0.body?.balance === 500);

  console.log("== 5. 预约试算与折扣 ==");
  const start1 = futureTime(dayOffset, baseHour);
  const end1 = futureTime(dayOffset, baseHour + 2);
  const quote = await api("/bookings/quote", { method: "POST", body: { roomId: roomBailu.id, memberId: memberB.id, startTime: start1, endTime: end1 } });
  check("金卡 2 小时试算 136×0.9=122.4", quote.status === 200 && quote.body?.grossAmount === 136 && quote.body?.totalAmount === 122.4);
  const quoteSilver = await api("/bookings/quote", { method: "POST", body: { roomId: roomBailu.id, memberId: memberA.id, startTime: start1, endTime: end1 } });
  check("银卡同一时段试算 136×0.95=129.2", quoteSilver.body?.totalAmount === 129.2);

  console.log("== 6. 预约下单、扣款与积分 ==");
  const booking1 = await api("/bookings", { method: "POST", body: { roomId: roomBailu.id, memberId: memberB.id, startTime: start1, endTime: end1 } });
  check("预约成功 201", booking1.status === 201 && booking1.body?.status === "booked");
  check("预约记录含折扣与金额", booking1.body?.discount === 0.9 && booking1.body?.totalAmount === 122.4);
  check("消费积分 +122", booking1.body?.pointsEarned === 122);
  const walletB1 = await api(`/members/${memberB.id}`);
  check("会员B余额 500-122.4=377.6", Math.abs(walletB1.body?.balance - 377.6) < 0.001);
  check("会员B积分 0+122=122", walletB1.body?.points === 122);

  console.log("== 7. 时段重叠校验 ==");
  const overlap = await api("/bookings", { method: "POST", body: { roomId: roomBailu.id, memberId: memberA.id, startTime: futureTime(dayOffset, baseHour + 1), endTime: futureTime(dayOffset, baseHour + 3) } });
  check("部分重叠返回 409 与原因", overlap.status === 409 && overlap.body?.message?.includes("时段不能重叠"));
  const contained = await api("/bookings", { method: "POST", body: { roomId: roomBailu.id, memberId: memberA.id, startTime: futureTime(dayOffset, baseHour, 30), endTime: futureTime(dayOffset, baseHour + 1, 30) } });
  check("包含重叠同样 409", contained.status === 409);
  const adjacent = await api("/bookings", { method: "POST", body: { roomId: roomBailu.id, memberId: memberA.id, startTime: end1, endTime: futureTime(dayOffset, baseHour + 4) } });
  check("首尾相接不算重叠，预约成功", adjacent.status === 201);
  const otherRoom = await api("/bookings", { method: "POST", body: { roomId: roomQilin.id, memberId: memberA.id, startTime: futureTime(dayOffset, baseHour + 1), endTime: futureTime(dayOffset, baseHour + 2) } });
  check("不同包厢同时段互不影响", otherRoom.status === 201);

  console.log("== 8. 失败原因提示 ==");
  const tooExpensive = await api("/bookings", { method: "POST", body: { roomId: roomQilin.id, memberId: memberA.id, startTime: futureTime(dayOffset + 1, 10), endTime: futureTime(dayOffset + 1, 20) } });
  check("余额不足返回 400 与原因", tooExpensive.status === 400 && tooExpensive.body?.message?.includes("余额不足"));
  const past = await api("/bookings", { method: "POST", body: { roomId: roomBailu.id, memberId: memberB.id, startTime: "2020-01-01T10:00:00.000Z", endTime: "2020-01-01T12:00:00.000Z" } });
  check("过去时间返回 400 与原因", past.status === 400 && past.body?.message?.includes("当前时间"));
  const inverted = await api("/bookings", { method: "POST", body: { roomId: roomBailu.id, memberId: memberB.id, startTime: futureTime(dayOffset + 2, 12), endTime: futureTime(dayOffset + 2, 10) } });
  check("结束早于开始返回 400", inverted.status === 400 && inverted.body?.message?.includes("结束时间"));
  const tooShort = await api("/bookings", { method: "POST", body: { roomId: roomBailu.id, memberId: memberB.id, startTime: futureTime(dayOffset + 2, 10), endTime: futureTime(dayOffset + 2, 10, 15) } });
  check("不足 30 分钟返回 400", tooShort.status === 400 && tooShort.body?.message?.includes("30 分钟"));
  const maint = await api("/bookings", { method: "POST", body: { roomId: roomMaint.id, memberId: memberB.id, startTime: futureTime(dayOffset + 2, 10), endTime: futureTime(dayOffset + 2, 12) } });
  check("维护中包厢返回 400 与原因", maint.status === 400 && maint.body?.message?.includes("维护"));
  const notFound = await api("/members/000000000000000000000000");
  check("不存在的会员返回 404", notFound.status === 404 && notFound.body?.message?.includes("不存在"));
  const unknownRoute = await api("/no-such-route");
  check("未知路由返回 404 JSON", unknownRoute.status === 404 && unknownRoute.body?.message === "接口不存在");

  console.log("== 9. 取消预约、退款与积分回退 ==");
  const aBeforeCancel = await api(`/members/${memberA.id}`);
  const cancel1 = await api(`/bookings/${adjacent.body.id}/cancel`, { method: "POST" });
  check("取消成功，状态已取消", cancel1.status === 200 && cancel1.body?.status === "cancelled");
  const aAfterCancel = await api(`/members/${memberA.id}`);
  check("取消后费用退回余额", Math.abs(aAfterCancel.body?.balance - aBeforeCancel.body?.balance - adjacent.body.totalAmount) < 0.001);
  check("取消后积分回退", aAfterCancel.body?.points === aBeforeCancel.body?.points - adjacent.body.pointsEarned);
  const cancelAgain = await api(`/bookings/${adjacent.body.id}/cancel`, { method: "POST" });
  check("重复取消返回 400 与原因", cancelAgain.status === 400 && cancelAgain.body?.message?.includes("已取消"));
  const rebook = await api("/bookings", { method: "POST", body: { roomId: roomBailu.id, memberId: memberA.id, startTime: end1, endTime: futureTime(dayOffset, baseHour + 4) } });
  check("取消后的时段可再次预约", rebook.status === 201);

  console.log("== 10. 流水完整性 ==");
  const aTx = await api(`/members/${memberA.id}/transactions`);
  const types = aTx.body.map((t) => t.type);
  check("流水覆盖充值/消费/退款", types.includes("recharge") && types.includes("consume") && types.includes("refund"));
  const consumeTx = aTx.body.find((t) => t.type === "consume");
  check("消费流水记录积分变动", typeof consumeTx?.pointsDelta === "number" && consumeTx.pointsDelta > 0);
  const refundTx = aTx.body.find((t) => t.type === "refund");
  check("退款流水积分变动为负", refundTx?.pointsDelta < 0);

  console.log("== 11. 预约列表 ==");
  const bookings = await api("/bookings");
  const myBookings = bookings.body.filter((b) => b.memberId === memberA.id || b.memberId === memberB.id);
  check("本轮产生 4 条预约（含 1 条已取消）", myBookings.length === 4 && myBookings.filter((b) => b.status === "cancelled").length === 1);
  check("列表含包厢与会员名", bookings.body.every((b) => b.roomName && b.memberName));
  const bookedOnly = await api("/bookings?status=booked");
  check("按状态过滤生效", bookedOnly.body.every((b) => b.status === "booked"));

  console.log(`\n结果：${passed} 通过，${failed} 失败`);
  if (failures.length > 0) {
    console.log("失败项：");
    failures.forEach((item) => console.log(`  - ${item}`));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("检查脚本执行异常：", error);
  process.exit(1);
});
