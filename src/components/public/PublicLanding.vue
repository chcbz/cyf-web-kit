<template>
  <main class="landing-page">
    <section class="landing-hero">
      <nav class="landing-nav" aria-label="首页导航">
        <RouterLink class="brand" :to="homeTarget">聚义厅 <small>AI 协作工作台</small></RouterLink>
        <RouterLink class="nav-login" :to="hallTarget">进入工作台 →</RouterLink>
      </nav>

      <div class="hero-layout">
        <div class="hero-copy">
          <p class="eyebrow">一个目标，多个 AI 分工协作</p>
          <h1><span>你说要做什么，</span><span>让 AI 小队一起办。</span></h1>
          <p class="hero-description">聚义厅是一个 AI 协作工作台。你可以发布任务、选择 AI 帮手、跟进进度，在同一个地方查看任务和对话。</p>
          <div class="hero-actions">
            <RouterLink class="primary-action" :to="demoTarget">免登录看示例 →</RouterLink>
            <RouterLink class="secondary-action" :to="hallTarget">进入工作台</RouterLink>
          </div>
          <p class="entry-note">第一次来？先看协作示例，无需登录。要处理自己的任务，请进入工作台并登录。</p>
        </div>
        <aside class="hero-example" aria-label="AI 协作示例预览">
          <p class="example-badge">示例预览 · 非真实执行</p>
          <h2>“帮我准备一套新品发布文案”</h2>
          <ol>
            <li><span>01</span><div><strong>策划</strong><p>明确受众，列出内容大纲</p></div></li>
            <li><span>02</span><div><strong>写作</strong><p>起草长文和三条短帖</p></div></li>
            <li><span>03</span><div><strong>校对</strong><p>检查信息，整理发布清单</p></div></li>
          </ol>
          <p class="example-result">示例产出：长文初稿、渠道短帖、检查表</p>
          <RouterLink class="example-link" :to="demoTarget">选择一个协作示例 →</RouterLink>
        </aside>
      </div>
    </section>

    <section class="use-cases" aria-labelledby="use-cases-title">
      <div class="section-heading">
        <p class="eyebrow">可以用来做什么</p>
        <h2 id="use-cases-title">从一件具体的事开始。</h2>
        <p>先用示例了解协作方式，再进入工作台处理自己的任务。</p>
      </div>
      <div class="use-case-grid">
        <article><span class="case-number">01 / 资料研究</span><h3>做一份研究简报</h3><p>拆解问题、整理资料、核对证据，把零散信息变成可讨论的结论。</p></article>
        <article><span class="case-number">02 / 内容生产</span><h3>准备一套发布文案</h3><p>从内容大纲到多渠道初稿，再检查事实、语气和发布事项。</p></article>
        <article><span class="case-number">03 / 项目协作</span><h3>梳理一次功能交付</h3><p>明确需求、拆分实现步骤、列出风险和验收清单。</p></article>
      </div>
    </section>

    <section class="landing-cta">
      <div><p class="eyebrow">准备好处理自己的任务了？</p><h2>进入工作台，开始实际协作。</h2><p>需要登录；示例中的内容不会自动执行或保存为真实任务。</p></div>
      <RouterLink class="primary-action" :to="hallTarget">进入工作台 →</RouterLink>
    </section>
  </main>
</template>

<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { publicEntryTarget } from '@/utils/publicEntryNavigation'

const route = useRoute()
const homeTarget = computed(() => publicEntryTarget('/', route.query))
const demoTarget = computed(() => publicEntryTarget('/demo', route.query))
const hallTarget = computed(() => publicEntryTarget('/juyiting', route.query))
</script>

<style scoped>
.landing-page {
  box-sizing: border-box;
  min-height: 100%;
  min-width: 0;
  overflow: auto;
  color: #18201f;
  background: #f7f4ed;
}

.landing-hero {
  min-height: 560px;
  padding: 28px clamp(24px, 7vw, 112px) 56px;
  color: #fffaf0;
  background:
    radial-gradient(circle at 86% 15%, rgba(250, 202, 85, 0.28), transparent 25%),
    radial-gradient(circle at 72% 85%, rgba(60, 139, 121, 0.22), transparent 35%),
    #173936;
}

.landing-nav,
.hero-copy,
.use-cases,
.landing-cta {
  max-width: 1160px;
  margin: 0 auto;
}

.landing-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.brand,
.nav-login,
.primary-action,
.secondary-action {
  text-decoration: none;
}

.brand {
  color: inherit;
  font-size: 21px;
  font-weight: 800;
  letter-spacing: 0.08em;
}

.nav-login {
  color: #fffaf0;
  font-size: 14px;
  font-weight: 650;
}

.hero-copy {
  min-width: 0;
  padding-top: 0;
}

