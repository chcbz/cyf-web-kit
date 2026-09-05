import { agentApi } from '../composables/useHttp.js'

// Roster search is POST, matching useHallData; create and search share that verb.
export const loadSkillMarketRoster = (options = {}) =>
  agentApi.create('/roster', { pageNum: 1, pageSize: 50 }, { autoLoading: false, ...options })
