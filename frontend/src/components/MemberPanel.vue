<script setup lang="ts">
import { ElMessage } from "element-plus";
import { computed, onMounted, ref } from "vue";
import {
  createMember,
  fetchMembers,
  fetchMemberTransactions,
  rechargeMember,
} from "../api/client";
import type { Member, WalletTransaction } from "../types";

const emit = defineEmits<{ (event: "members-changed"): void }>();

const members = ref<Member[]>([]);
const transactions = ref<WalletTransaction[]>([]);
const selectedMemberId = ref("");
const loadingMembers = ref(false);
const loadingTransactions = ref(false);
const loadError = ref("");

const newMember = ref({ name: "", phone: "", level: "NORMAL" });
const creating = ref(false);

const rechargeForm = ref({ memberId: "", amount: 100 });
const recharging = ref(false);

const levelOptions = [
  { value: "NORMAL", label: "普通会员（无折扣）" },
  { value: "SILVER", label: "银卡会员（9.5 折）" },
  { value: "GOLD", label: "金卡会员（9 折）" },
  { value: "PLATINUM", label: "铂金会员（8.5 折）" },
];

const selectedMember = computed(() =>
  members.value.find((member) => member.id === selectedMemberId.value),
);

const transactionTypeLabels: Record<WalletTransaction["type"], string> = {
  recharge: "充值",
  consume: "消费",
  refund: "退款",
};

function transactionTypeLabel(type: WalletTransaction["type"]): string {
  return transactionTypeLabels[type] ?? type;
}

function levelTagType(level: string): "success" | "warning" | "danger" | "info" {
  if (level === "PLATINUM") return "danger";
  if (level === "GOLD") return "warning";
  if (level === "SILVER") return "success";
  return "info";
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

async function loadMembers() {
  loadingMembers.value = true;
  loadError.value = "";
  try {
    members.value = await fetchMembers();
    if (members.value.length > 0 && !selectedMemberId.value) {
      selectedMemberId.value = members.value[0].id;
      await loadTransactions();
    }
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : "会员列表加载失败";
    ElMessage.error(loadError.value);
  } finally {
    loadingMembers.value = false;
  }
}

async function loadTransactions() {
  if (!selectedMemberId.value) {
    transactions.value = [];
    return;
  }
  loadingTransactions.value = true;
  try {
    transactions.value = await fetchMemberTransactions(selectedMemberId.value);
  } catch (error) {
    transactions.value = [];
    ElMessage.error(error instanceof Error ? error.message : "流水加载失败");
  } finally {
    loadingTransactions.value = false;
  }
}

async function submitCreateMember() {
  if (creating.value) return;
  creating.value = true;
  try {
    const created = await createMember({
      name: newMember.value.name.trim(),
      phone: newMember.value.phone.trim(),
      level: newMember.value.level,
    });
    ElMessage.success(`会员「${created.name}」创建成功`);
    newMember.value = { name: "", phone: "", level: "NORMAL" };
    await loadMembers();
    selectedMemberId.value = created.id;
    await loadTransactions();
    emit("members-changed");
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "创建会员失败");
  } finally {
    creating.value = false;
  }
}

async function submitRecharge() {
  if (recharging.value) return;
  if (!rechargeForm.value.memberId) {
    ElMessage.warning("请先选择要充值的会员");
    return;
  }
  recharging.value = true;
  try {
    const result = await rechargeMember(rechargeForm.value.memberId, Number(rechargeForm.value.amount));
    if (result.levelUpgraded) {
      ElMessage.success(`充值成功，会员已升级为${result.levelName}！当前余额 ¥${result.member.balance.toFixed(2)}`);
    } else {
      ElMessage.success(`充值成功，当前余额 ¥${result.member.balance.toFixed(2)}`);
    }
    await loadMembers();
    if (selectedMemberId.value === rechargeForm.value.memberId) {
      await loadTransactions();
    }
    emit("members-changed");
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "充值失败");
  } finally {
    recharging.value = false;
  }
}

async function selectMember(memberId: string) {
  selectedMemberId.value = memberId;
  await loadTransactions();
}

defineExpose({ reload: loadMembers });

onMounted(loadMembers);
</script>

