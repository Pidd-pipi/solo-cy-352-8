/* 功能检查脚本：对运行中的后端执行端到端业务流验证并输出结果。 */
const BASE = "http://localhost:29512/api";

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
  check("星野主题房为维护中", roomMaint?.status === "maintenance");

  const members = await api("/members");
  check("GET /members 返回种子会员", members.status === 200 && members.body.length >= 2);
  const zhangming = members.body.find((m) => m.name === "张明");
  check("张明为金卡会员 9 折", zhangming?.level === "GOLD" && zhangming?.discount === 0.9);
  check("张明初始余额 500 积分 120", zhangming?.balance === 500 && zhangming?.points === 120);

  console.log("== 3. 会员创建与校验 ==");
  const badPhone = await api("/members", { method: "POST", body: { name: "测试", phone: "123", level: "NORMAL" } });
  check("错误手机号返回 400 与原因", badPhone.status === 400 && typeof badPhone.body?.message === "string" && badPhone.body.message.includes("手机号"));
  const noName = await api("/members", { method: "POST", body: { name: "", phone: "13911112222", level: "NORMAL" } });
  check("空姓名返回 400 与原因", noName.status === 400 && noName.body?.message?.includes("姓名"));
  const created = await api("/members", { method: "POST", body: { name: "王芳", phone: "13911112222", level: "NORMAL" } });
  check("创建会员成功 201", created.status === 201 && created.body?.id);
  const dup = await api("/members", { method: "POST", body: { name: "王芳2", phone: "13911112222", level: "NORMAL" } });
  check("重复手机号返回 409 与原因", dup.status === 409 && dup.body?.message?.includes("已注册"));
  const wangfang = created.body;

  console.log("== 4. 充值、余额、积分与升级 ==");
  const badRecharge = await api(`/members/${wangfang.id}/recharge`, { method: "POST", body: { amount: -50 } });
  check("负数充值返回 400 与原因", badRecharge.status === 400 && badRecharge.body?.message?.includes("大于 0"));
  const recharge1 = await api(`/members/${wangfang.id}/recharge`, { method: "POST", body: { amount: 300 } });
  check("充值 300 后余额 300", recharge1.status === 200 && recharge1.body?.member?.balance === 300);
  check("累计 300 仍为普通会员", recharge1.body?.member?.level === "NORMAL" && recharge1.body?.levelUpgraded === false);
  const recharge2 = await api(`/members/${wangfang.id}/recharge`, { method: "POST", body: { amount: 300 } });
  check("累计充值 600 自动升级银卡", recharge2.body?.member?.level === "SILVER" && recharge2.body?.levelUpgraded === true);
  check("升级后折扣 0.95", recharge2.body?.member?.discount === 0.95);
  const wallet = await api(`/members/${wangfang.id}`);
  check("会员详情余额 600 积分 0", wallet.body?.balance === 600 && wallet.body?.points === 0);
  const txAfterRecharge = await api(`/members/${wangfang.id}/transactions`);
  check("充值产生 2 条流水", txAfterRecharge.body?.filter((t) => t.type === "recharge").length === 2);
  check("流水含余额快照", txAfterRecharge.body?.[0]?.balanceAfter === 600);

  console.log("== 5. 预约试算与折扣 ==");
  const start1 = futureTime(2, 10);
  const end1 = futureTime(2, 12);
  const quote = await api("/bookings/quote", { method: "POST", body: { roomId: roomBailu.id, memberId: zhangming.id, startTime: start1, endTime: end1 } });
  check("金卡 2 小时试算 136×0.9=122.4", quote.status === 200 && quote.body?.grossAmount === 136 && quote.body?.totalAmount === 122.4);
  const quoteSilver = await api("/bookings/quote", { method: "POST", body: { roomId: roomBailu.id, memberId: wangfang.id, startTime: start1, endTime: end1 } });
  check("银卡同一时段试算 136×0.95=129.2", quoteSilver.body?.totalAmount === 129.2);

  console.log("== 6. 预约下单、扣款与积分 ==");
  const booking1 = await api("/bookings", { method: "POST", body: { roomId: roomBailu.id, memberId: zhangming.id, startTime: start1, endTime: end1 } });
  check("预约成功 201", booking1.status === 201 && booking1.body?.status === "booked");
  check("预约记录含折扣与金额", booking1.body?.discount === 0.9 && booking1.body?.totalAmount === 122.4);
  check("消费积分 +122", booking1.body?.pointsEarned === 122);
  const zhangAfter = await api(`/members/${zhangming.id}`);
  check("张明余额 500-122.4=377.6", Math.abs(zhangAfter.body?.balance - 377.6) < 0.001);
  check("张明积分 120+122=242", zhangAfter.body?.points === 242);

  console.log("== 7. 时段重叠校验 ==");
  const overlap = await api("/bookings", { method: "POST", body: { roomId: roomBailu.id, memberId: wangfang.id, startTime: futureTime(2, 11), endTime: futureTime(2, 13) } });
  check("部分重叠返回 409 与原因", overlap.status === 409 && overlap.body?.message?.includes("时段不能重叠"));
  const contained = await api("/bookings", { method: "POST", body: { roomId: roomBailu.id, memberId: wangfang.id, startTime: futureTime(2, 10, 30), endTime: futureTime(2, 11, 30) } });
  check("包含重叠同样 409", contained.status === 409);
  const adjacent = await api("/bookings", { method: "POST", body: { roomId: roomBailu.id, memberId: wangfang.id, startTime: futureTime(2, 12), endTime: futureTime(2, 14) } });
  check("首尾相接不算重叠，预约成功", adjacent.status === 201);
  const otherRoom = await api("/bookings", { method: "POST", body: { roomId: roomQilin.id, memberId: wangfang.id, startTime: futureTime(2, 11), endTime: futureTime(2, 12) } });
  check("不同包厢同时段互不影响", otherRoom.status === 201);

  console.log("== 8. 失败原因提示 ==");
  const wangNow = await api(`/members/${wangfang.id}`);
  const poor = members.body.find((m) => m.name === "李婷");
  const tooExpensive = await api("/bookings", { method: "POST", body: { roomId: roomQilin.id, memberId: poor.id, startTime: futureTime(3, 10), endTime: futureTime(3, 20) } });
  check("余额不足返回 400 与金额明细", tooExpensive.status === 400 && tooExpensive.body?.message?.includes("余额不足"));
  const past = await api("/bookings", { method: "POST", body: { roomId: roomBailu.id, memberId: zhangming.id, startTime: "2020-01-01T10:00:00.000Z", endTime: "2020-01-01T12:00:00.000Z" } });
  check("过去时间返回 400 与原因", past.status === 400 && past.body?.message?.includes("当前时间"));
  const inverted = await api("/bookings", { method: "POST", body: { roomId: roomBailu.id, memberId: zhangming.id, startTime: futureTime(4, 12), endTime: futureTime(4, 10) } });
  check("结束早于开始返回 400", inverted.status === 400 && inverted.body?.message?.includes("结束时间"));
  const tooShort = await api("/bookings", { method: "POST", body: { roomId: roomBailu.id, memberId: zhangming.id, startTime: futureTime(4, 10), endTime: futureTime(4, 10, 15) } });
  check("不足 30 分钟返回 400", tooShort.status === 400 && tooShort.body?.message?.includes("30 分钟"));
  const maint = await api("/bookings", { method: "POST", body: { roomId: roomMaint.id, memberId: zhangming.id, startTime: futureTime(4, 10), endTime: futureTime(4, 12) } });
  check("维护中包厢返回 400 与原因", maint.status === 400 && maint.body?.message?.includes("维护"));
  const notFound = await api("/members/000000000000000000000000");
  check("不存在的会员返回 404", notFound.status === 404 && notFound.body?.message?.includes("不存在"));
  const unknownRoute = await api("/no-such-route");
  check("未知路由返回 404 JSON", unknownRoute.status === 404 && unknownRoute.body?.message === "接口不存在");

  console.log("== 9. 取消预约、退款与积分回退 ==");
  const wangBefore = await api(`/members/${wangfang.id}`);
  const cancel1 = await api(`/bookings/${adjacent.body.id}/cancel`, { method: "POST" });
  check("取消成功，状态已取消", cancel1.status === 200 && cancel1.body?.status === "cancelled");
  const wangAfterCancel = await api(`/members/${wangfang.id}`);
  check("取消后费用退回余额", Math.abs(wangAfterCancel.body?.balance - wangBefore.body?.balance - adjacent.body.totalAmount) < 0.001);
  check("取消后积分回退", wangAfterCancel.body?.points === wangBefore.body?.points - adjacent.body.pointsEarned);
  const cancelAgain = await api(`/bookings/${adjacent.body.id}/cancel`, { method: "POST" });
  check("重复取消返回 400 与原因", cancelAgain.status === 400 && cancelAgain.body?.message?.includes("已取消"));
  const rebook = await api("/bookings", { method: "POST", body: { roomId: roomBailu.id, memberId: wangfang.id, startTime: futureTime(2, 12), endTime: futureTime(2, 14) } });
  check("取消后的时段可再次预约", rebook.status === 201);

  console.log("== 10. 流水完整性 ==");
  const wangTx = await api(`/members/${wangfang.id}/transactions`);
  const types = wangTx.body.map((t) => t.type);
  check("流水覆盖充值/消费/退款", types.includes("recharge") && types.includes("consume") && types.includes("refund"));
  const consumeTx = wangTx.body.find((t) => t.type === "consume");
  check("消费流水记录积分变动", typeof consumeTx?.pointsDelta === "number" && consumeTx.pointsDelta > 0);
  const refundTx = wangTx.body.find((t) => t.type === "refund");
  check("退款流水积分变动为负", refundTx?.pointsDelta < 0);

  console.log("== 11. 预约列表 ==");
  const bookings = await api("/bookings");
  check("预约列表包含全部记录", bookings.status === 200 && bookings.body.length >= 4);
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
