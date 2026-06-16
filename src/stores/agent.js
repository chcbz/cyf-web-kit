import { defineStore } from 'pinia'
import { agentApi } from '@/composables/useHttp'
import { log } from '@/utils/logger'

export const AGENT_STATUS = {
  ONLINE: 'online',
  BUSY: 'busy',
  OFFLINE: 'offline',
  ERROR: 'error'
}

const DEMO_AGENTS = [
  {
    id: 'agent-songjiang',
    agentId: 'agent-songjiang',
    name: '宋江',
    title: '及时雨',
    status: AGENT_STATUS.ONLINE,
    avatar: '',
    abilities: ['协调', '任务拆解', '风险判断'],
    endpoint: 'local-demo',
    personaName: '宋江',
    slogan: '各位有何高见，且在厅中议定。',
    stats: {
      success: 18,
      failure: 1,
      totalScore: 86
    }
  },
  {
    id: 'agent-wuyong',
    agentId: 'agent-wuyong',
    name: '吴用',
    title: '智多星',
    status: AGENT_STATUS.BUSY,
    avatar: '',
    abilities: ['策划', '分析', '代码审查'],
    endpoint: 'local-demo',
    personaName: '吴用',
    slogan: '此事可分三路推进。',
    currentTask: {
      id: 'task-review-api',
      title: '梳理 Agent API 契约'
    },
    stats: {
      success: 24,
      failure: 2,
      totalScore: 92
    }
  },
  {
    id: 'agent-wusong',
    agentId: 'agent-wusong',
    name: '武松',
    title: '行者',
    status: AGENT_STATUS.OFFLINE,
    avatar: '',
    abilities: ['执行', '异常排查', '验证'],
    endpoint: 'local-demo',
    personaName: '武松',
    slogan: '有事尽管吩咐。',
    stats: {
      success: 12,
      failure: 0,
      totalScore: 80
    }
  },
  {
    id: 'agent-husanniang',
    agentId: 'agent-husanniang',
    name: '扈三娘',
    title: '一丈青',
    status: AGENT_STATUS.ONLINE,
    avatar: '',
    abilities: ['突击', '协同', '任务执行'],
    endpoint: 'local-demo',
    personaName: '扈三娘',
    slogan: '若要速破阵脚，我愿先行。',
    stats: {
      success: 21,
      failure: 1,
      totalScore: 89
    }
  }
]

const DEMO_TASKS = [
  {
    id: 'task-review-api',
    title: '梳理 Agent API 契约',
    description: '确认 /agent/list、/agent/{id}、/agent/tasks/search 的前后端字段一致性。',
    status: 'running',
    priority: 'high',
    reward: 80,
    requiredAbilities: ['分析', '代码审查'],
    assignedAgentId: 'agent-wuyong',
    assignedAgentName: '吴用',
    updatedAt: Date.now() - 1000 * 60 * 25
  },
  {
    id: 'task-verify-hall',
    title: '验证聚义厅页面状态联动',
    description: '模拟在线、忙碌、离线和异常状态，确认卡片、详情和任务榜同步。',
    status: 'pending',
    priority: 'medium',
    reward: 50,
    requiredAbilities: ['验证', '异常排查'],
    assignedAgentId: '',
    assignedAgentName: '',
    updatedAt: Date.now() - 1000 * 60 * 60
  }
]

const unwrapPayload = (result) => {
  const body = result?.data ?? result
  if (body && typeof body === 'object' && 'data' in body) {
    return body.data
  }
  return body
}

const normalizeList = (result) => {
  const payload = unwrapPayload(result)
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload?.list)) return payload.list
  if (Array.isArray(payload?.records)) return payload.records
  if (Array.isArray(payload?.rows)) return payload.rows
  return []
}

const normalizeTotal = (result, fallbackLength) => {
  const body = result?.data ?? result
  const payload = unwrapPayload(result)
  if (typeof body?.total === 'number') return body.total
  if (typeof payload?.total === 'number') return payload.total
  return fallbackLength
}