<template>
  <section class="work-panel member-panel">
    <h2>会员储值</h2>
    <p class="panel-tip">会员充值后可在下方查看余额与积分；累计充值达 500 / 2000 / 5000 元自动升级银卡 / 金卡 / 铂金会员，预约包厢享 9.5 / 9 / 8.5 折。</p>

    <el-alert
      v-if="loadError"
      :title="`会员数据加载失败：${loadError}`"
      type="error"
      :closable="false"
      class="panel-alert"
    />

    <div class="member-layout">
      <div class="member-list" v-loading="loadingMembers">
        <el-table
          :data="members"
          style="width: 100%"
          size="large"
          highlight-current-row
          @current-change="(row: Member | null) => row && selectMember(row.id)"
        >
          <el-table-column prop="name" label="姓名" width="90" />
          <el-table-column prop="phone" label="手机号" width="130" />
          <el-table-column label="等级" width="110">
            <template #default="{ row }">
              <el-tag :type="levelTagType(row.level)" size="small">{{ row.levelName }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="余额" width="100">
            <template #default="{ row }">¥{{ row.balance.toFixed(2) }}</template>
          </el-table-column>
          <el-table-column prop="points" label="积分" width="80" />
          <el-table-column label="累计充值" min-width="100">
            <template #default="{ row }">¥{{ row.totalRecharged.toFixed(2) }}</template>
          </el-table-column>
        </el-table>
        <el-empty v-if="!loadingMembers && members.length === 0" description="暂无会员，请先新增会员" />
      </div>

      <div class="member-side">
        <el-card shadow="never" class="side-card">
          <template #header>新增会员</template>
          <el-form label-position="top" size="default">
            <el-form-item label="姓名">
              <el-input v-model="newMember.name" maxlength="32" placeholder="会员姓名" />
            </el-form-item>
            <el-form-item label="手机号">
              <el-input v-model="newMember.phone" maxlength="11" placeholder="11 位手机号" />
            </el-form-item>
            <el-form-item label="初始等级">
              <el-select v-model="newMember.level" style="width: 100%">
                <el-option
                  v-for="option in levelOptions"
                  :key="option.value"
                  :label="option.label"
                  :value="option.value"
                />
              </el-select>
            </el-form-item>
            <el-button type="primary" :loading="creating" style="width: 100%" @click="submitCreateMember">
              创建会员
            </el-button>
          </el-form>
        </el-card>

        <el-card shadow="never" class="side-card">
          <template #header>会员充值</template>
          <el-form label-position="top" size="default">
            <el-form-item label="选择会员">
              <el-select v-model="rechargeForm.memberId" style="width: 100%" placeholder="选择会员">
                <el-option
                  v-for="member in members"
                  :key="member.id"
                  :label="`${member.name}（${member.levelName}，余额 ¥${member.balance.toFixed(2)}）`"
                  :value="member.id"
                />
              </el-select>
            </el-form-item>
            <el-form-item label="充值金额（元）">
              <el-input-number v-model="rechargeForm.amount" :min="1" :max="1000000" :precision="2" style="width: 100%" />
            </el-form-item>
            <el-button type="warning" :loading="recharging" style="width: 100%" @click="submitRecharge">
              确认充值
            </el-button>
          </el-form>
        </el-card>
      </div>
    </div>

    <div class="transaction-block">
      <h3>
        储值与积分流水
        <span v-if="selectedMember">— {{ selectedMember.name }}（余额 ¥{{ selectedMember.balance.toFixed(2) }}，积分 {{ selectedMember.points }}）</span>
      </h3>
      <el-table :data="transactions" style="width: 100%" size="default" v-loading="loadingTransactions">
        <el-table-column label="时间" width="160">
          <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="类型" width="80">
          <template #default="{ row }">
            <el-tag
              :type="row.type === 'recharge' ? 'success' : row.type === 'consume' ? 'warning' : 'info'"
              size="small"
            >
              {{ transactionTypeLabel(row.type) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="金额" width="110">
          <template #default="{ row }">
            {{ row.type === "consume" ? "-" : "+" }}¥{{ row.amount.toFixed(2) }}
          </template>
        </el-table-column>
        <el-table-column label="余额" width="110">
          <template #default="{ row }">¥{{ row.balanceAfter.toFixed(2) }}</template>
        </el-table-column>
        <el-table-column label="积分变动" width="90">
          <template #default="{ row }">
            <span :class="row.pointsDelta > 0 ? 'points-up' : row.pointsDelta < 0 ? 'points-down' : ''">
              {{ row.pointsDelta > 0 ? `+${row.pointsDelta}` : row.pointsDelta }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="积分余额" width="90">
          <template #default="{ row }">{{ row.pointsAfter }}</template>
        </el-table-column>
        <el-table-column prop="note" label="备注" min-width="220" show-overflow-tooltip />
      </el-table>
      <el-empty
        v-if="!loadingTransactions && transactions.length === 0"
        :description="selectedMember ? '该会员暂无流水记录' : '点击上方会员查看其流水'"
      />
    </div>
  </section>
</template>

<style scoped>
.member-panel h2 {
  margin-top: 0;
}

.panel-tip {
  color: color-mix(in srgb, #19212e 68%, #3268b8 32%);
  line-height: 1.7;
}

.panel-alert {
  margin-bottom: 16px;
}

.member-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(260px, 0.8fr);
  gap: 18px;
  align-items: start;
}

.member-side {
  display: grid;
  gap: 18px;
}

.side-card :deep(.el-card__header) {
  font-weight: 700;
}

.transaction-block {
  margin-top: 26px;
}

.transaction-block h3 {
  font-size: 17px;
}

.transaction-block h3 span {
  font-weight: 400;
  color: color-mix(in srgb, #19212e 66%, #3268b8 34%);
}

.points-up {
  color: #2c8a4b;
  font-weight: 700;
}

.points-down {
  color: #cf5c36;
  font-weight: 700;
}

@media (max-width: 960px) {
  .member-layout {
    grid-template-columns: 1fr;
  }
}
</style>
