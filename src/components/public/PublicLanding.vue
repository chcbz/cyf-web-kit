<template>
  <main class="landing-page">
    <section class="landing-hero">
      <div class="landing-nav">
        <RouterLink class="brand" to="/">聚义厅</RouterLink>
        <RouterLink class="nav-login" to="/juyiting">登录进入聚义厅</RouterLink>
      </div>

      <div class="hero-copy">
        <p class="eyebrow">把复杂工作交给一支会协作的 AI 小队</p>
        <h1><span>从一个任务开始，</span><span>得到可以继续使用的成果。</span></h1>
        <p class="hero-description">
          聚义厅让研究、内容和项目协作变成清晰的工作流：说清目标，系统推荐合适的帮手，再把过程沉淀为可复用的结果。
        </p>
        <div class="hero-actions">
          <RouterLink class="primary-action" to="/demo">立即体验</RouterLink>
          <RouterLink class="secondary-action" to="/juyiting">登录进入聚义厅</RouterLink>
        </div>
      </div>

      <div class="hero-proof" aria-label="聚义厅的工作方式">
        <div><strong>1</strong><span>说明你想完成的事</span></div>
        <div><strong>2</strong><span>让合适的 AI 帮手协同完成</span></div>
        <div><strong>3</strong><span>带走可继续编辑的成果</span></div>
      </div>
    </section>

    <section class="use-cases" aria-labelledby="use-cases-title">
      <div class="section-heading">
        <p class="eyebrow">常见使用场景</p>
        <h2 id="use-cases-title">不是多开几个聊天窗口，而是把事情推进下去。</h2>
      </div>
      <div class="use-case-grid">
        <article>
          <span class="case-number">01</span>
          <h3>资料研究</h3>
          <p>把问题、证据和建议整理在一起，方便做判断和向团队说明。</p>
        </article>
        <article>
          <span class="case-number">02</span>
          <h3>内容生产</h3>
          <p>从选题到多渠道素材，保留统一口径和可继续编辑的内容包。</p>
        </article>
        <article>
          <span class="case-number">03</span>
          <h3>项目与代码协作</h3>
          <p>让需求、实现、检查和交接围绕同一份任务结果协同推进。</p>
        </article>
      </div>
    </section>

    <section class="landing-cta">
      <div>
        <p class="eyebrow">无需登录即可试看</p>
        <h2>先体验一次完整协作，再决定怎样开始。</h2>
      </div>
      <RouterLink class="primary-action" to="/demo">立即体验</RouterLink>
    </section>
  </main>
</template>

<style scoped>
.landing-page {
  min-height: 100%;
  overflow: auto;
  color: #18201f;
  background: #f7f4ed;
}

.landing-hero {
  min-height: 610px;
  padding: 28px clamp(24px, 7vw, 112px) 56px;
  color: #fffaf0;
  background:
    radial-gradient(circle at 86% 15%, rgba(250, 202, 85, 0.28), transparent 25%),
    radial-gradient(circle at 72% 85%, rgba(60, 139, 121, 0.22), transparent 35%),
    #173936;
}

.landing-nav,
.hero-copy,
.hero-proof,
.use-cases,
.landing-cta {
  max-width: 1160px;
  margin: 0 auto;
}

.landing-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
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
  max-width: 800px;
  padding-top: clamp(84px, 12vw, 142px);
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
  font-size: clamp(40px, 6vw, 72px);
  line-height: 1.08;
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

.hero-proof {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1px;
  margin-top: 70px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.17);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.17);
}

.hero-proof div {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 76px;
  padding: 16px 20px;
  background: rgba(17, 48, 45, 0.72);
}

.hero-proof strong {
  color: #f6c64a;
  font-size: 20px;
}

.hero-proof span {
  font-size: 14px;
  line-height: 1.45;
}

.use-cases {
  padding: 88px clamp(24px, 7vw, 112px);
}

.section-heading {
  max-width: 720px;
}

.section-heading .eyebrow,
.landing-cta .eyebrow {
  color: #2e6854;
}

h2 {
  font-size: clamp(30px, 4vw, 46px);
  line-height: 1.2;
  letter-spacing: -0.04em;
}

.use-case-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 18px;
  margin-top: 38px;
}

.use-case-grid article {
  min-height: 215px;
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
  margin: 46px 0 12px;
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

  .hero-proof,
  .use-case-grid {
    grid-template-columns: 1fr;
  }

  .hero-proof {
    margin-top: 50px;
  }

  .landing-cta {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