const normalizeAgent = (agent = {}) => {
  const agentId = agent.agentId || agent.id || agent.name
  const currentTask = agent.currentTask || (
    agent.currentTaskId || agent.currentTaskTitle
      ? {
        id: agent.currentTaskId || '',
        title: agent.currentTaskTitle || agent.currentTaskId || ''
      }
      : null
  )
  const abilities = Array.isArray(agent.abilities)
    ? agent.abilities
    : String(agent.abilities || '')
      .split(',')
      .map(item => item.trim())
      .filter(Boolean)

  return {
    ...agent,
    id: agent.id || agentId,
    agentId,
    name: agent.name || agent.personaName || agentId || 'Agent',
    title: agent.title || agent.personaTitle || agent.personaName || '',
    status: agent.status || AGENT_STATUS.OFFLINE,
    avatar: agent.avatar || '',
    abilities,
    currentTask,
    stats: agent.stats || {
      success: agent.successCount || agent.completedTaskCount || 0,
      failure: agent.failureCount || agent.failedTaskCount || 0,
      totalScore: agent.totalScore || 0
    },
    currentTaskId: agent.currentTaskId || currentTask?.id || '',
    currentTaskTitle: agent.currentTaskTitle || currentTask?.title || ''
  }
}

const normalizeTask = (task = {}) => {
  const requiredAbilities = Array.isArray(task.requiredAbilities)
    ? task.requiredAbilities
    : String(task.requiredAbilities || task.abilities || '')
      .split(',')
      .map(item => item.trim())
      .filter(Boolean)

  return {
    ...task,
    id: task.id || task.taskId || task.name,
    title: task.title || task.name || '未命名任务',
    description: task.description || task.remark || '',
    status: task.status || 'pending',
    priority: task.priority || 'medium',
    reward: task.reward ?? task.point ?? 0,
    requiredAbilities,
    assignedAgentId: task.assignedAgentId || task.agentId || '',
    assignedAgentName: task.assignedAgentName || task.agentName || '',
    updatedAt: task.updatedAt || task.updateTime || task.createTime || Date.now()
  }
}

const compactParams = (params) => {
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== '')
  )
}

