<template>
  <section ref="scrollRoot" class="hall-help-center" aria-label="聚义厅使用指南">
    <div class="help-content">
      <template v-if="screen === 'home'">
        <header class="help-intro">
          <p class="eyebrow">聚义厅 · 使用指南</p>
          <h1 ref="heading" tabindex="-1">让每一件事，都有章可循。</h1>
          <p>从第一次办事，到找到一份成果。</p>
        </header>
        <label class="help-search">
          <var-icon name="magnify" aria-hidden="true" />
          <input
            v-model="query"
            type="search"
            aria-label="搜索使用帮助"
            placeholder="搜索问题，例如：任务、文件、机器人"
          />
        </label>
        <section v-if="!query.trim() && !category" class="help-start">
          <div>
            <p class="eyebrow">快速开始</p>
            <h2>第一次使用聚义厅？</h2>
            <p>提出需求 → 确认承办 → 跟进事项 → 查看成果</p>
            <div class="help-actions">
              <button type="button" class="primary" @click="readArticle('start')">阅读入门指南</button>
              <button type="button" @click="emit('replay', $event.currentTarget)">重看新手引导</button>
            </div>
          </div>
          <span class="help-seal" aria-hidden="true">入<br />门</span>
        </section>
        <section aria-label="按场景查找">
          <div class="section-label"><h2>你想了解什么？</h2><button
            v-if="category"
            type="button"
            class="text-button"
            @click="category = ''"
          >查看全部</button></div>
          <div class="help-categories">
            <button
              v-for="(name, index) in hallHelpCategories"
              :key="name"
              type="button"
              :aria-pressed="category === name"
              @click="category = category === name ? '' : name"
            ><span aria-hidden="true">0{{ index + 1 }}</span>{{ name }}</button>
          </div>
        </section>
        <section aria-label="帮助文章">
          <div class="section-label"><h2>{{ query.trim() ? '搜索结果' : category || '常见问题' }}</h2><span role="status">{{ filtering ? `${results.length} 篇` : '从这里找到答案' }}</span></div>
          <div v-if="!results.length" class="help-empty">
            <h3>还没有找到相关帮助</h3><p>试试“任务”“文件”或“机器人”，也可以把问题反馈给我们。</p>
            <button type="button" @click="openFeedback">反馈问题</button>
          </div>
          <button
            v-for="article in results"
            :key="article.id"
            type="button"
            class="help-row"
            :data-help-article="article.id"
            @click="readArticle(article.id)"
          >
            <span><strong>{{ article.title }}</strong><small>{{ article.category }}</small></span><var-icon name="chevron-right" aria-hidden="true" />
          </button>
        </section>
        <footer class="help-footer"><div><strong>仍然没有解决？</strong><p>告诉我们遇到的问题，一起把事情办顺。</p></div><button type="button" class="text-button" @click="openFeedback">反馈问题 →</button></footer>
      </template>

      <article v-else-if="screen === 'article'" class="help-article">
        <p class="eyebrow">{{ selectedArticle.category }} · 操作指南</p>
        <h1 ref="heading" tabindex="-1">{{ selectedArticle.title }}</h1>
        <p class="help-summary">{{ selectedArticle.summary }}</p>
        <h2>跟着这几步操作</h2>
        <ol class="help-steps"><li v-for="text in selectedArticle.steps" :key="text">{{ text }}</li></ol>
        <aside class="help-note"><strong>请留意</strong><p>帮助只说明操作方法。实际状态、权限和可用操作，以业务页面为准。</p></aside>
        <button
          type="button"
          class="primary"
          :disabled="selectedArticle.target === 'account' && accountEntryDisabled"
          @click="emit('navigate', selectedArticle.target)"
        >{{ selectedArticle.action }} →</button>
        <p v-if="selectedArticle.target === 'account' && accountEntryDisabled" class="help-fine">当前个人中心入口不可用，请先核对登录状态。</p>
        <hr />
        <h2>接下来，你可能想了解</h2>
        <button
          v-for="article in relatedArticles"
          :key="article.id"
          type="button"
          class="help-row"
          @click="readArticle(article.id)"
        ><span><strong>{{ article.title }}</strong><small>{{ article.category }}</small></span><var-icon name="chevron-right" aria-hidden="true" /></button>
        <div class="help-feedback-line">还不清楚？<button type="button" class="text-button" @click="openFeedback">反馈这个问题</button></div>
      </article>

      <section v-else class="help-article">
        <p class="eyebrow">意见与反馈</p>
        <h1 ref="heading" tabindex="-1">哪里还不够顺手？</h1>
        <p class="help-summary">描述你做了什么、遇到什么问题，以及期望的结果。</p>
        <form @submit.prevent="submitFeedback">
          <fieldset :disabled="submitting || feedbackStatus === 'unknown'">
            <label class="help-field">问题描述<textarea
              v-model="form.content"
              rows="6"
              maxlength="500"
              required
              placeholder="例如：我在事项里看到了成果，但不知道怎样打开……"
            ></textarea></label>
            <label class="help-field">联系邮箱（选填）<input
              v-model="form.email"
              type="email"
              maxlength="100"
              autocomplete="email"
              placeholder="如需回复，可留下联系邮箱"
            /></label>
            <p class="help-fine">请勿填写密码、密钥或其他敏感信息。仅发送你填写的内容、反馈主题及当前账户标识，不附带对话或资料。</p>
            <button type="submit" class="primary" :disabled="!canSubmit">{{ submitting ? '正在提交…' : '提交反馈' }}</button>
          </fieldset>
          <p v-if="feedbackError" role="alert" class="help-note">{{ feedbackError }}</p>
          <p v-else-if="feedbackStatus === 'success'" role="status" class="help-note">反馈已提交，感谢你帮助我们完善聚义厅。</p>
        </form>
      </section>
    </div>
  </section>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { hallHelpArticles, hallHelpCategories, hallHelpPopularIds, searchHallHelp } from '@/content/hallHelp'
