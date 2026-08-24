import { defineStore } from 'pinia'
import { msgApi } from '../composables/useHttp.js'
import { useApiStore } from './api.js'
import { useGlobalStore } from './global.js'
import { useUtilStore } from './util.js'
import { log } from '../utils/logger.js'
import { registerIdentityCleanup } from '../utils/identityLifecycle.js'
import { throwIfAborted } from '../utils/abortSignals.js'

const MSG_STATUS = {
  DELETED: 0,
  UNREAD: 1,
  READ: 2
}

const messageLifecycleByStore = new WeakMap()

function messageLifecycle (store) {
  let lifecycle = messageLifecycleByStore.get(store)
  if (!lifecycle) {
    lifecycle = {
      controller: new AbortController(),
      disposed: false,
      generation: 0
    }
    messageLifecycleByStore.set(store, lifecycle)
  }
  return lifecycle
}

function captureMessageOperation (store) {
  const lifecycle = messageLifecycle(store)
  return {
    authStore: useApiStore(),
    generation: lifecycle.generation,
    signal: lifecycle.controller.signal
  }
}

function isMessageOperationCurrent (store, operation) {
  const lifecycle = messageLifecycle(store)
  return !lifecycle.disposed &&
    lifecycle.generation === operation.generation &&
    !operation.signal.aborted
}

function assertMessageOperationCurrent (store, operation) {
  throwIfAborted(operation.signal)
  if (!isMessageOperationCurrent(store, operation)) {
    throw new DOMException('Message identity changed', 'AbortError')
  }
}

function hasStoredApiToken () {
  return Boolean(useUtilStore().getLocalStorage('api_token'))
}

function resetMessageLifecycle (store, { disposed = false } = {}) {
  const lifecycle = messageLifecycle(store)
  lifecycle.generation += 1
  lifecycle.disposed = lifecycle.disposed || disposed
  lifecycle.controller.abort(new DOMException(
    lifecycle.disposed ? 'Message store disposed' : 'Message identity cleared',
    'AbortError'
  ))
  if (!lifecycle.disposed) lifecycle.controller = new AbortController()
}

