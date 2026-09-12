/* 包厢预约与会员储值 —— 业务规则测试套件（可重复执行）。
 *
 * 一条命令完成全部检查：
 *   node scripts/business-rules.test.js   （或 npm test）
 *
 * 套件自包含：自动构建后端、在独立数据目录（.mongo-test-data，每轮开始时清空）
 * 启动专用 MongoDB（27018）与后端（29513），执行规则用例，随后分别重启
 * 后端与数据服务验证记录仍在，最后清理进程并汇总。
 *
 * 每条用例归属一条业务规则（R1~R13）；任何断言失败都会在结尾明确指出
 * 被破坏的规则编号与内容，并以非零码退出。
 */
process.env.MONGOMS_DISTRO = process.env.MONGOMS_DISTRO || "ubuntu-22.04";

const { execSync, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { MongoMemoryServer } = require("mongodb-memory-server");

const BACKEND_DIR = path.resolve(__dirname, "..");
const TEST_DB_PATH = path.resolve(BACKEND_DIR, "../.mongo-test-data");
const MONGO_PORT = 27018;
const API_PORT = 29513;
const BASE = `http://localhost:${API_PORT}/api`;

/* ---------------- 规则登记与断言 ---------------- */

const RULES = {
  R1: "预约价格按会员等级折扣计算（普通 1.0 / 银卡 0.95 / 金卡 0.9 / 铂金 0.85）",
  R2: "充值后余额相应增加，非法充值金额被拒绝",
  R3: "累计充值达阈值自动升级（500 银卡 / 2000 金卡），等级只升不降",
  R4: "预约消费后余额按折后金额扣减",
  R5: "消费每 1 元累积 1 积分（向下取整）",
  R6: "同一包厢的预约时段不能重叠（部分/包含重叠拒绝，首尾相接与不同包厢允许）",
  R7: "取消预约后费用全额退回余额、已得积分扣回",
  R8: "已取消的预约不能重复取消",
  R9: "余额不足时预约被拒绝，且余额与预约记录不变",
  R10: "非法预约时间被拒绝（结束不晚于开始、不足 30 分钟、早于当前时间）",
  R11: "维护中的包厢不可预约",
  R12: "充值/消费/退款均写入流水，记录余额与积分变动快照",
  R13: "后端重启、数据服务重启后，会员/预约/流水记录完整可查",
};

let currentRule = "R0";
const ruleResults = new Map(); // ruleId -> { passed, failed }
const failures = []; // { rule, desc, detail }

function rule(id) {
  currentRule = id;
  if (!ruleResults.has(id)) ruleResults.set(id, { passed: 0, failed: 0 });
}

function check(desc, condition, detail = "") {
  const bucket = ruleResults.get(currentRule) ?? { passed: 0, failed: 0 };
  ruleResults.set(currentRule, bucket);
  if (condition) {
    bucket.passed += 1;
    console.log(`    PASS  ${desc}`);
  } else {
    bucket.failed += 1;
    failures.push({ rule: currentRule, desc, detail });
    console.log(`    FAIL  ${desc}${detail ? ` —— ${detail}` : ""}`);
  }
}

function nearlyEqual(a, b) {
  return Math.abs(a - b) < 0.001;
}

/* ---------------- HTTP 与进程编排 ---------------- */

async function api(pathName, options = {}) {
  const response = await fetch(`${BASE}${pathName}`, {
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let mongo = null;
let backend = null;

async function startMongo() {
  // portGeneration:false —— 固定端口；默认行为下 MMS 会把本进程已用过的端口视为
  // “被锁定”而改发随机端口，导致重启后后端连不上原端口（曾因此误判为不重连）。
  mongo = await MongoMemoryServerClass.create({
    binary: { version: "7.0.14" },
    instance: { port: MONGO_PORT, portGeneration: false, dbName: "apptest", storageEngine: "wiredTiger", dbPath: TEST_DB_PATH },
  });
  console.log(`  [环境] MongoDB 已启动 :${MONGO_PORT}（dbPath ${TEST_DB_PATH}）`);
}

async function stopMongo() {
  if (mongo) {
    await mongo.stop();
    mongo = null;
    console.log("  [环境] MongoDB 已停止");
  }
}

async function startBackend() {
  backend = spawn("node", ["dist/index.js"], {
    cwd: BACKEND_DIR,
    env: { ...process.env, DATABASE_URL: `mongodb://127.0.0.1:${MONGO_PORT}/apptest`, PORT: String(API_PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  backend.stdout.on("data", (chunk) => process.stdout.write(`  [后端] ${chunk}`));
  backend.stderr.on("data", (chunk) => process.stdout.write(`  [后端!] ${chunk}`));
  backend.on("error", (error) => console.log(`  [后端!] 启动失败 ${error.message}`));
  const healthy = await waitFor(async () => {
    try {
      const res = await fetch(`http://localhost:${API_PORT}/health`);
      return res.ok;
    } catch {
      return false;
    }
  }, 30000);
  if (!healthy) throw new Error("后端在 30 秒内未就绪");
  console.log(`  [环境] 后端已启动 :${API_PORT}`);
}

async function stopBackend() {
  if (!backend) return;
  const exited = new Promise((resolve) => backend.once("exit", resolve));
  backend.kill("SIGTERM");
  await Promise.race([exited, sleep(8000)]);
  if (backend.exitCode === null && backend.signalCode === null) backend.kill("SIGKILL");
  backend = null;
  console.log("  [环境] 后端已停止");
}

async function waitFor(fn, timeoutMs, intervalMs = 400) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return true;
    await sleep(intervalMs);
  }
  return false;
}

async function waitApiUp() {
  return waitFor(async () => {
    try {
      const res = await fetch(`${BASE}/rooms`);
      return res.ok;
    } catch {
      return false;
    }
  }, 45000);
}

function futureTime(dayOffset, hour, minute = 0) {
  const date = new Date();
  date.setDate(date.getDate() + dayOffset);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

/* ---------------- 规则用例 ---------------- */

async function runRuleTests() {
  console.log("== R1 预约价格按会员等级折扣计算 ==");
  rule("R1");
  const rooms = (await api("/rooms")).body;
  const roomBailu = rooms.find((r) => r.name === "白鹭中包"); // 68 元/小时
  const roomQilin = rooms.find((r) => r.name === "麒麟大包"); // 98 元/小时
  const roomMaint = rooms.find((r) => r.name === "星野主题房"); // 维护中
  check("种子包厢齐全（含维护中包厢）", !!roomBailu && !!roomQilin && !!roomMaint && roomMaint.status === "maintenance");

  const levelFixtures = [
    { level: "NORMAL", discount: 1, total: 136 },
    { level: "SILVER", discount: 0.95, total: 129.2 },
    { level: "GOLD", discount: 0.9, total: 122.4 },
    { level: "PLATINUM", discount: 0.85, total: 115.6 },
  ];
  const quoteStart = futureTime(30, 8);
  const quoteEnd = futureTime(30, 10); // 2 小时 × 68 = 136 原价
  for (const [index, fixture] of levelFixtures.entries()) {
    const created = await api("/members", {
      method: "POST",
      body: { name: `折扣校验${fixture.level}`, phone: `1370000001${index}`, level: fixture.level },
    });
    const quote = await api("/bookings/quote", {
      method: "POST",
      body: { roomId: roomBailu.id, memberId: created.body.id, startTime: quoteStart, endTime: quoteEnd },
    });
    check(
      `${fixture.level} 折扣 ${fixture.discount}，2 小时试算 ¥${fixture.total}`,
      quote.status === 200 && quote.body.discount === fixture.discount && nearlyEqual(quote.body.totalAmount, fixture.total),
      `期望折扣 ${fixture.discount}/¥${fixture.total}，实际 ${quote.body?.discount}/¥${quote.body?.totalAmount}`,
    );
  }

  console.log("== R2 充值与余额 ==");
  rule("R2");
  const memberG = (await api("/members", { method: "POST", body: { name: "规则会员G", phone: "13700000020", level: "NORMAL" } })).body;
  const rechargeBad = await api(`/members/${memberG.id}/recharge`, { method: "POST", body: { amount: 0 } });
  check("充值 0 元返回 400 与原因", rechargeBad.status === 400 && rechargeBad.body?.message?.includes("大于 0"));
  const rechargeNeg = await api(`/members/${memberG.id}/recharge`, { method: "POST", body: { amount: -100 } });
  check("负数充值返回 400", rechargeNeg.status === 400);
  const recharge1 = await api(`/members/${memberG.id}/recharge`, { method: "POST", body: { amount: 200 } });
  check("充值 200 后余额为 200", recharge1.status === 200 && nearlyEqual(recharge1.body.member.balance, 200),
    `实际余额 ${recharge1.body?.member?.balance}`);

  console.log("== R3 累计充值自动升级、只升不降 ==");
  rule("R3");
  const up1 = await api(`/members/${memberG.id}/recharge`, { method: "POST", body: { amount: 300 } });
  check("累计 500 升级银卡", up1.body.member.level === "SILVER" && up1.body.levelUpgraded === true,
    `实际等级 ${up1.body?.member?.level}`);
  const up2 = await api(`/members/${memberG.id}/recharge`, { method: "POST", body: { amount: 1500 } });
  check("累计 2000 升级金卡", up2.body.member.level === "GOLD" && up2.body.levelUpgraded === true);
  const up3 = await api(`/members/${memberG.id}/recharge`, { method: "POST", body: { amount: 100 } });
  check("累计 2100 保持金卡（未达铂金、不降级的边界）", up3.body.member.level === "GOLD" && up3.body.levelUpgraded === false);
  check("升级后折扣同步为 0.9", up3.body.member.discount === 0.9);

  console.log("== R4/R5 预约消费扣款与积分累积 ==");
  rule("R4");
  const memberS = (await api("/members", { method: "POST", body: { name: "规则会员S", phone: "13700000021", level: "NORMAL" } })).body;
  await api(`/members/${memberS.id}/recharge`, { method: "POST", body: { amount: 600 } }); // 累计 600 → 银卡
  const startS = futureTime(5, 10);
  const endS = futureTime(5, 12);
  const bookingG = await api("/bookings", {
    method: "POST",
    body: { roomId: roomBailu.id, memberId: memberG.id, startTime: startS, endTime: endS },
  });
  check("金卡会员预约成功", bookingG.status === 201 && bookingG.body.status === "booked");
  check("折后金额 136×0.9=122.4", nearlyEqual(bookingG.body?.totalAmount, 122.4), `实际 ${bookingG.body?.totalAmount}`);
  const walletG1 = (await api(`/members/${memberG.id}`)).body;
  check("余额 2100-122.4=1977.6", nearlyEqual(walletG1.balance, 1977.6), `实际 ${walletG1.balance}`);
  rule("R5");
  check("积分增加 floor(122.4)=122", bookingG.body?.pointsEarned === 122 && walletG1.points === 122,
    `实际积分 ${walletG1.points}`);

  console.log("== R6 同一包厢时段不能重叠 ==");
  rule("R6");
  const overlapPartial = await api("/bookings", {
    method: "POST",
    body: { roomId: roomBailu.id, memberId: memberS.id, startTime: futureTime(5, 11), endTime: futureTime(5, 13) },
  });
  check("部分重叠返回 409 与冲突说明", overlapPartial.status === 409 && overlapPartial.body?.message?.includes("时段不能重叠"),
    `实际状态码 ${overlapPartial.status}`);
  const overlapContained = await api("/bookings", {
    method: "POST",
    body: { roomId: roomBailu.id, memberId: memberS.id, startTime: futureTime(5, 10, 30), endTime: futureTime(5, 11, 30) },
  });
  check("包含重叠返回 409", overlapContained.status === 409);
  const adjacent = await api("/bookings", {
    method: "POST",
    body: { roomId: roomBailu.id, memberId: memberS.id, startTime: endS, endTime: futureTime(5, 14) },
  });
  check("首尾相接允许预约", adjacent.status === 201, `实际状态码 ${adjacent.status}：${adjacent.body?.message ?? ""}`);
  const otherRoom = await api("/bookings", {
    method: "POST",
    body: { roomId: roomQilin.id, memberId: memberS.id, startTime: startS, endTime: endS },
  });
  check("不同包厢同时段互不影响", otherRoom.status === 201);

  console.log("== R7 取消预约退款与积分回退 ==");
  rule("R7");
  const sBefore = (await api(`/members/${memberS.id}`)).body; // 600 - 129.2(相邻预约) - 186.2(麒麟2h×0.95) = 284.6，积分 129+186=315
  const cancelRes = await api(`/bookings/${adjacent.body.id}/cancel`, { method: "POST" });
  check("取消成功且状态为已取消", cancelRes.status === 200 && cancelRes.body.status === "cancelled");
  const sAfter = (await api(`/members/${memberS.id}`)).body;
  check("费用 129.2 全额退回余额", nearlyEqual(sAfter.balance, sBefore.balance + 129.2),
    `退款前 ${sBefore.balance}，退款后 ${sAfter.balance}`);
  check("已得积分 129 同步扣回", sAfter.points === sBefore.points - 129,
    `退款前积分 ${sBefore.points}，退款后 ${sAfter.points}`);

  console.log("== R8 重复取消被拒绝 ==");
  rule("R8");
  const cancelAgain = await api(`/bookings/${adjacent.body.id}/cancel`, { method: "POST" });
  check("重复取消返回 400 与原因", cancelAgain.status === 400 && cancelAgain.body?.message?.includes("已取消"));
  const sAfterAgain = (await api(`/members/${memberS.id}`)).body;
  check("重复取消不影响余额", nearlyEqual(sAfterAgain.balance, sAfter.balance));

  console.log("== R9 余额不足时预约被拒绝 ==");
  rule("R9");
  const memberP = (await api("/members", { method: "POST", body: { name: "规则会员P", phone: "13700000022", level: "NORMAL" } })).body;
  await api(`/members/${memberP.id}/recharge`, { method: "POST", body: { amount: 100 } });
  const poor = await api("/bookings", {
    method: "POST",
    body: { roomId: roomQilin.id, memberId: memberP.id, startTime: futureTime(6, 10), endTime: futureTime(6, 20) }, // 98×10=980
  });
  check("余额不足返回 400 并说明所需金额", poor.status === 400 && poor.body?.message?.includes("余额不足"),
    `实际状态码 ${poor.status}`);
  const pWallet = (await api(`/members/${memberP.id}`)).body;
  check("失败后余额保持 100 不变", nearlyEqual(pWallet.balance, 100));
  const pBookings = (await api("/bookings")).body.filter((b) => b.memberId === memberP.id);
  check("失败后不产生预约记录", pBookings.length === 0, `实际 ${pBookings.length} 条`);

  console.log("== R10 非法预约时间被拒绝 ==");
  rule("R10");
  const past = await api("/bookings", {
    method: "POST",
    body: { roomId: roomBailu.id, memberId: memberG.id, startTime: "2020-01-01T10:00:00.000Z", endTime: "2020-01-01T12:00:00.000Z" },
  });
  check("过去时间返回 400 与原因", past.status === 400 && past.body?.message?.includes("当前时间"));
  const inverted = await api("/bookings", {
    method: "POST",
    body: { roomId: roomBailu.id, memberId: memberG.id, startTime: futureTime(7, 12), endTime: futureTime(7, 10) },
  });
  check("结束早于开始返回 400", inverted.status === 400 && inverted.body?.message?.includes("结束时间"));
  const tooShort = await api("/bookings", {
    method: "POST",
    body: { roomId: roomBailu.id, memberId: memberG.id, startTime: futureTime(7, 10), endTime: futureTime(7, 10, 15) },
  });
  check("不足 30 分钟返回 400", tooShort.status === 400 && tooShort.body?.message?.includes("30 分钟"));

  console.log("== R11 维护中的包厢不可预约 ==");
  rule("R11");
  const maint = await api("/bookings", {
    method: "POST",
    body: { roomId: roomMaint.id, memberId: memberG.id, startTime: futureTime(8, 10), endTime: futureTime(8, 12) },
  });
  check("维护中包厢返回 400 与原因", maint.status === 400 && maint.body?.message?.includes("维护"));

  console.log("== R12 流水记录完整性 ==");
  rule("R12");
  const gTx = (await api(`/members/${memberG.id}/transactions`)).body;
  check("会员G流水：4 笔充值 + 1 笔消费", gTx.filter((t) => t.type === "recharge").length === 4 && gTx.filter((t) => t.type === "consume").length === 1,
    `实际 ${gTx.map((t) => t.type).join(",")}`);
  const gConsume = gTx.find((t) => t.type === "consume");
  check("消费流水含金额/余额/积分快照", nearlyEqual(gConsume?.amount, 122.4) && nearlyEqual(gConsume?.balanceAfter, 1977.6) && gConsume?.pointsDelta === 122 && gConsume?.pointsAfter === 122);
  const sTx = (await api(`/members/${memberS.id}/transactions`)).body;
  const sRefund = sTx.find((t) => t.type === "refund");
  check("会员S退款流水：金额 129.2、积分变动 -129", nearlyEqual(sRefund?.amount, 129.2) && sRefund?.pointsDelta === -129,
    `实际金额 ${sRefund?.amount}，积分变动 ${sRefund?.pointsDelta}`);
  check("每笔流水均带余额与积分快照", gTx.concat(sTx).every((t) => typeof t.balanceAfter === "number" && typeof t.pointsAfter === "number"));

  return { memberG, memberS, memberP };
}

/* ---------------- R13 重启持久化 ---------------- */

async function snapshotState(memberIds) {
  const state = { members: {}, bookings: null, transactions: {} };
  for (const id of memberIds) {
    const m = (await api(`/members/${id}`)).body;
    state.members[id] = { level: m.level, balance: m.balance, points: m.points, totalRecharged: m.totalRecharged };
    state.transactions[id] = (await api(`/members/${id}/transactions`)).body.map((t) => [t.type, t.amount, t.balanceAfter, t.pointsDelta, t.pointsAfter]);
  }
  state.bookings = (await api("/bookings")).body.map((b) => [b.id, b.status, b.totalAmount, b.pointsEarned]);
  return state;
}

async function verifyStateUnchanged(snapshot, memberIds, stage) {
  const current = await snapshotState(memberIds);
  const same = JSON.stringify(current) === JSON.stringify(snapshot);
  check(`${stage}后会员/预约/流水记录完整一致`, same,
    same ? "" : `快照 ${JSON.stringify(snapshot).length} 字节与当前不一致`);
  return same;
}

/* ---------------- 主流程 ---------------- */

let MongoMemoryServerClass;

async function main() {
  console.log("构建后端（确保测试的是最新代码）…");
  execSync("npm run build", { cwd: BACKEND_DIR, stdio: "inherit" });

  console.log("准备独立测试数据目录（每轮清空，保证可重复执行）…");
  fs.rmSync(TEST_DB_PATH, { recursive: true, force: true });
  fs.mkdirSync(TEST_DB_PATH, { recursive: true });

  ({ MongoMemoryServer: MongoMemoryServerClass } = require("mongodb-memory-server"));

  await startMongo();
  await startBackend();

  try {
    await runRuleTests();
  } catch (error) {
    failures.push({ rule: currentRule, desc: "用例执行异常", detail: error.message });
  }

  // R13：重启持久化（会员G/S/P 为本轮创建的关键数据）
  console.log("== R13 重启后记录仍在 ==");
  rule("R13");
  try {
    const memberIds = (await api("/members")).body
      .filter((m) => ["规则会员G", "规则会员S", "规则会员P"].includes(m.name))
      .map((m) => m.id);
    check("重启前确认 3 名规则会员存在", memberIds.length === 3, `实际 ${memberIds.length}`);
    const snapshot = await snapshotState(memberIds);
    check(`重启前快照完成（会员 ${memberIds.length} 名、预约 ${snapshot.bookings.length} 条）`, snapshot.bookings.length === 3,
      `实际预约 ${snapshot.bookings.length} 条`);

    await stopBackend();
    await startBackend();
    await verifyStateUnchanged(snapshot, memberIds, "后端重启");

    await stopMongo();
    await startMongo();
    const reconnected = await waitApiUp();
    check("数据服务重启后后端自动恢复连接", reconnected);
    if (reconnected) {
      await verifyStateUnchanged(snapshot, memberIds, "数据服务重启");
    }
  } catch (error) {
    failures.push({ rule: "R13", desc: "重启验证执行异常", detail: error.message });
  }
}

async function cleanup() {
  await stopBackend().catch(() => {});
  await stopMongo().catch(() => {});
}

main()
  .catch((error) => {
    failures.push({ rule: "ENV", desc: "测试环境搭建失败", detail: error.message });
  })
  .finally(async () => {
    await cleanup();
    console.log("\n========== 测试报告 ==========");
    let totalPass = 0;
    let totalFail = 0;
    for (const [id, title] of Object.entries(RULES)) {
      const result = ruleResults.get(id);
      const pass = result?.passed ?? 0;
      const fail = result?.failed ?? 0;
      totalPass += pass;
      totalFail += fail;
      const mark = fail > 0 ? "✗ 被破坏" : pass > 0 ? "✓ 通过" : "- 未执行";
      console.log(`  ${id} [${mark}] ${title}（${pass} 通过 / ${fail} 失败）`);
    }
    if (failures.length > 0) {
      console.log("\n被破坏的业务规则：");
      for (const f of failures) {
        console.log(`  ✗ ${f.rule}：${RULES[f.rule] ?? "环境/其他"}`);
        console.log(`      用例：${f.desc}${f.detail ? ` —— ${f.detail}` : ""}`);
      }
    }
    console.log(`\n合计：${totalPass} 通过，${totalFail} 失败`);
    process.exit(totalFail > 0 ? 1 : 0);
  });