import { kefuApi } from '@/composables/useHttp'
import { useHelpFeedback } from '@/composables/useHelpFeedback'
import { useGlobalStore } from '@/stores/global'
import { useApiStore } from '@/stores/api'

const props = defineProps({ active: { type: Boolean, default: true }, accountEntryDisabled: { type: Boolean, default: false } })
const emit = defineEmits(['navigate', 'replay'])
const globalStore = useGlobalStore()
const apiStore = useApiStore()
const subject = computed(() => globalStore.getJiacn)
const identity = computed(() => apiStore.authorizationGeneration)
const { form, submitting, status: feedbackStatus, error: feedbackError, canSubmit, submit } = useHelpFeedback({ post: kefuApi.post, subject, identity })
const query = ref('')
const category = ref('')
const screens = ref(['home'])
const screen = computed(() => screens.value.at(-1))
const selected = ref('start')
const selectedArticle = computed(() => hallHelpArticles.find(article => article.id === selected.value))
const relatedArticles = computed(() => hallHelpArticles.filter(article => article.id !== selected.value && (article.category === selectedArticle.value.category || article.id === 'progress')).slice(0, 2))
const filtering = computed(() => Boolean(query.value.trim() || category.value))
const results = computed(() => filtering.value ? searchHallHelp(query.value, category.value) : hallHelpPopularIds.map(id => hallHelpArticles.find(article => article.id === id)))
const canGoBack = computed(() => screens.value.length > 1)
const scrollRoot = ref(null)
const heading = ref(null)
let homeScroll = 0
let homeFocus = null
const focusHeading = async () => { await nextTick(); if (props.active) heading.value?.focus({ preventScroll: true }) }
const open = next => {
  if (screen.value === 'home') { homeScroll = scrollRoot.value?.scrollTop || 0; homeFocus = document.activeElement?.dataset?.helpArticle || null }
  if (screen.value !== next) screens.value.push(next)
  nextTick(() => { if (scrollRoot.value) scrollRoot.value.scrollTop = 0 })
  void focusHeading()
}
const readArticle = id => { selected.value = id; open('article') }
const openFeedback = () => {
  if (!form.title) form.title = `聚义厅使用帮助：${screen.value === 'article' ? selectedArticle.value.title : '使用问题'}`.slice(0, 50)
  open('feedback')
}
const submitFeedback = async () => {
  if (!form.title) form.title = '聚义厅使用帮助：使用问题'
  const title = form.title
  if (await submit()) form.title = title
}
const back = () => {
  if (!canGoBack.value) return false
  screens.value.pop()
  nextTick(() => {
    if (!props.active) return
    if (scrollRoot.value) scrollRoot.value.scrollTop = screen.value === 'home' ? homeScroll : 0
    const target = screen.value === 'home' && homeFocus ? scrollRoot.value?.querySelector(`[data-help-article="${homeFocus}"]`) : heading.value
    ;(target || heading.value)?.focus({ preventScroll: true })
  })
  return true
}
watch([subject, identity], () => {
  query.value = ''; category.value = ''; screens.value = ['home']; selected.value = 'start'; homeScroll = 0; homeFocus = null
}, { flush: 'sync' })
defineExpose({ canGoBack, back })
</script>