const useMessageStoreBase = defineStore('message', {
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
      resetMessageLifecycle(this)
      this.messages = []
      this.total = 0
      this.unreadTotal = 0
      this.loading = false
      this.error = null
      this.pageNum = 1
      this.pageSize = 20
      this.statusFilter = 'all'
    },

    async ensureUserId (operation = captureMessageOperation(this)) {
      try {
        assertMessageOperationCurrent(this, operation)
        if (!hasStoredApiToken()) return null
        const globalStore = useGlobalStore()
        if (globalStore.getUserId) return globalStore.getUserId

        assertMessageOperationCurrent(this, operation)
        const user = await operation.authStore.getUserInfo({ signal: operation.signal })
        assertMessageOperationCurrent(this, operation)
        return user?.id || null
      } catch (error) {
        if (!isMessageOperationCurrent(this, operation)) assertMessageOperationCurrent(this, operation)
        throw error
      }
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
      const operation = captureMessageOperation(this)
      try {
        assertMessageOperationCurrent(this, operation)
        if (!hasStoredApiToken()) return
        const userId = await this.ensureUserId(operation)
        assertMessageOperationCurrent(this, operation)
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
        const result = await msgApi.list('/list', {
          pageNum,
          pageSize: this.pageSize,
          orderBy: 'id desc',
          search: this.buildSearch(userId, statusFilter)
        }, { authStore: operation.authStore, autoLoading: false, signal: operation.signal })
        assertMessageOperationCurrent(this, operation)

        this.pageNum = pageNum
        this.statusFilter = statusFilter
        this.messages = this.normalizeListResult(result)
        this.total = this.normalizeTotal(result, this.messages.length)
      } catch (error) {
        if (!isMessageOperationCurrent(this, operation)) assertMessageOperationCurrent(this, operation)
        this.error = error.message || '消息加载失败'
        this.messages = []
        this.total = 0
        log.warn('Failed to fetch messages:', error)
      } finally {
        if (isMessageOperationCurrent(this, operation)) this.loading = false
      }
    },

    async fetchUnreadTotal (operation = captureMessageOperation(this)) {
      try {
        assertMessageOperationCurrent(this, operation)
        if (!hasStoredApiToken()) {
          this.unreadTotal = 0
          return
        }

        const userId = await this.ensureUserId(operation)
        assertMessageOperationCurrent(this, operation)
        if (!userId) {
          this.unreadTotal = 0
          return
        }

        const result = await msgApi.list('/list', {
          pageNum: 1,
          pageSize: 1,
          search: {
            userId,
            status: MSG_STATUS.UNREAD
          }
        }, { authStore: operation.authStore, autoLoading: false, signal: operation.signal })
        assertMessageOperationCurrent(this, operation)
        this.unreadTotal = this.normalizeTotal(result, this.normalizeListResult(result).length)
      } catch (error) {
        if (!isMessageOperationCurrent(this, operation)) assertMessageOperationCurrent(this, operation)
        this.unreadTotal = 0
        log.debug('Failed to fetch unread messages:', error)
      }
    },

    async markRead (id) {
      const operation = captureMessageOperation(this)
      try {
        assertMessageOperationCurrent(this, operation)
        if (!hasStoredApiToken()) return
        await msgApi.get('/read', { id }, { authStore: operation.authStore, autoLoading: false, signal: operation.signal })
        assertMessageOperationCurrent(this, operation)
        const message = this.messages.find(item => item.id === id)
        if (message) message.status = MSG_STATUS.READ
        await this.fetchUnreadTotal(operation)
      } catch (error) {
        if (!isMessageOperationCurrent(this, operation)) assertMessageOperationCurrent(this, operation)
        throw error
      }
    },

    async markAllRead () {
      const operation = captureMessageOperation(this)
      try {
        assertMessageOperationCurrent(this, operation)
        if (!hasStoredApiToken()) return
        const userId = await this.ensureUserId(operation)
        assertMessageOperationCurrent(this, operation)
        if (!userId) return
        await msgApi.get('/readall', { userId }, { authStore: operation.authStore, autoLoading: false, signal: operation.signal })
        assertMessageOperationCurrent(this, operation)
        this.messages = this.messages.map(message => ({
          ...message,
          status: MSG_STATUS.READ
        }))
        this.unreadTotal = 0
      } catch (error) {
        if (!isMessageOperationCurrent(this, operation)) assertMessageOperationCurrent(this, operation)
        throw error
      }
    },

    async recycle (id) {
      const operation = captureMessageOperation(this)
      try {
        assertMessageOperationCurrent(this, operation)
        if (!hasStoredApiToken()) return
        await msgApi.get('/recycle', { id }, { authStore: operation.authStore, autoLoading: false, signal: operation.signal })
        assertMessageOperationCurrent(this, operation)
        this.messages = this.messages.filter(item => item.id !== id)
        this.total = Math.max(0, this.total - 1)
        await this.fetchUnreadTotal(operation)
      } catch (error) {
        if (!isMessageOperationCurrent(this, operation)) assertMessageOperationCurrent(this, operation)
        throw error
      }
    }
  }
})

export { MSG_STATUS }

const messageCleanupByStore = new WeakMap()

export function useMessageStore (pinia) {
  const store = useMessageStoreBase(pinia)
  if (!messageCleanupByStore.has(store)) {
    messageLifecycle(store)
    const unregister = registerIdentityCleanup(() => store.clearMessageState())
    const dispose = store.$dispose.bind(store)
    let disposed = false
    store.$dispose = () => {
      if (disposed) return
      disposed = true
      unregister()
      resetMessageLifecycle(store, { disposed: true })
      messageCleanupByStore.delete(store)
      dispose()
    }
    messageCleanupByStore.set(store, unregister)
  }
  return store
}

useMessageStore.$id = useMessageStoreBase.$id
