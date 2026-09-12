<script setup lang="ts">
import { ElMessage, ElMessageBox } from "element-plus";
import { computed, onMounted, ref, watch } from "vue";
import {
  cancelBooking,
  createBooking,
  fetchBookings,
  fetchRooms,
  quoteBooking,
} from "../api/client";
import type { Booking, BookingQuote, Member, Room } from "../types";

const props = defineProps<{ members: Member[] }>();

const rooms = ref<Room[]>([]);
const bookings = ref<Booking[]>([]);
const loadingRooms = ref(false);
const loadingBookings = ref(false);
const loadError = ref("");

const form = ref<{ memberId: string; roomId: string; range: [Date, Date] | null }>({
  memberId: "",
  roomId: "",
  range: null,
});
const quote = ref<BookingQuote | null>(null);
const quoteError = ref("");
const quoting = ref(false);
const submitting = ref(false);
const cancellingId = ref("");

const availableRooms = computed(() => rooms.value.filter((room) => room.status === "available"));

const activeBookings = computed(() => bookings.value.filter((booking) => booking.status === "booked"));

function formatTime(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getMonth() + 1}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

async function loadRooms() {
  loadingRooms.value = true;
  loadError.value = "";
  try {
    rooms.value = await fetchRooms();
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : "包厢列表加载失败";
    ElMessage.error(loadError.value);
  } finally {
    loadingRooms.value = false;
  }
}

async function loadBookings() {
  loadingBookings.value = true;
  try {
    bookings.value = await fetchBookings();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "预约记录加载失败");
  } finally {
    loadingBookings.value = false;
  }
}

let quoteTimer: ReturnType<typeof setTimeout> | undefined;
watch(
  () => [form.value.memberId, form.value.roomId, form.value.range],
  () => {
    quote.value = null;
    quoteError.value = "";
    if (quoteTimer) clearTimeout(quoteTimer);
    const { memberId, roomId, range } = form.value;
    if (!memberId || !roomId || !range || !range[0] || !range[1]) return;
    quoteTimer = setTimeout(async () => {
      quoting.value = true;
      try {
        quote.value = await quoteBooking({
          memberId,
          roomId,
          startTime: range[0].toISOString(),
          endTime: range[1].toISOString(),
        });
      } catch (error) {
        quoteError.value = error instanceof Error ? error.message : "价格试算失败";
      } finally {
        quoting.value = false;
      }
    }, 350);
  },
  { deep: true },
);

async function submitBooking() {
  if (submitting.value) return;
  const { memberId, roomId, range } = form.value;
  if (!memberId || !roomId || !range || !range[0] || !range[1]) {
    ElMessage.warning("请完整选择会员、包厢和预约时段");
    return;
  }
  submitting.value = true;
  try {
    const booking = await createBooking({
      memberId,
      roomId,
      startTime: range[0].toISOString(),
      endTime: range[1].toISOString(),
    });
    ElMessage.success(
      `预约成功：${booking.roomName} ${formatTime(booking.startTime)} 起，实付 ¥${booking.totalAmount.toFixed(2)}，积分 +${booking.pointsEarned}`,
    );
    form.value.range = null;
    quote.value = null;
    await loadBookings();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "预约失败");
    await loadBookings();
  } finally {
    submitting.value = false;
  }
}

async function submitCancel(booking: Booking) {
  try {
    await ElMessageBox.confirm(
      `确定取消 ${booking.memberName} 在「${booking.roomName}」${formatTime(booking.startTime)} 的预约吗？费用 ¥${booking.totalAmount.toFixed(2)} 将退回会员余额。`,
      "取消预约",
      { confirmButtonText: "确定取消", cancelButtonText: "再想想", type: "warning" },
    );
  } catch {
    return;
  }
  cancellingId.value = booking.id;
  try {
    await cancelBooking(booking.id);
    ElMessage.success("预约已取消，费用已退回会员余额");
    await loadBookings();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "取消失败");
  } finally {
    cancellingId.value = "";
  }
}

defineExpose({ reload: loadBookings });

onMounted(async () => {
  await Promise.all([loadRooms(), loadBookings()]);
});
</script>

