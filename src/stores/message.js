import { defineStore } from 'pinia'
import { msgApi } from '@/composables/useHttp'
import { useApiStore } from '@/stores/api'
import { useGlobalStore } from '@/stores/global'
import { useUtilStore } from '@/stores/util'
import { log } from '@/utils/logger'

const MSG_STATUS = {
  DELETED: 0,
  UNREAD: 1,
  READ: 2
}

export const useMessageStore = defineStore('message', {
  state: () => ({
    messages: [],
    total: 0,
    unreadTotal: 0,
    loading: false,
    error: null,
    pageNum: 1,
    pageSize: 20,
    statusFilter: 'all'
  }),
  getters: {
    visibleMessages: (state) => state.messages,
    hasUnread: (state) => state.unreadTotal > 0
  },
  actions: {
    clearMessageState () {
      this.messages = []
      this.total = 0
      this.unreadTotal = 0
      this.loading = false
      this.error = null
      this.pageNum = 1
      this.statusFilter = 'all'
    },

    async ensureUserId () {
      const globalStore = useGlobalStore()
      if (globalStore.getUserId) {
        return globalStore.getUserId
      }

      const apiStore = useApiStore()
      const user = await apiStore.getUserInfo()
      return user?.id || null
    },

    buildSearch (userId, status) {
      const search = { userId }
      if (status !== 'all') {
        search.status = status === 'unread' ? MSG_STATUS.UNREAD : MSG_STATUS.READ
      }
      return search
    },

    normalizeListResult (result) {
      const data = result?.data
      if (Array.isArray(data)) return data
      if (Array.isArray(data?.list)) return data.list
      if (Array.isArray(data?.records)) return data.records
      return []
    },

    normalizeTotal (result, fallbackLength) {
      if (typeof result?.total === 'number') return result.total
      if (typeof result?.data?.total === 'number') return result.data.total
      return fallbackLength
    },

    async fetchMessages (options = {}) {
      const userId = await this.ensureUserId()
      if (!userId) {
        this.error = '缺少用户信息'
        this.messages = []
        this.total = 0
        return
      }

      this.loading = true
      this.error = null

      const pageNum = options.pageNum || this.pageNum
      const statusFilter = options.statusFilter || this.statusFilter

      try {
        const result = await msgApi.list('/list', {
          pageNum,
          pageSize: this.pageSize,
          orderBy: 'id desc',
          search: this.buildSearch(userId, statusFilter)
        }, { autoLoading: false })

        this.pageNum = pageNum
        this.statusFilter = statusFilter
        this.messages = this.normalizeListResult(result)
        this.total = this.normalizeTotal(result, this.messages.length)
      } catch (error) {
        this.error = error.message || '消息加载失败'
        this.messages = []
        this.total = 0
        log.warn('Failed to fetch messages:', error)
      } finally {
        this.loading = false
      }
    },

    async fetchUnreadTotal () {
      const utilStore = useUtilStore()
      if (!utilStore.getLocalStorage('api_token')) {
        this.unreadTotal = 0
        return
      }

      const userId = await this.ensureUserId()
      if (!userId) {
        this.unreadTotal = 0
        return
      }

      try {
        const result = await msgApi.list('/list', {
          pageNum: 1,
          pageSize: 1,
          search: {
            userId,
            status: MSG_STATUS.UNREAD
          }
        }, { autoLoading: false })
        this.unreadTotal = this.normalizeTotal(result, this.normalizeListResult(result).length)
      } catch (error) {
        this.unreadTotal = 0
        log.debug('Failed to fetch unread messages:', error)
      }
    },

    async markRead (id) {
      await msgApi.get('/read', { id }, { autoLoading: false })
      const message = this.messages.find(item => item.id === id)
      if (message) {
        message.status = MSG_STATUS.READ
      }
      await this.fetchUnreadTotal()
    },

    async markAllRead () {
      const userId = await this.ensureUserId()
      if (!userId) return
      await msgApi.get('/readall', { userId }, { autoLoading: false })
      this.messages = this.messages.map(message => ({
        ...message,
        status: MSG_STATUS.READ
      }))
      this.unreadTotal = 0
    },

    async recycle (id) {
      await msgApi.get('/recycle', { id }, { autoLoading: false })
      this.messages = this.messages.filter(item => item.id !== id)
      this.total = Math.max(0, this.total - 1)
      await this.fetchUnreadTotal()
    }
  }
})

export { MSG_STATUS }
