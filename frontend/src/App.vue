<script setup lang="ts">
import { ElMessage } from "element-plus";
import { onMounted, ref } from "vue";
import { fetchMembers, fetchOverview } from "./api/client";
import { APP_CODE, APP_NAME } from "./constants/app";
import { REQUEST_MESSAGES } from "./constants/messages";
import { createFallbackOverview } from "./state/dashboard";
import type { Member, OverviewResponse } from "./types";
import BookingPanel from "./components/BookingPanel.vue";
import FeatureStrip from "./components/FeatureStrip.vue";
import MemberPanel from "./components/MemberPanel.vue";
import MetricGrid from "./components/MetricGrid.vue";
import OperationsTable from "./components/OperationsTable.vue";

type ViewKey = "overview" | "booking" | "member";

const overview = ref<OverviewResponse>(createFallbackOverview());
const notice = ref(REQUEST_MESSAGES.overviewFallback);
const activeView = ref<ViewKey>("overview");
const members = ref<Member[]>([]);

const viewEntries: Array<{ key: ViewKey; label: string }> = [
  { key: "overview", label: "运营总览" },
  { key: "booking", label: "包厢预约" },
  { key: "member", label: "会员储值" },
];

function goHealth() {
  window.location.href = REQUEST_MESSAGES.healthPath;
}

async function loadMembers() {
  try {
    members.value = await fetchMembers();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "会员列表加载失败");
  }
}

onMounted(async () => {
  try {
    overview.value = await fetchOverview();
    notice.value = "后端服务已联通，当前展示实时接口数据。";
  } catch {
    notice.value = REQUEST_MESSAGES.overviewFallback;
  }
  await loadMembers();
});
</script>

<template>
  <main class="app-shell">
    <header class="topbar">
      <div>
        <span class="brand-code">{{ APP_CODE }}</span>
        <h1 class="brand-title">{{ APP_NAME }}</h1>
      </div>
      <el-button type="primary" @click="goHealth">API Health</el-button>
    </header>
    <nav class="view-nav" aria-label="功能入口">
      <button
        v-for="entry in viewEntries"
        :key="entry.key"
        type="button"
        class="view-nav-item"
        :class="{ active: activeView === entry.key }"
        @click="activeView = entry.key"
      >
        {{ entry.label }}
      </button>
    </nav>
    <section v-show="activeView === 'overview'" class="workspace">
      <div class="lead-grid">
        <article class="hero-panel">
          <span class="pill">{{ notice }}</span>
          <h2>{{ overview.appName }}</h2>
          <p>{{ overview.description }}</p>
        </article>
        <MetricGrid :items="overview.kpis" />
      </div>
      <FeatureStrip :items="overview.features" />
      <section class="work-panel">
        <h2>运营任务流</h2>
        <OperationsTable :records="overview.records" />
      </section>
    </section>
    <section v-if="activeView === 'booking'" class="workspace">
      <BookingPanel :members="members" />
    </section>
    <section v-if="activeView === 'member'" class="workspace">
      <MemberPanel @members-changed="loadMembers" />
    </section>
  </main>
</template>
