<template>
  <var-dialog v-model:show="visible">
    <div class="cell-group">
      <var-input
        v-model="content"
        type="textarea"
        :placeholder="$t('phrase.content_placeholder')"
        :maxlength="200"
      />
      <var-button
        type="primary"
        block
        :disabled="content === ''"
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
import { phraseApi } from '../../composables/useHttp'
import { useGlobalStore } from '../../stores/global'

const props = defineProps({
  show: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['update:show', 'success'])

const { t } = useI18n()
const globalStore = useGlobalStore()

const content = ref('')

const visible = computed({
  get: () => props.show,
  set: (val) => emit('update:show', val)
})

const handleSubmit = () => {
  const jiacn = globalStore.getJiacn

  phraseApi.create('/create', {
    jiacn,
    content: content.value.trim(),
    tag: '毒鸡汤'
  }, {
    onSuccess: (data) => {
      if (data.code === 'E0') {
        content.value = ''
        visible.value = false
        Dialog({
          title: t('app.notify'),
          message: t('phrase.add_success')
        })
        emit('success')
      } else {
        visible.value = false
        Dialog({
          title: t('app.alert'),
          message: data.msg
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