export const useAgentStore = defineStore('agent', {
  state: () => ({
    agents: [],
    tasks: [],
    total: 0,
    taskTotal: 0,
    selectedAgentId: '',
    loading: false,
    taskLoading: false,
    assigning: false,
    error: '',
    taskError: '',
    statusFilter: '',
    abilityFilter: '',
    taskStatusFilter: '',
    taskKeyword: '',
    usingFallback: false,
    lastUpdatedAt: 0
  }),
  getters: {
    selectedAgent: (state) => {
      return state.agents.find(agent => agent.agentId === state.selectedAgentId || agent.id === state.selectedAgentId) || null
    },
    onlineTotal: (state) => state.agents.filter(agent => agent.status === AGENT_STATUS.ONLINE).length,
    busyTotal: (state) => state.agents.filter(agent => agent.status === AGENT_STATUS.BUSY).length,
    availableAgents: (state) => state.agents.filter(agent => agent.status === AGENT_STATUS.ONLINE)
  },
  actions: {
    setFallbackAgents () {
      this.usingFallback = true
      this.agents = DEMO_AGENTS.map(normalizeAgent)
      this.total = this.agents.length
      if (!this.selectedAgentId && this.agents.length) {
        this.selectedAgentId = this.agents[0].agentId
      }
    },

    setFallbackTasks () {
      this.tasks = DEMO_TASKS.map(normalizeTask)
      this.taskTotal = this.tasks.length
    },

    async fetchAgents (options = {}) {
      this.loading = true
      this.error = ''
      this.statusFilter = options.status ?? this.statusFilter
      this.abilityFilter = options.ability ?? this.abilityFilter

      try {
        const params = compactParams({
          status: this.statusFilter || undefined,
          ability: this.abilityFilter || undefined
        })
        const result = await agentApi.get('/list', params, {
          autoLoading: false,
          needAuth: false
        })
        const agents = normalizeList(result).map(normalizeAgent)
        this.agents = agents
        this.total = normalizeTotal(result, agents.length)
        this.usingFallback = false
        if (!this.selectedAgentId && agents.length) {
          this.selectedAgentId = agents[0].agentId
        }
      } catch (error) {
        this.error = error.message || 'Agent 列表加载失败，当前显示本地示例'
        this.setFallbackAgents()
        log.warn('Failed to fetch agent list:', error)
      } finally {
        this.loading = false
        this.lastUpdatedAt = Date.now()
      }
    },

    async fetchAgentDetail (agentId) {
      if (!agentId) return null
      this.selectedAgentId = agentId

      try {
        const result = await agentApi.get(`/${encodeURIComponent(agentId)}`, {}, {
          autoLoading: false,
          needAuth: false
        })
        const payload = unwrapPayload(result)
        const detail = normalizeAgent(payload)
        const index = this.agents.findIndex(agent => agent.agentId === detail.agentId || agent.id === detail.id)
        if (index >= 0) {
          this.agents.splice(index, 1, { ...this.agents[index], ...detail })
        } else {
          this.agents.push(detail)
          this.total = this.agents.length
        }
        return detail
      } catch (error) {
        this.error = error.message || 'Agent 详情加载失败'
        log.debug('Failed to fetch agent detail:', error)
        return this.selectedAgent
      }
    },

    async fetchRewardTasks (options = {}) {
      this.taskLoading = true
      this.taskError = ''
      this.taskStatusFilter = options.status ?? this.taskStatusFilter
      this.taskKeyword = options.keyword ?? this.taskKeyword

      try {
        const result = await agentApi.search('/tasks/search', compactParams({
          pageNum: options.pageNum || 1,
          pageSize: options.pageSize || 20,
          status: this.taskStatusFilter || undefined,
          keyword: this.taskKeyword || undefined,
          ability: this.abilityFilter || undefined
        }), {
          autoLoading: false,
          needAuth: false
        })
        const tasks = normalizeList(result).map(normalizeTask)
        this.tasks = tasks
        this.taskTotal = normalizeTotal(result, tasks.length)
      } catch (error) {
        this.taskError = error.message || '悬赏榜加载失败，当前显示本地示例'
        this.setFallbackTasks()
        log.warn('Failed to fetch reward tasks:', error)
      } finally {
        this.taskLoading = false
      }
    },

    async assignTask (taskId, agentId) {
      if (!taskId || !agentId || this.assigning) return
      this.assigning = true

      try {
        await agentApi.create(`/tasks/${encodeURIComponent(taskId)}/assign`, {
          agentId,
          allowQueue: false
        }, {
          autoLoading: false,
          needAuth: false
        })

        const agent = this.agents.find(item => item.agentId === agentId || item.id === agentId)
        const task = this.tasks.find(item => item.id === taskId)
        if (task && agent) {
          task.assignedAgentId = agent.agentId
          task.assignedAgentName = agent.name
          task.status = 'assigned'
          task.updatedAt = Date.now()
        }
      } finally {
        this.assigning = false
      }
    },

    async updateAgentStatus (event = {}) {
      const agentId = event.agentId || event.id
      if (!agentId) return

      const index = this.agents.findIndex(agent => agent.agentId === agentId || agent.id === agentId)
      if (index < 0) {
        await this.fetchAgents()
        return
      }

      const currentTask = event.status === AGENT_STATUS.OFFLINE ? null : event.currentTask || this.agents[index].currentTask
      this.agents.splice(index, 1, {
        ...this.agents[index],
        status: event.status || this.agents[index].status,
        currentTask,
        errorMessage: event.errorMessage || '',
        updatedAt: event.updatedAt || Date.now()
      })
    },

    selectAgent (agentId) {
      this.selectedAgentId = agentId
    }
  }
})

export { normalizeAgent, normalizeTask }
