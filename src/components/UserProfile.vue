<template>
  <div class="user-profile">
    <section class="profile-card">
      <div class="profile-avatar">
        <img v-if="user.avatar" :src="user.avatar" :alt="displayName" />
        <var-icon v-else name="account-circle" />
      </div>

      <div class="profile-summary">
        <h2>{{ displayName }}</h2>
        <p>{{ user.username || '暂未设置账号' }}</p>
      </div>
    </section>

    <section class="profile-details">
      <h3>基本资料</h3>
      <dl>
        <div>
          <dt>昵称</dt>
          <dd>{{ user.nickname || '暂未设置' }}</dd>
        </div>
        <div>
          <dt>账号</dt>
          <dd>{{ user.username || '暂未设置' }}</dd>
        </div>
        <div>
          <dt>用户编号</dt>
          <dd>{{ user.id || '暂未同步' }}</dd>
        </div>
      </dl>
    </section>
  </div>
</template>

<script setup>
import { computed, onMounted } from 'vue'
import { useGlobalStore } from '@/stores/global'

const globalStore = useGlobalStore()
const user = computed(() => globalStore.user)
const displayName = computed(() => user.value.nickname || user.value.username || '微信用户')

onMounted(() => {
  globalStore.setTitle('个人中心')
  globalStore.setShowBack(false)
  globalStore.setShowMore(false)
})
</script>

<style scoped>
.user-profile {
  flex: 1;
  overflow: auto;
  padding: 16px;
  background: var(--color-body);
}

.profile-card,
.profile-details {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 4px 16px rgba(35, 28, 20, 0.08);
}

.profile-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 24px;
  margin-bottom: 16px;
}

.profile-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 72px;
  height: 72px;
  overflow: hidden;
  flex: 0 0 72px;
  border-radius: 50%;
  background: #e0e7ff;
  color: #4f46e5;
  font-size: 72px;
}

.profile-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.profile-summary h2,
.profile-details h3 {
  margin: 0;
  color: var(--color-text);
}

.profile-summary p {
  margin: 6px 0 0;
  color: var(--color-text-secondary);
}

.profile-details {
  padding: 20px;
}

.profile-details h3 {
  font-size: 17px;
}

.profile-details dl {
  margin: 12px 0 0;
}

.profile-details dl div {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 0;
  border-bottom: 1px solid #f1f5f9;
}

.profile-details dl div:last-child {
  border-bottom: 0;
}

.profile-details dt {
  color: var(--color-text-secondary);
}

.profile-details dd {
  margin: 0;
  color: var(--color-text);
  text-align: right;
  word-break: break-all;
}
</style>
