<template>
  <main class="guest-demo">
    <header class="demo-header">
      <RouterLink class="back-link" to="/">← 返回首页</RouterLink>
      <RouterLink class="login-link" to="/juyiting">登录进入聚义厅</RouterLink>
    </header>

    <section class="demo-intro">
      <p class="eyebrow">访客体验 · 全程本地模拟</p>
      <h1>用四步，看看一支 AI 小队怎样把任务推进下去。</h1>
      <p>无需登录，不会读取账号信息，也不会发送任何工作请求。</p>
    </section>

    <ol class="stepper" aria-label="体验步骤">
      <li
        v-for="step in guestDemoSteps"
        :key="step.id"
        :class="{ active: currentStep === step.id, complete: currentStep > step.id }"
        :aria-current="currentStep === step.id ? 'step' : undefined"
      >
        <span>{{ step.id }}</span>{{ step.label }}
      </li>
    </ol>

    <section class="demo-workspace" aria-live="polite">
      <div v-if="currentStep === 1" class="template-stage">
        <div class="stage-copy">
          <p class="eyebrow">第一步</p>
          <h2>选择一个你想推进的任务。</h2>
          <p>每个模板都使用本地示例数据，方便你直接查看协作过程。</p>
        </div>
        <div class="template-grid">
          <button
            v-for="template in guestDemoTemplates"
            :key="template.id"
            class="template-card"
            :class="{ selected: selectedTemplate.id === template.id }"
            :aria-pressed="selectedTemplate.id === template.id"
            type="button"
            @click="selectedTemplate = template"
          >
            <span>{{ template.eyebrow }}</span>
            <strong>{{ template.title }}</strong>
            <small>{{ template.prompt }}</small>
          </button>
        </div>
        <button class="next-action" type="button" @click="currentStep = 2">
          请系统推荐帮手
        </button>
      </div>

      <div v-else-if="currentStep === 2" class="recommendation-stage">
        <p class="eyebrow">第二步</p>
        <h2>系统已为「{{ selectedTemplate.eyebrow }}」推荐三位帮手。</h2>
        <p class="stage-description">推荐依据是任务目标、所需工作方式和结果形式；这里展示的是模拟推荐，不会连接真实聚义厅。</p>
        <ul class="agent-list">
          <li v-for="(agent, index) in selectedTemplate.agents" :key="agent.name">
            <span>{{ String(index + 1).padStart(2, '0') }}</span>
            <div><strong>{{ agent.name }}</strong><small>{{ agent.role }}</small></div>
          </li>
        </ul>
        <div class="stage-actions">
          <button class="quiet-action" type="button" @click="currentStep = 1">更换任务</button>
          <button class="next-action" type="button" @click="currentStep = 3">查看模拟执行</button>
        </div>
      </div>

      <div v-else-if="currentStep === 3" class="execution-stage">
        <p class="eyebrow">第三步</p>
        <h2>任务正在按清晰分工推进。</h2>
        <div class="execution-list">
          <div v-for="(item, index) in selectedTemplate.execution" :key="item" class="execution-item">
            <span>{{ index + 1 }}</span>
            <div><strong>{{ item }}</strong><small>{{ index === 2 ? '已完成 · 等待汇总' : '已完成 · 已交给下一位帮手' }}</small></div>
          </div>
        </div>
        <button class="next-action" type="button" @click="currentStep = 4">查看可复用结果</button>
      </div>

      <div v-else class="result-stage">
        <p class="eyebrow">第四步</p>
        <h2>{{ selectedTemplate.result.title }}</h2>
        <p class="stage-description">{{ selectedTemplate.result.summary }}</p>
        <div class="result-card">
          <span>可继续使用的成果</span>
          <ul>
            <li v-for="item in selectedTemplate.result.items" :key="item">{{ item }}</li>
          </ul>
        </div>
        <div class="stage-actions">
          <button class="quiet-action" type="button" @click="restart">换一个模板</button>
          <RouterLink class="next-action link-action" to="/juyiting">登录后创建真实任务</RouterLink>
        </div>
      </div>
    </section>

    <p class="guest-note">这是独立的访客演示：所有内容都保存在当前页面内，不会发起登录、授权或受保护的 API 请求。</p>
  </main>
</template>

<script setup>
import { ref } from 'vue'
import { guestDemoSteps, guestDemoTemplates } from '@/constants/publicBetaDemo'

const selectedTemplate = ref(guestDemoTemplates[0])
const currentStep = ref(1)

const restart = () => {
  currentStep.value = 1
}
</script>