<style scoped>
.hall-help-center{flex:1;min-height:0;overflow:auto;background:var(--hall-canvas,#f5f4f0);color:var(--hall-text,#29352f)}
.help-content{max-width:900px;margin:auto;padding:32px 36px 40px;box-sizing:border-box}
h1{font:500 28px/1.5 "Noto Serif CJK SC","Songti SC",serif;margin:8px 0 12px}h2{font-size:18px;margin:0}p{line-height:1.8}.eyebrow{color:var(--hall-brand,#974a38);letter-spacing:2px;font-size:12px;margin:0}
.help-intro>p:last-child,.help-start p,.help-footer p{color:var(--hall-text-muted,#68716b);font-size:14px;margin:6px 0}
button{font:inherit;font-size:14px;min-height:44px;padding:10px 16px;border:1px solid var(--hall-border,#deded4);border-radius:7px;background:var(--hall-paper,#fffefa);color:inherit;cursor:pointer}button:hover{filter:brightness(.97)}button:disabled{cursor:default;opacity:.55}button:focus-visible,input:focus-visible,textarea:focus-visible{outline:2px solid var(--hall-brand,#974a38);outline-offset:3px}h1:focus{outline:none}
button.primary{background:var(--hall-brand,#974a38);color:#fffefa;border-color:var(--hall-brand,#974a38)}button.text-button{background:transparent;border:0;padding-left:0;color:var(--hall-brand,#974a38)}
.help-search{display:flex;gap:12px;align-items:center;margin:26px 0;background:var(--hall-paper,#fffefa);border:1px solid var(--hall-border,#deded4);border-radius:10px;padding:5px 16px}.help-search input{font:inherit;width:100%;min-width:0;min-height:44px;border:0;background:transparent;color:inherit}.help-search .var-icon{font-size:22px;color:var(--hall-text-muted,#68716b)}
.help-start{display:flex;justify-content:space-between;align-items:center;background:var(--hall-surface-brand,#ebece4);border:1px solid var(--hall-border,#deded4);border-radius:12px;padding:24px;margin-bottom:30px;gap:20px}.help-start h2{margin-top:8px;font-family:"Songti SC",serif;font-size:23px}.help-seal{font:24px/1.4 serif;letter-spacing:4px;border:1px solid var(--hall-brand,#974a38);color:var(--hall-brand,#974a38);padding:10px 8px 10px 12px;transform:rotate(5deg);flex-shrink:0}
.help-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:20px}.section-label{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:24px 0 14px}.section-label>span{font-size:12px;color:var(--hall-text-muted,#68716b)}.help-categories{display:flex;flex-wrap:wrap;gap:8px}.help-categories button{flex:1 0 130px;text-align:left}.help-categories button>span{color:var(--hall-text-muted,#68716b);font-size:11px;margin-right:9px}.help-categories [aria-pressed="true"]{background:var(--hall-surface-brand,#ebece4);border-color:var(--hall-brand,#974a38);color:var(--hall-brand,#974a38)}
button.help-row{width:100%;display:flex;justify-content:space-between;align-items:center;gap:16px;text-align:left;padding:18px 2px;border:0;border-bottom:1px solid var(--hall-border,#deded4);border-radius:0;background:transparent}.help-row strong{font-size:15px;font-weight:500}.help-row small{display:block;font-size:12px;color:var(--hall-text-muted,#68716b);margin-top:6px}.help-row .var-icon{font-size:22px;color:var(--hall-text-muted,#68716b)}
.help-footer{display:flex;justify-content:space-between;align-items:center;border-top:1px solid var(--hall-border,#deded4);margin-top:32px;padding-top:24px;gap:18px}.help-footer strong{font-size:15px}.help-article{max-width:650px;margin:10px auto}.help-summary{color:var(--hall-text-muted,#68716b);font-size:16px;line-height:1.9;margin-bottom:30px}.help-steps{list-style:none;counter-reset:step;padding:0;margin:24px 0}.help-steps li{counter-increment:step;position:relative;padding:0 0 24px 44px;line-height:1.9}.help-steps li:before{content:counter(step,decimal-leading-zero);position:absolute;left:0;color:var(--hall-brand,#974a38);font:20px Georgia,serif}.help-note{background:var(--hall-surface-brand,#ebece4);border-left:3px solid #929d80;padding:16px 20px;margin:20px 0;font-size:14px;line-height:1.8}.help-note p{margin:4px 0 0}.help-article hr{border:0;border-top:1px solid var(--hall-border,#deded4);margin:34px 0}.help-feedback-line{margin-top:20px;font-size:14px;color:var(--hall-text-muted,#68716b)}
fieldset{border:0;padding:0;margin:0;min-width:0}.help-field{display:grid;gap:12px;font-size:14px;margin-bottom:20px}.help-field textarea,.help-field input{box-sizing:border-box;width:100%;resize:vertical;font:inherit;padding:14px;border:1px solid var(--hall-border,#deded4);border-radius:8px;background:var(--hall-paper,#fffefa);color:inherit;line-height:1.8}.help-fine{font-size:12px;color:var(--hall-text-muted,#68716b)}.help-empty{text-align:center;padding:30px 10px}
@media(max-width:600px){.help-content{padding:24px 20px max(28px,env(safe-area-inset-bottom))}h1{font-size:24px}.help-start{padding:20px;gap:12px}.help-start h2{font-size:21px}.help-seal{font-size:19px}.help-start p{font-size:12px}.help-actions{gap:6px}.help-actions button{font-size:12px;padding:9px 10px}.help-categories button{flex:1 0 42%}.help-footer{align-items:flex-start}.help-footer p{font-size:12px}.section-label>span{font-size:11px}.help-search input{font-size:13px}.help-summary{font-size:15px}}
</style>
