<template>
  <div class="help-center">
    <section class="help-section faq-section">
      <header class="section-header">
        <div>
          <h2>{{ $t('help.title') }}</h2>
          <p>{{ $t('help.subtitle') }}</p>
        </div>
        <var-button
          text
          type="primary"
          size="small"
          :loading="faqLoading"
          @click="loadFaqs"
        >
          {{ $t('app.refresh') }}
        </var-button>
      </header>

      <var-input
        v-model="keyword"
        class="faq-search"
        :placeholder="$t('help.search_placeholder')"
        clearable
      >
        <template #prepend-icon>
          <var-icon name="magnify" />
        </template>
      </var-input>

      <var-loading v-if="faqLoading" class="help-loading" />

      <var-empty
        v-else-if="!filteredFaqs.length"
        :description="faqError || $t('help.faq_empty')"
      />

      <div v-else class="faq-list">
        <article
          v-for="faq in filteredFaqs"
          :key="faq.id"
          class="faq-item"
        >
          <h3>{{ faq.title || $t('help.untitled_faq') }}</h3>
          <p>{{ faq.content || $t('help.no_answer') }}</p>
        </article>
      </div>
    </section>

    <section class="help-section feedback-section">
      <header class="section-header">
        <div>
          <h2>{{ $t('help.feedback_title') }}</h2>
          <p>{{ $t('help.feedback_subtitle') }}</p>
        </div>
      </header>

      <div class="feedback-form">
        <var-input
          v-model="form.title"
          :placeholder="$t('help.feedback_subject')"
          :maxlength="50"
        />
        <var-input
          v-model="form.content"
          type="textarea"
          :placeholder="$t('help.feedback_content')"
          :maxlength="500"
        />
        <var-input
          v-model="form.name"
          :placeholder="$t('help.feedback_name')"
          :maxlength="20"
        />
        <var-input
          v-model="form.phone"
          :placeholder="$t('help.feedback_phone')"
          type="tel"
        />
        <var-input
          v-model="form.email"
          :placeholder="$t('help.feedback_email')"
          type="email"
          :maxlength="100"
        />
        <var-button
          type="primary"
          block
          :loading="submitting"
          :disabled="!canSubmit"
          @click="submitFeedback"
        >
          {{ $t('help.submit_feedback') }}
        </var-button>
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { Dialog } from '@varlet/ui'
import { useI18n } from 'vue-i18n'
import { kefuApi } from '@/composables/useHttp'
import { useGlobalStore } from '@/stores/global'
import { log } from '@/utils/logger'

const { t } = useI18n()
const globalStore = useGlobalStore()

const keyword = ref('')
const faqs = ref([])
const faqLoading = ref(false)
const faqError = ref('')
const submitting = ref(false)

const form = reactive({
  title: '',
  content: '',
  name: '',
  phone: '',
  email: ''
})

const canSubmit = computed(() => form.title.trim() && form.content.trim())

const filteredFaqs = computed(() => {
  const query = keyword.value.trim().toLowerCase()
  if (!query) return faqs.value
  return faqs.value.filter(item => {
    return `${item.title || ''} ${item.content || ''}`.toLowerCase().includes(query)
  })
})

const normalizeListResult = (result) => {
  const data = result?.data
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.list)) return data.list
  if (Array.isArray(data?.records)) return data.records
  return []
}

const loadFaqs = async () => {
  faqLoading.value = true
  faqError.value = ''

  try {
    const result = await kefuApi.list('/faq/list', {
      pageNum: 1,
      pageSize: 50,
      orderBy: 'id desc',
      search: {
        status: 1
      }
    }, { autoLoading: false })

    faqs.value = normalizeListResult(result)
  } catch (error) {
    faqs.value = []
    faqError.value = t('help.faq_unavailable')
    log.debug('Failed to load FAQ list:', error)
  } finally {
    faqLoading.value = false
  }
}

const resetForm = () => {
  form.title = ''
  form.content = ''
  form.name = ''
  form.phone = ''
  form.email = ''
}

const submitFeedback = async () => {
  if (!canSubmit.value || submitting.value) return

  submitting.value = true
  const formData = new FormData()
  formData.append('resourceId', 'help-center')
  formData.append('jiacn', globalStore.getJiacn || '')
  formData.append('title', form.title.trim())
  formData.append('content', form.content.trim())
  formData.append('name', form.name.trim())
  formData.append('phone', form.phone.trim())
  formData.append('email', form.email.trim())

  try {
    const result = await kefuApi.post('/message/create', formData, { autoLoading: false })
    if (result?.data?.code && result.data.code !== 'E0') {
      throw new Error(result.data.msg || t('help.feedback_failed'))
    }
    resetForm()
    Dialog({
      title: t('app.notify'),
      message: t('help.feedback_success'),
      confirmButtonText: t('app.confirm')
    })
  } catch (error) {
    Dialog({
      title: t('app.alert'),
      message: error.message || t('help.feedback_failed'),
      confirmButtonText: t('app.confirm')
    })
  } finally {
    submitting.value = false
  }
}

onMounted(() => {
  globalStore.setTitle(t('help.title'))
  globalStore.setShowBack(false)
  globalStore.setShowMore(false)
  loadFaqs()
})
</script>

<style scoped>
.help-center {
  flex: 1;
  overflow: auto;
  padding: 16px;
  background: var(--color-body);
}

.help-section {
  margin-bottom: 20px;
}

.section-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.section-header h2 {
  margin: 0 0 4px;
  font-size: 22px;
  font-weight: 600;
}

.section-header p {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 13px;
}

.faq-search {
  margin-bottom: 12px;
}

.help-loading {
  min-height: 160px;
}

.faq-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.faq-item {
  padding: 14px;
  border: 1px solid var(--color-outline);
  border-radius: 8px;
  background: var(--color-surface-container-lowest);
}

.faq-item h3 {
  margin: 0 0 8px;
  font-size: 15px;
  font-weight: 600;
}

.faq-item p {
  margin: 0;
  color: var(--color-text-secondary);
  line-height: 1.6;
  white-space: pre-wrap;
}

.feedback-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

@media (min-width: 768px) {
  .help-center {
    padding: 24px;
  }

  .help-section {
    max-width: 760px;
  }
}
</style>