<style scoped>
.guest-demo {
  box-sizing: border-box;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  min-height: 100%;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 28px clamp(20px, 6vw, 96px) 44px;
  color: #162421;
  background: linear-gradient(155deg, #edf4eb 0%, #f9f6ee 43%, #f4ead4 100%);
}

.demo-header,
.demo-intro,
.stepper,
.demo-workspace,
.guest-note {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  max-width: 1050px;
  margin-right: auto;
  margin-left: auto;
}

.demo-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.back-link,
.login-link {
  max-width: 100%;
  color: #285a50;
  font-size: 14px;
  font-weight: 750;
  text-decoration: none;
}

.demo-intro {
  max-width: 760px;
  padding: clamp(48px, 9vw, 98px) 0 36px;
}

.eyebrow {
  margin: 0 0 12px;
  color: #2e6854;
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.07em;
}

h1,
h2,
p {
  margin-top: 0;
}

h1 {
  min-width: 0;
  margin-bottom: 18px;
  font-size: clamp(34px, 5vw, 58px);
  line-height: 1.1;
  letter-spacing: -0.052em;
}

.demo-intro > p:last-child,
.stage-description,
.guest-note {
  color: #5f6a65;
  line-height: 1.75;
}

.stepper {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  padding: 0;
  margin-bottom: 28px;
  list-style: none;
}

.stepper li {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 48px;
  color: #59645e;
  font-size: 13px;
  font-weight: 650;
}

.stepper span {
  display: inline-grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: 1px solid #c3cbc0;
  border-radius: 50%;
  color: #6a746e;
}

.stepper .active,
.stepper .complete {
  color: #1e5749;
}

.stepper .active span,
.stepper .complete span {
  border-color: #1e5749;
  color: #fff;
  background: #1e5749;
}

.demo-workspace {
  min-height: 420px;
  padding: clamp(24px, 5vw, 54px);
  border: 1px solid rgba(42, 83, 72, 0.16);
  border-radius: 24px;
  background: rgba(255, 253, 248, 0.9);
  box-shadow: 0 20px 60px rgba(56, 68, 56, 0.11);
}

.stage-copy {
  max-width: 680px;
}

h2 {
  margin-bottom: 12px;
  font-size: clamp(27px, 3.7vw, 40px);
  line-height: 1.18;
  letter-spacing: -0.04em;
}

.template-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  margin: 32px 0 26px;
}

.template-card {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  min-height: 185px;
  padding: 22px;
  border: 1px solid #ded9ce;
  border-radius: 16px;
  color: inherit;
  text-align: left;
  background: #fffdf8;
  cursor: pointer;
}

.template-card:hover,
.template-card.selected {
  border-color: #38725d;
  box-shadow: 0 0 0 3px rgba(56, 114, 93, 0.12);
}

.template-card span,
.result-card > span {
  color: #2e6854;
  font-size: 12px;
  font-weight: 800;
}

.template-card strong {
  display: block;
  margin: 25px 0 10px;
  font-size: 18px;
  line-height: 1.35;
}

.template-card small,
.agent-list small,
.execution-item small {
  display: block;
  color: #68736d;
  font-size: 13px;
  line-height: 1.55;
}

.next-action,
.quiet-action {
  box-sizing: border-box;
  max-width: 100%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 45px;
  padding: 0 20px;
  border: 0;
  border-radius: 999px;
  font-size: 14px;
  font-weight: 800;
  text-decoration: none;
  cursor: pointer;
}

.next-action {
  color: #173936;
  background: #f6c64a;
}

.quiet-action {
  color: #285a50;
  background: #e6eee7;
}

.agent-list,
.execution-list,
.result-card ul {
  padding: 0;
  list-style: none;
}

.agent-list {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin: 32px 0;
}

.agent-list li,
.execution-item {
  min-width: 0;
  display: flex;
  gap: 13px;
  padding: 18px;
  border: 1px solid #e0dbd0;
  border-radius: 14px;
  background: #fffdf8;
}

.agent-list li > span,
.execution-item > span {
  color: #2e6854;
  font-weight: 800;
}

.agent-list li > div,
.execution-item > div {
  min-width: 0;
}

.agent-list strong,
.execution-item strong {
  display: block;
  margin-bottom: 5px;
}

.stage-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.execution-list {
  display: grid;
  gap: 12px;
  max-width: 760px;
  margin: 32px 0;
}

.execution-item {
  align-items: flex-start;
}

.execution-item > span {
  display: grid;
  place-items: center;
  flex: 0 0 26px;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  color: #fff;
  background: #38725d;
}

.result-card {
  max-width: 640px;
  margin: 30px 0;
  padding: 26px;
  border-radius: 16px;
  background: #e7f0e7;
}

.result-card ul {
  margin: 16px 0 0;
}

.result-card li {
  padding: 10px 0;
  border-top: 1px solid rgba(40, 90, 80, 0.16);
}

.result-card li::before {
  content: '✓';
  margin-right: 10px;
  color: #38725d;
  font-weight: 900;
}

.guest-note {
  max-width: 760px;
  margin-top: 24px;
  font-size: 13px;
}

@media (max-width: 760px) {
  .guest-demo {
    padding: 24px 20px 36px;
  }

  .demo-header {
    align-items: flex-start;
  }

  .demo-intro {
    padding-top: 56px;
  }

  .stepper,
  .template-grid,
  .agent-list {
    grid-template-columns: minmax(0, 1fr);
  }

  .stepper {
    gap: 4px;
  }

  .stepper li {
    min-height: 32px;
  }

  h1,
  h2,
  .template-card strong,
  .template-card small,
  .stage-description,
  .guest-note,
  .back-link,
  .login-link {
    overflow-wrap: anywhere;
  }
}
</style>
