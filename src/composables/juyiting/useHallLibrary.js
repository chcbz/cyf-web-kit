import { ref } from 'vue'

export const useHallLibrary = ({
  chatApi,
  draft,
  log,
  openPanel,
  outgoingMetadata,
  playSuccess,
  showToast
}) => {
  const libraryKeyword = ref('')
  const librarySourceType = ref('')
  const libraryResults = ref([])
  const libraryLoading = ref(false)
  const libraryHasSearched = ref(false)
  const libraryErrorMessage = ref('')

  const searchLibrary = async () => {
    if (!libraryKeyword.value.trim()) return
    libraryLoading.value = true
    libraryHasSearched.value = true
    libraryErrorMessage.value = ''
    try {
      await chatApi.search('/library/search', {
        keyword: libraryKeyword.value.trim(),
        sourceType: librarySourceType.value || undefined,
        topK: 8
      }, {
        autoLoading: false,
        onSuccess: (result) => {
          libraryResults.value = result?.data || []
        }
      })
    } catch (error) {
      log.warn('library search failed', error)
      libraryResults.value = []
      libraryErrorMessage.value = '藏经阁暂不可用，主流程不受影响'
      showToast('藏经阁检索失败')
    } finally {
      libraryLoading.value = false
    }
  }

  const citeLibraryItem = (item) => {
    const content = String(item?.content || '').trim()
    if (!content) return
    outgoingMetadata.value = {
      ...(outgoingMetadata.value || {}),
      libraryCitationId: item.id || item.conversationId,
      librarySourceType: item.summaryType || item.sourceType || 'memory'
    }
    const excerpt = content.length > 120 ? `${content.slice(0, 120)}...` : content
    draft.value = `${draft.value ? `${draft.value}\n\n` : ''}参考藏经阁资料：${excerpt}`
    openPanel('chat')
    playSuccess()
    showToast('资料已引用到传令')
  }

  return {
    citeLibraryItem,
    libraryErrorMessage,
    libraryHasSearched,
    libraryKeyword,
    libraryLoading,
    libraryResults,
    librarySourceType,
    searchLibrary
  }
}