<template>
  <section class="work-panel booking-panel">
    <h2>包厢预约</h2>
    <p class="panel-tip">选择会员与包厢时段即可预约，费用按会员等级折扣从储值余额扣除，消费 1 元积 1 分；同一包厢时段不可重叠。</p>

    <el-alert
      v-if="loadError"
      :title="`包厢数据加载失败：${loadError}`"
      type="error"
      :closable="false"
      class="panel-alert"
    />

    <div class="room-strip" v-loading="loadingRooms">
      <article v-for="room in rooms" :key="room.id" class="room-card" :class="{ disabled: room.status !== 'available' }">
        <div class="room-head">
          <strong>{{ room.name }}</strong>
          <el-tag :type="room.status === 'available' ? 'success' : 'info'" size="small">
            {{ room.status === "available" ? "可预约" : "维护中" }}
          </el-tag>
        </div>
        <p class="room-desc">{{ room.description }}</p>
        <p class="room-meta">容纳 {{ room.capacity }} 人 · ¥{{ room.hourlyRate }}/小时</p>
        <div class="room-facilities">
          <el-tag v-for="item in room.facilities" :key="item" size="small" effect="plain">{{ item }}</el-tag>
        </div>
      </article>
    </div>

    <div class="booking-layout">
      <el-card shadow="never" class="booking-form-card">
        <template #header>发起预约</template>
        <el-form label-position="top">
          <el-form-item label="预约会员">
            <el-select v-model="form.memberId" style="width: 100%" placeholder="选择会员（按等级折扣）">
              <el-option
                v-for="member in props.members"
                :key="member.id"
                :label="`${member.name}（${member.levelName} ${member.discount * 10} 折，余额 ¥${member.balance.toFixed(2)}）`"
                :value="member.id"
              />
            </el-select>
            <p v-if="props.members.length === 0" class="form-hint">暂无会员，请先在「会员储值」页创建会员并充值。</p>
          </el-form-item>
          <el-form-item label="选择包厢">
            <el-select v-model="form.roomId" style="width: 100%" placeholder="选择包厢">
              <el-option
                v-for="room in availableRooms"
                :key="room.id"
                :label="`${room.name}（${room.capacity} 人，¥${room.hourlyRate}/小时）`"
                :value="room.id"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="预约时段">
            <el-date-picker
              v-model="form.range"
              type="datetimerange"
              range-separator="至"
              start-placeholder="开始时间"
              end-placeholder="结束时间"
              :step="600"
              style="width: 100%"
            />
          </el-form-item>

          <div v-if="quoting" class="quote-box">价格试算中…</div>
          <el-alert v-else-if="quoteError" :title="quoteError" type="error" :closable="false" class="quote-box" />
          <div v-else-if="quote" class="quote-box quote-detail">
            <span>时长 {{ quote.hours }} 小时 × ¥{{ quote.unitPrice }}/小时 = ¥{{ quote.grossAmount.toFixed(2) }}</span>
            <span>{{ quote.levelName }} {{ quote.discount * 10 }} 折</span>
            <strong>应付 ¥{{ quote.totalAmount.toFixed(2) }}</strong>
            <el-alert
              v-if="!quote.balanceSufficient"
              :title="`余额不足：当前余额 ¥${quote.balance.toFixed(2)}，请先到「会员储值」页充值`"
              type="warning"
              :closable="false"
            />
          </div>

          <el-button
            type="primary"
            size="large"
            style="width: 100%"
            :loading="submitting"
            :disabled="!quote || !quote.balanceSufficient"
            @click="submitBooking"
          >
            确认预约并扣款
          </el-button>
        </el-form>
      </el-card>

      <div class="booking-list" v-loading="loadingBookings">
        <h3>预约记录（进行中 {{ activeBookings.length }} 条）</h3>
        <el-table :data="bookings" style="width: 100%" size="default">
          <el-table-column label="包厢" width="110">
            <template #default="{ row }">{{ row.roomName }}</template>
          </el-table-column>
          <el-table-column label="会员" width="90">
            <template #default="{ row }">{{ row.memberName }}</template>
          </el-table-column>
          <el-table-column label="时段" min-width="180">
            <template #default="{ row }">{{ formatTime(row.startTime) }} ~ {{ formatTime(row.endTime) }}</template>
          </el-table-column>
          <el-table-column label="折后金额" width="100">
            <template #default="{ row }">¥{{ row.totalAmount.toFixed(2) }}</template>
          </el-table-column>
          <el-table-column label="积分" width="70">
            <template #default="{ row }">+{{ row.pointsEarned }}</template>
          </el-table-column>
          <el-table-column label="状态" width="90">
            <template #default="{ row }">
              <el-tag :type="row.status === 'booked' ? 'success' : 'info'" size="small">
                {{ row.status === "booked" ? "已预约" : "已取消" }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="100" fixed="right">
            <template #default="{ row }">
              <el-button
                v-if="row.status === 'booked'"
                type="danger"
                size="small"
                plain
                :loading="cancellingId === row.id"
                @click="submitCancel(row)"
              >
                取消
              </el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-empty v-if="!loadingBookings && bookings.length === 0" description="暂无预约记录" />
      </div>
    </div>
  </section>
</template>

<style scoped>
.booking-panel h2 {
  margin-top: 0;
}

.panel-tip {
  color: color-mix(in srgb, #19212e 68%, #3268b8 32%);
  line-height: 1.7;
}

.panel-alert {
  margin-bottom: 16px;
}

.room-strip {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 14px;
  margin-bottom: 22px;
}

.room-card {
  border: 1px solid color-mix(in srgb, #19212e 13%, transparent);
  border-radius: 8px;
  padding: 16px;
  background: color-mix(in srgb, #f4f7fb 86%, white 14%);
}

.room-card.disabled {
  opacity: 0.55;
}

.room-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.room-desc {
  margin: 8px 0 4px;
  font-size: 13px;
  color: color-mix(in srgb, #19212e 66%, #3268b8 34%);
}

.room-meta {
  margin: 4px 0 8px;
  font-weight: 700;
}

.room-facilities {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.booking-layout {
  display: grid;
  grid-template-columns: minmax(300px, 0.9fr) minmax(0, 1.4fr);
  gap: 18px;
  align-items: start;
}

.booking-form-card :deep(.el-card__header) {
  font-weight: 700;
}

.form-hint {
  margin: 6px 0 0;
  font-size: 12px;
  color: #cf5c36;
}

.quote-box {
  margin-bottom: 14px;
  border-radius: 6px;
  padding: 10px 12px;
  background: color-mix(in srgb, #3268b8 10%, transparent);
}

.quote-detail {
  display: grid;
  gap: 6px;
}

.quote-detail strong {
  font-size: 18px;
}

.booking-list h3 {
  margin-top: 0;
  font-size: 17px;
}

@media (max-width: 960px) {
  .booking-layout {
    grid-template-columns: 1fr;
  }
}
</style>
