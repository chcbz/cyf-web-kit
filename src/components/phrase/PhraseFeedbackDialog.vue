<template>
  <var-dialog v-model:show="visible">
    <div class="cell-group">
      <var-input
        v-model="title"
        :placeholder="$t('phrase.feedback_title_placeholder')"
        :maxlength="50"
      />
      <var-input
        v-model="content"
        type="textarea"
        :placeholder="$t('phrase.feedback_content_placeholder')"
        :maxlength="500"
      />
      <var-input
        v-model="name"
        :placeholder="$t('phrase.feedback_name_placeholder')"
        :maxlength="20"
      />
      <var-input
        v-model="phone"
        :placeholder="$t('phrase.feedback_phone_placeholder')"
        type="tel"
        :rules="[(v) => /^1[3-9]\\d{9}$/.test(v) || '请输入正确手机号']"
      />
      <var-input
        v-model="email"
        :placeholder="$t('phrase.feedback_email_placeholder')"
        :maxlength="100"
        type="email"
        :rules="[(v) => /.+@.+\\..+/.test(v) || '请输入正确邮箱']"
      />
      <var-button
        type="primary"
        block
        :disabled="title === ''"
        @click="handleSubmit"
      >
        {{ $t('app.submit') }}
      </var-button>
      <var-button type="default" block @click="close">
        {{ $t('app.cancel') }}
      </var-button>
    </div>
  </var-dialog>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Dialog } from '@varlet/ui'
import { kefuApi } from '../../composables/useHttp'
import { useGlobalStore } from '../../stores/global'

const props = defineProps({
  show: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['update:show'])

const { t } = useI18n()
const globalStore = useGlobalStore()

const title = ref('')
const content = ref('')
const name = ref('')
const phone = ref('')
const email = ref('')

const visible = computed({
  get: () => props.show,
  set: (val) => emit('update:show', val)
})

const handleSubmit = () => {
  const jiacn = globalStore.getJiacn

  if (!jiacn) {
    Dialog({
      title: t('app.notify'),
      message: t('phrase.subscribe_notify'),
      onConfirm: () => {
        window.location.href =
          'https://mp.weixin.qq.com/mp/profile_ext?action=home&__biz=MzU2OTU3Njk5MQ==&scene=110#wechat_redirect'
      }
    })
    return
  }

  const formData = new FormData()
  formData.append('jiacn', jiacn)
  formData.append('resourceId', 'phrase')
  formData.append('name', name.value)
  formData.append('phone', phone.value)
  formData.append('email', email.value)
  formData.append('title', title.value)
  formData.append('content', content.value)

  kefuApi.post('/message/create', formData, {
    onSuccess: (data) => {
      if (data.code === 'E0') {
        title.value = ''
        content.value = ''
        visible.value = false
        Dialog({
          title: t('app.notify'),
          message: t('phrase.feedback_success')
        })
      }
    }
  })
}

const close = () => {
  visible.value = false
}
</script>

<style scoped>
.cell-group {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
</style>
