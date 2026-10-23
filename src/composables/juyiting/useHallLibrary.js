import { ref } from 'vue'

export const useHallLibrary = ({
  chatApi,
  openRequirement,
  log,
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
          libraryResults.value = result || []
        }
      })
    } catch (error) {
      log.warn('library search failed', error)
      libraryResults.value = []
      libraryErrorMessage.value = '案卷阁暂不可查，主线不受影响'
      showToast('案卷阁查卷未成')
    } finally {
      libraryLoading.value = false
    }
  }

  const citeLibraryItem = (item) => {
    const content = String(item?.content || '').trim()
    if (!content) return
    const excerpt = content.length > 120 ? `${content.slice(0, 120)}...` : content
    if (!openRequirement?.({ originRef: 'juyiting:library', instruction: `参看典籍阁案卷：${excerpt}`, inputs: [] })) return false
    playSuccess()
    showToast('案卷已带入需求草稿，尚未提交')
    return true
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