.eyebrow {
  margin: 0 0 15px;
  color: #c9ddbd;
  font-size: 13px;
  font-weight: 750;
  letter-spacing: 0.08em;
}

h1,
h2,
h3,
p {
  margin-top: 0;
}

h1 {
  max-width: 760px;
  margin-bottom: 22px;
  font-size: clamp(32px, 4.8vw, 62px);
  line-height: 1.22;
  letter-spacing: -0.055em;
}

h1 span {
  display: block;
}

.hero-description {
  max-width: 650px;
  color: #dae5db;
  font-size: 18px;
  line-height: 1.8;
}

.hero-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 32px;
}

.primary-action,
.secondary-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 46px;
  padding: 0 22px;
  border-radius: 999px;
  font-size: 15px;
  font-weight: 750;
}

.primary-action {
  color: #173936;
  background: #f6c64a;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.17);
}

.secondary-action {
  color: #fffaf0;
  border: 1px solid rgba(255, 250, 240, 0.42);
}

.use-cases {
  padding: 88px clamp(24px, 7vw, 112px);
}

.section-heading {
  max-width: 720px;
}

.section-heading .eyebrow {
  color: #2e6854;
}

.landing-cta .eyebrow {
  color: #c9ddbd;
}

h2 {
  font-size: clamp(30px, 4vw, 46px);
  line-height: 1.2;
  letter-spacing: -0.04em;
}

.use-case-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 18px;
  margin-top: 38px;
}

.use-case-grid article {
  min-width: 0;
  min-height: 190px;
  padding: 28px;
  border: 1px solid #ded8cc;
  border-radius: 18px;
  background: #fffdf8;
}

.case-number {
  color: #2e6854;
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.08em;
}

h3 {
  margin: 28px 0 12px;
  font-size: 22px;
}

.use-case-grid p {
  margin-bottom: 0;
  color: #57625d;
  line-height: 1.7;
}

.landing-cta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 30px;
  margin: 0 clamp(16px, 4vw, 56px) 48px;
  padding: clamp(28px, 5vw, 54px);
  border-radius: 24px;
  color: #fffaf0;
  background: #285a50;
}

.landing-cta h2 {
  max-width: 610px;
  margin-bottom: 0;
}

.landing-cta .primary-action {
  flex: 0 0 auto;
}

@media (max-width: 720px) {
  .landing-hero {
    min-height: auto;
  }

  .use-case-grid {
    grid-template-columns: 1fr;
  }

  .landing-cta {
    align-items: flex-start;
    flex-direction: column;
  }
}
.hero-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
  gap: clamp(28px, 5vw, 72px);
  align-items: center;
  max-width: 1160px;
  margin: 64px auto 0;
}
.brand small {
  display: block;
  margin-top: 4px;
  font-size: 11px;
  letter-spacing: .06em;
  font-weight: 500;
  color: #dae5db;
}
.entry-note {
  max-width: 500px;
  margin: 18px 0 0;
  color: #dae5db;
  font-size: 13px;
  line-height: 1.8;
}
.hero-example {
  min-width: 0;
  padding: 26px;
  border: 1px solid #54716a;
  border-radius: 22px;
  background: #234641;
}
.example-badge {
  color: #f6d57a;
  font-size: 12px;
}
.hero-example h2 {
  font-size: 23px;
  line-height: 1.5;
  letter-spacing: 0;
}
.hero-example ol {
  list-style: none;
  padding: 0;
  margin: 22px 0;
}
.hero-example li {
  display: flex;
  gap: 14px;
  padding: 14px 0;
  border-top: 1px solid #4b6962;
}
.hero-example li > span {
  color: #f6c64a;
  font-size: 13px;
}
.hero-example li p {
  margin: 5px 0 0;
  color: #dae5db;
  font-size: 13px;
}
.example-result {
  font-size: 13px;
  line-height: 1.8;
}
.example-link {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  color: #f6d57a;
  font-weight: 700;
  font-size: 14px;
}
.landing-cta p:last-child {
  margin: 16px 0 0;
  line-height: 1.8;
  color: #dae5db;
}
.landing-page a:focus-visible {
  outline: 3px solid #cf8732;
  outline-offset: 5px;
}
.landing-nav a {
  min-height: 44px;
  display: inline-flex;
  justify-content: center;
  flex-direction: column;
}
@media (max-width: 720px) {
  .hero-layout {
    grid-template-columns: minmax(0, 1fr);
    margin-top: 34px;
  }
  .landing-hero {
    padding: calc(20px + env(safe-area-inset-top, 0px)) 20px 32px;
  }
  .hero-description {
    font-size: 16px;
  }
  .hero-actions {
    margin-top: 22px;
  }
  .use-cases {
    padding: 44px 20px;
  }
  .hero-example {
    padding: 22px;
  }
  .landing-cta {
    margin-bottom: calc(24px + env(safe-area-inset-bottom, 0px));
  }
}
</style>
