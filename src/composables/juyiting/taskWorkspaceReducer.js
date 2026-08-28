import { compareTaskEventVersions, nextTaskEventVersion, parseTaskEventVersion } from './taskEventVersion'

const MAX_COLLECTION = 499
const MAX_RECENT = 100
const ACTOR_TYPES = new Set(['agent', 'role', 'system'])
const AGGREGATE_TYPES = new Set(['task', 'member', 'work_item', 'request', 'artifact', 'thread', 'message'])
const EVENT_TYPES = new Set(['TASK_CREATED', 'TASK_ASSIGNED', 'TASK_STARTED', 'TASK_BLOCKED', 'TASK_ARCHIVED', 'TEAM_PROPOSED', 'TASK_REVIEWING', 'TASK_COMPLETED', 'TASK_FAILED', 'TASK_CANCELLED', 'MEMBER_INVITED', 'MEMBER_ACCEPTED', 'MEMBER_REJECTED', 'MEMBER_BLOCKED', 'MEMBER_WORKING', 'MEMBER_DONE', 'MEMBER_FAILED', 'MEMBER_LEFT', 'WORK_ITEM_CREATED', 'WORK_ITEM_READY', 'WORK_ITEM_CLAIMED', 'WORK_ITEM_STARTED', 'WORK_ITEM_SUBMITTED', 'WORK_ITEM_COMPLETED', 'WORK_ITEM_REQUEUED', 'WORK_ITEM_BLOCKED', 'WORK_ITEM_FAILED', 'WORK_ITEM_CANCELLED', 'WORK_ITEM_LEASE_RENEWED', 'WORK_ITEM_LEASE_RELEASED', 'PROGRESS_REPORTED', 'HELP_REQUESTED', 'REVIEW_REQUESTED', 'REQUEST_CREATED', 'REQUEST_ACKNOWLEDGED', 'REQUEST_RESOLVED', 'REQUEST_REJECTED', 'REQUEST_CANCELLED', 'THREAD_CREATED', 'MESSAGE_POSTED', 'ARTIFACT_PUBLISHED', 'COMMAND_DELIVERY_FAILED', 'HISTORICAL_BASELINE_IMPORTED'])
const ID_KEYS = new Set(['taskId', 'agentId', 'memberId', 'workItemId', 'assigneeAgentId', 'requestId', 'targetId', 'artifactId', 'threadId', 'conversationId', 'messageId', 'senderAgentId', 'noteId'])
const METADATA_KEYS = new Set(['fromStatus', 'toStatus', 'status', 'reasonCode', 'role', 'source', 'decisionCode', 'taskType', 'requestType', 'targetType', 'artifactType', 'visibility', 'threadType', 'messageType', 'noteType'])
const LONG_KEYS = new Set(['expectedVersion', 'resultVersion', 'artifactVersion', 'attemptCount', 'maxAttempts', 'contentByteLength', 'memberCount', 'workItemCount', 'completedWorkItemCount', 'failedWorkItemCount', 'createdAt', 'updatedAt', 'assignedAt', 'startedAt', 'completedAt', 'acknowledgedAt', 'resolvedAt', 'cancelledAt', 'publishedAt', 'previousLeaseExpiresAt', 'leaseExpiresAt'])
const PAYLOAD_KEYS = new Set([...ID_KEYS, ...METADATA_KEYS, ...LONG_KEYS, 'contentSha256'])
const METADATA_TOKEN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/
const SENSITIVE_METADATA_MARKERS = ['authorization', 'bearer ', 'basic ', 'api-key', 'api_key', 'cookie', 'credential', 'header', 'private key', 'token']
const MAX_PAYLOAD_KEYS = 32
const MAX_INT = 2147483647
const MIN_INT = -2147483648
const TASK_STATUS = { TASK_ASSIGNED: 'assigned', TASK_STARTED: 'running', TASK_BLOCKED: 'blocked', TASK_ARCHIVED: 'archived', TEAM_PROPOSED: 'planning', TASK_REVIEWING: 'reviewing', TASK_COMPLETED: 'completed', TASK_FAILED: 'failed', TASK_CANCELLED: 'cancelled' }
const MEMBER_STATUS = { MEMBER_INVITED: 'invited', MEMBER_ACCEPTED: 'accepted', MEMBER_REJECTED: 'rejected', MEMBER_BLOCKED: 'blocked', MEMBER_WORKING: 'working', MEMBER_DONE: 'done', MEMBER_FAILED: 'failed', MEMBER_LEFT: 'left' }
const WORK_STATUS = { WORK_ITEM_READY: 'ready', WORK_ITEM_CLAIMED: 'claimed', WORK_ITEM_STARTED: 'running', WORK_ITEM_SUBMITTED: 'submitted', WORK_ITEM_COMPLETED: 'completed', WORK_ITEM_REQUEUED: 'ready', WORK_ITEM_BLOCKED: 'blocked', WORK_ITEM_FAILED: 'failed', WORK_ITEM_CANCELLED: 'cancelled' }
const REQUEST_STATUS = { HELP_REQUESTED: 'open', REVIEW_REQUESTED: 'open', REQUEST_CREATED: 'open', REQUEST_ACKNOWLEDGED: 'acknowledged', REQUEST_RESOLVED: 'resolved', REQUEST_REJECTED: 'rejected', REQUEST_CANCELLED: 'cancelled' }
const TASK_SNAPSHOT_STATUSES = new Set(['open', 'assigned', 'running', 'blocked', 'planning', 'reviewing', 'completed', 'failed', 'cancelled', 'archived'])
const MEMBER_SNAPSHOT_STATUSES = new Set(['invited', 'accepted', 'working', 'blocked', 'done', 'failed', 'rejected', 'left'])
const WORK_SNAPSHOT_STATUSES = new Set(['pending', 'ready', 'claimed', 'running', 'submitted', 'completed', 'blocked', 'failed', 'cancelled'])
const REQUEST_SNAPSHOT_STATUSES = new Set(['open', 'acknowledged'])
const ROLES = new Set(['coordinator', 'worker', 'reviewer', 'observer'])
const SOURCES = new Set(['manual', 'auto', 'migration', 'legacy'])
const STATE_EVENTS = new Set([...Object.keys(TASK_STATUS), ...Object.keys(MEMBER_STATUS), 'WORK_ITEM_CREATED', ...Object.keys(WORK_STATUS), 'WORK_ITEM_LEASE_RENEWED', 'WORK_ITEM_LEASE_RELEASED', ...Object.keys(REQUEST_STATUS), 'ARTIFACT_PUBLISHED', 'TASK_CREATED', 'THREAD_CREATED', 'HISTORICAL_BASELINE_IMPORTED'])

export function createEmptyTaskWorkspace () {
  return { task: null, members: [], workItems: [], openRequests: [], recentArtifacts: [], recentArtifactsTruncated: false, conversationId: null, recentEvents: [], timelineTruncated: false, currentVersion: '0' }
}

export function validateTaskWorkspaceSnapshot (snapshot, { taskId } = {}) {
  if (!isRecord(snapshot) || !hasExactKeys(snapshot, ['task', 'members', 'workItems', 'openRequests', 'recentArtifacts', 'recentArtifactsTruncated', 'conversationId', 'recentEvents', 'timelineTruncated', 'currentVersion'])) return null
  if (!validTask(snapshot.task) || (taskId != null && snapshot.task.taskId !== taskId) || parseTaskEventVersion(snapshot.currentVersion) == null) return null
  if (!Array.isArray(snapshot.members) || !Array.isArray(snapshot.workItems) || !Array.isArray(snapshot.openRequests) || !Array.isArray(snapshot.recentArtifacts) || !Array.isArray(snapshot.recentEvents)) return null
  if (snapshot.members.length === 0 || snapshot.members.length > MAX_COLLECTION || snapshot.workItems.length > MAX_COLLECTION || snapshot.openRequests.length > MAX_COLLECTION || snapshot.recentArtifacts.length > MAX_RECENT || snapshot.recentEvents.length > MAX_RECENT) return null
  if (typeof snapshot.recentArtifactsTruncated !== 'boolean' || typeof snapshot.timelineTruncated !== 'boolean' || !nullableId(snapshot.conversationId)) return null
  if (!snapshot.members.every(validMember) || !snapshot.workItems.every(validWorkItem) || !snapshot.openRequests.every(validRequest) || !snapshot.recentArtifacts.every(validArtifact) || !snapshot.recentEvents.every(validTimelineEvent)) return null
  if (!uniqueBy(snapshot.members, item => item.agentId) || !uniqueBy(snapshot.workItems, item => item.workItemId) || !uniqueBy(snapshot.openRequests, item => item.requestId) || !uniqueBy(snapshot.recentArtifacts, item => `${item.artifactId}\u0000${item.artifactVersion}`)) return null
  if (snapshot.recentArtifactsTruncated && snapshot.recentArtifacts.length !== MAX_RECENT) return null
  if (!validTimelineCursor(snapshot.recentEvents, snapshot.currentVersion, snapshot.timelineTruncated)) return null
  return clone(snapshot)
}

export function applyTaskWorkspaceEvent (workspace, event) {
  const current = validateTaskWorkspaceSnapshot(workspace)
  if (!current) return resync('workspace_invalid')
  const parsed = validateDurableEvent(event, current.task.taskId)
  if (!parsed) return resync('payload_invalid')
  const ordering = compareTaskEventVersions(parsed.version, current.currentVersion)
  if (ordering <= 0) return { kind: 'duplicate', workspace: current }
  if (parsed.version !== nextTaskEventVersion(current.currentVersion)) return resync('gap')
  if (parsed.redacted) return resync('state_projection_unprovable')
  const next = clone(current)
  if (STATE_EVENTS.has(parsed.eventType) && !applyAllowlistedTransition(next, parsed)) return resync('state_projection_unprovable')
  appendTimeline(next, parsed)
  next.currentVersion = parsed.version
  return { kind: 'applied', workspace: next }
}

function validTask (value) {
  return validDto(value, ['taskId', 'status', 'assignedAgentId', 'requiredAbilities', 'reward', 'assignedAt', 'startedAt', 'completedAt', 'collaborationMode', 'riskLevel', 'maxAgents', 'coordinatorAgentId', 'reviewRequired', 'version'], ['taskId', 'status', 'assignedAgentId', 'requiredAbilities', 'assignedAt', 'startedAt', 'completedAt', 'collaborationMode', 'riskLevel', 'coordinatorAgentId'], ['reward', 'maxAgents'], ['reviewRequired'], ['version']) && validId(value.taskId) && TASK_SNAPSHOT_STATUSES.has(value.status) && (value.assignedAgentId == null || validId(value.assignedAgentId)) && ['single', 'team'].includes(value.collaborationMode) && ['low', 'medium', 'high'].includes(value.riskLevel) && typeof value.reviewRequired === 'boolean' && nullableJavaLong(value.assignedAt) && nullableJavaLong(value.startedAt) && nullableJavaLong(value.completedAt) && nullableInt(value.reward, 0) && positiveInt(value.maxAgents)
}
function validMember (value) {
  return validDto(value, ['agentId', 'role', 'status', 'assignmentSource', 'joinedAt', 'acceptedAt', 'startedAt', 'completedAt', 'lastHeartbeatAt', 'version'], ['agentId', 'role', 'status', 'assignmentSource', 'joinedAt', 'acceptedAt', 'startedAt', 'completedAt', 'lastHeartbeatAt'], [], [], ['version']) && validId(value.agentId) && ROLES.has(value.role) && MEMBER_SNAPSHOT_STATUSES.has(value.status) && SOURCES.has(value.assignmentSource) && nullableJavaLong(value.joinedAt) && nullableJavaLong(value.acceptedAt) && nullableJavaLong(value.startedAt) && nullableJavaLong(value.completedAt) && nullableJavaLong(value.lastHeartbeatAt)
}
function validWorkItem (value) {
  return validDto(value, ['workItemId', 'title', 'description', 'workType', 'requiredAbilities', 'assigneeAgentId', 'status', 'priority', 'requiredItem', 'dependencyJson', 'leaseUntil', 'attemptCount', 'maxAttempts', 'resultArtifactId', 'submittedAt', 'completedAt', 'version'], ['workItemId', 'title', 'description', 'workType', 'requiredAbilities', 'assigneeAgentId', 'status', 'dependencyJson', 'leaseUntil', 'resultArtifactId', 'submittedAt', 'completedAt'], ['priority', 'attemptCount', 'maxAttempts'], ['requiredItem'], ['version']) && validId(value.workItemId) && validText(value.title, 255) && validIdMaximum(value.workType, 30) && WORK_SNAPSHOT_STATUSES.has(value.status) && typeof value.requiredItem === 'boolean' && nullableJavaLong(value.leaseUntil) && nullableJavaLong(value.submittedAt) && nullableJavaLong(value.completedAt) && intRange(value.priority) && nonnegativeInt(value.attemptCount) && positiveInt(value.maxAttempts) && (value.assigneeAgentId == null || validId(value.assigneeAgentId)) && (value.resultArtifactId == null || validId(value.resultArtifactId))
}
function validRequest (value) {
  return validDto(value, ['requestId', 'workItemId', 'requesterAgentId', 'targetType', 'targetId', 'requestType', 'status', 'priority', 'title', 'description', 'dueAt', 'acknowledgedAt', 'version'], ['workItemId', 'dueAt', 'acknowledgedAt'], ['priority'], [], ['version']) && validId(value.requestId) && validId(value.requesterAgentId) && validId(value.targetId) && ['agent', 'role'].includes(value.targetType) && (value.targetType !== 'role' || ROLES.has(value.targetId)) && ['help', 'clarification', 'dependency', 'review', 'resource', 'reassignment', 'approval'].includes(value.requestType) && REQUEST_SNAPSHOT_STATUSES.has(value.status) && validText(value.title, 255) && typeof value.description === 'string' && intRange(value.priority) && nullableJavaLong(value.dueAt) && nullableJavaLong(value.acknowledgedAt) && (value.workItemId == null || validId(value.workItemId))
}
function validArtifact (value) {
  return validDto(value, ['artifactId', 'workItemId', 'producerAgentId', 'artifactType', 'title', 'artifactVersion', 'visibility', 'createdAt'], ['workItemId'], [], [], ['artifactVersion']) && validId(value.artifactId) && validId(value.producerAgentId) && validIdMaximum(value.artifactType, 30) && validText(value.title, 255) && ['task_members', 'reviewer', 'private'].includes(value.visibility) && positiveDecimal(value.artifactVersion) && positiveDecimal(value.createdAt) && (value.workItemId == null || validId(value.workItemId))
}
function validDto (value, keys, strings, integers, booleans, versions) { return isRecord(value) && hasExactKeys(value, keys) && strings.every(key => nullableString(value[key])) && integers.every(key => value[key] == null || Number.isInteger(value[key])) && booleans.every(key => value[key] == null || typeof value[key] === 'boolean') && versions.every(key => parseTaskEventVersion(value[key]) != null) }
function validTimelineEvent (value) {
  if (!isRecord(value)) return false
  if (value.redacted === true) return hasExactKeys(value, ['version', 'redacted']) && positiveDecimal(value.version)
  if (!hasRequiredAndOnlyKeys(value, ['version', 'redacted', 'eventType', 'actorType', 'aggregateType', 'aggregateId', 'occurredAt'], ['actorId']) || value.redacted !== false || !positiveDecimal(value.version) || !EVENT_TYPES.has(value.eventType) || !ACTOR_TYPES.has(value.actorType) || !AGGREGATE_TYPES.has(value.aggregateType) || !validId(value.aggregateId) || !positiveDecimal(value.occurredAt)) return false
  return value.actorType === 'system'
    ? !Object.hasOwn(value, 'actorId') || nullableId(value.actorId)
    : Object.hasOwn(value, 'actorId') && validId(value.actorId)
}
function validTimelineCursor (events, cursor, truncated) {
  if (cursor === '0') return events.length === 0 && truncated === false
  if (events.length === 0 || events.at(-1).version !== cursor) return false
  for (let index = 1; index < events.length; index += 1) if (events[index].version !== nextTaskEventVersion(events[index - 1].version)) return false
  return truncated === (events[0].version !== '1')
}
function validateDurableEvent (event, taskId) {
  if (!isRecord(event) || !positiveDecimal(event.version)) return null
  if (event.redacted === true) return hasExactKeys(event, ['version', 'redacted']) ? { version: event.version, redacted: true } : null
  if (!hasExactKeys(event, ['version', 'eventId', 'eventType', 'actorType', 'actorId', 'aggregateType', 'aggregateId', 'payload', 'occurredAt']) || !validId(event.eventId) || !EVENT_TYPES.has(event.eventType) || !ACTOR_TYPES.has(event.actorType) || !AGGREGATE_TYPES.has(event.aggregateType) || !validId(event.aggregateId) || !nullableId(event.actorId) || !positiveDecimal(event.occurredAt) || !isRecord(event.payload)) return null
  if (Object.keys(event.payload).length > MAX_PAYLOAD_KEYS || !validPayload(event.payload)) return null
  return validEventContract(event, taskId) ? clone(event) : null
}
function validPayload (payload) {
  return Object.entries(payload).every(([key, value]) => {
    if (!PAYLOAD_KEYS.has(key) || typeof value !== 'string') return false
    if (ID_KEYS.has(key)) return validId(value)
    if (METADATA_KEYS.has(key)) return validMetadata(value)
    if (LONG_KEYS.has(key)) return parseTaskEventVersion(value) != null
    return key === 'contentSha256' && /^[0-9a-f]{64}$/.test(value)
  })
}

function applyAllowlistedTransition (workspace, event) {
  const payload = event.payload
  if (Object.hasOwn(TASK_STATUS, event.eventType)) {
    const task = workspace.task
    if (!matchesTransition(task, payload)) return false
    const timestamp = ({ TASK_ASSIGNED: 'assignedAt', TASK_STARTED: 'startedAt', TASK_COMPLETED: 'completedAt' })[event.eventType]
    if (timestamp != null && !positiveDecimal(payload[timestamp])) return false
    if (event.eventType === 'TASK_ASSIGNED' && !validId(payload.assigneeAgentId)) return false
    task.status = payload.toStatus
    task.version = payload.resultVersion
    if (timestamp != null) task[timestamp] = payload[timestamp]
    if (event.eventType === 'TASK_ASSIGNED') task.assignedAgentId = payload.assigneeAgentId
    return true
  }
  if (Object.hasOwn(MEMBER_STATUS, event.eventType) && event.eventType !== 'MEMBER_INVITED') {
    const member = workspace.members.find(item => item.agentId === event.aggregateId)
    if (!member || !matchesTransition(member, payload) || payload.role !== member.role) return false
    // Terminal member updates write completedAt server-side without a contractual payload delta.
    if (['MEMBER_DONE', 'MEMBER_REJECTED', 'MEMBER_FAILED', 'MEMBER_LEFT'].includes(event.eventType)) return false
    const timestamp = ({ MEMBER_ACCEPTED: 'acceptedAt', MEMBER_WORKING: 'startedAt' })[event.eventType]
    if (timestamp != null && !positiveDecimal(payload[timestamp])) return false
    member.status = payload.toStatus
    member.version = payload.resultVersion
    if (timestamp != null) member[timestamp] = payload[timestamp]
    return true
  }
  // Work-item events do not carry a complete DTO delta (attempts, assignee, lease,
  // submitted/completed/result fields vary by transition), so they are never partially applied.
  if (['REQUEST_ACKNOWLEDGED', 'REQUEST_RESOLVED', 'REQUEST_REJECTED', 'REQUEST_CANCELLED'].includes(event.eventType)) {
    const index = workspace.openRequests.findIndex(item => item.requestId === event.aggregateId)
    const request = workspace.openRequests[index]
    if (!request || !matchesTransition(request, payload)) return false
    if (event.eventType === 'REQUEST_ACKNOWLEDGED') {
      if (!positiveDecimal(payload.acknowledgedAt)) return false
      request.status = payload.toStatus
      request.version = payload.resultVersion
      request.acknowledgedAt = payload.acknowledgedAt
    } else {
      workspace.openRequests.splice(index, 1)
    }
    return true
  }
  return false
}
function matchesTransition (entity, payload) {
  return payload.fromStatus === entity.status && payload.expectedVersion === entity.version && payload.resultVersion === nextTaskEventVersion(entity.version)
}

function validEventContract (event, taskId) {
  const { eventType: type, actorType, actorId, aggregateType, aggregateId, payload } = event
  const system = actorType === 'system' && actorId == null
  const agent = actorType === 'agent' && validId(actorId)
  const role = actorType === 'role' && validId(actorId)
  if (type === 'TASK_CREATED') return aggregateType === 'task' && aggregateId === taskId && system && required(payload, { taskId, taskType: true, status: true, resultVersion: true, createdAt: true })
  if (Object.hasOwn(TASK_STATUS, type)) return aggregateType === 'task' && aggregateId === taskId && system && required(payload, { fromStatus: true, toStatus: TASK_STATUS[type], resultVersion: true }) && (type === 'TASK_ASSIGNED' || payload.expectedVersion != null)
  if (type === 'PROGRESS_REPORTED') return aggregateType === 'task' && aggregateId === taskId && system && required(payload, { noteId: true, noteType: true, contentSha256: true }) && digest(payload)
  if (Object.hasOwn(MEMBER_STATUS, type)) return aggregateType === 'member' && system && required(payload, { agentId: aggregateId, role: true, toStatus: MEMBER_STATUS[type], resultVersion: true }) && (payload.memberId == null || payload.memberId === aggregateId)
  if (type.startsWith('WORK_ITEM_')) return validWorkEvent(type, aggregateType, aggregateId, payload, system, agent)
  if (Object.hasOwn(REQUEST_STATUS, type)) return aggregateType === 'request' && agent && validRequestPayload(type, aggregateId, payload)
  if (type === 'ARTIFACT_PUBLISHED') return aggregateType === 'artifact' && agent && required(payload, { artifactId: aggregateId, artifactType: true, artifactVersion: true, visibility: true, contentSha256: true }) && positiveDecimal(payload.artifactVersion) && ['task_members', 'reviewer', 'private'].includes(payload.visibility) && digest(payload) && (payload.workItemId == null || validId(payload.workItemId))
  if (type === 'THREAD_CREATED') return aggregateType === 'thread' && agent && required(payload, { threadId: aggregateId, threadType: true, conversationId: true, createdAt: true })
  if (type === 'MESSAGE_POSTED') return aggregateType === 'message' && agent && required(payload, { messageId: aggregateId, messageType: true, conversationId: true, senderAgentId: actorId, createdAt: true, contentSha256: true }) && digest(payload)
  if (type === 'COMMAND_DELIVERY_FAILED') return aggregateType === 'task' && aggregateId === taskId && (system || role) && required(payload, { reasonCode: true })
  return type === 'HISTORICAL_BASELINE_IMPORTED' && aggregateType === 'task' && aggregateId === taskId && actorType === 'system' && actorId === 'c01h-b09' && required(payload, { source: 'b09', decisionCode: 'c01h_b09_v1', contentSha256: true, memberCount: true, workItemCount: true }) && digest(payload)
}
function validWorkEvent (type, aggregateType, aggregateId, payload, system, agent) {
  if (aggregateType !== 'work_item' || !required(payload, { workItemId: aggregateId })) return false
  const actorOk = ['WORK_ITEM_CREATED', 'WORK_ITEM_READY', 'WORK_ITEM_REQUEUED', 'WORK_ITEM_BLOCKED', 'WORK_ITEM_COMPLETED', 'WORK_ITEM_FAILED'].includes(type) ? system : ['WORK_ITEM_CLAIMED', 'WORK_ITEM_LEASE_RENEWED', 'WORK_ITEM_LEASE_RELEASED'].includes(type) ? agent : system || agent
  if (!actorOk) return false
  if (type === 'WORK_ITEM_CREATED') return true
  const status = type === 'WORK_ITEM_LEASE_RENEWED' ? ['claimed', 'running'].includes(payload.toStatus) : type === 'WORK_ITEM_LEASE_RELEASED' ? ['ready', 'failed'].includes(payload.toStatus) : WORK_STATUS[type] === payload.toStatus
  return status && payload.resultVersion != null
}
function validRequestPayload (type, aggregateId, payload) { return required(payload, { requestId: aggregateId, requestType: true, targetType: true, targetId: true, toStatus: REQUEST_STATUS[type], resultVersion: true }) && ['help', 'clarification', 'dependency', 'review', 'resource', 'reassignment', 'approval'].includes(payload.requestType) && (payload.targetType === 'agent' || payload.targetType === 'role' && ['coordinator', 'worker', 'reviewer', 'observer'].includes(payload.targetId)) && !(type === 'HELP_REQUESTED' && payload.requestType !== 'help') && !(type === 'REVIEW_REQUESTED' && payload.requestType !== 'review') && !(type === 'REQUEST_CREATED' && ['help', 'review'].includes(payload.requestType)) }
function required (payload, expectations) { return Object.entries(expectations).every(([key, expected]) => expected === true ? payload[key] != null : payload[key] === expected) }
function digest (payload) { return /^[0-9a-f]{64}$/.test(payload.contentSha256) && (payload.contentByteLength == null || parseTaskEventVersion(payload.contentByteLength) != null) }
function appendTimeline (workspace, event) { workspace.recentEvents.push({ version: event.version, redacted: false, eventType: event.eventType, actorType: event.actorType, actorId: event.actorId, aggregateType: event.aggregateType, aggregateId: event.aggregateId, occurredAt: event.occurredAt }); if (workspace.recentEvents.length > MAX_RECENT) { workspace.recentEvents.splice(0, workspace.recentEvents.length - MAX_RECENT); workspace.timelineTruncated = true } }
function uniqueBy (values, key) { return new Set(values.map(key)).size === values.length }
function resync (reason) { return { kind: 'resync', reason } }
function isRecord (value) { return value != null && typeof value === 'object' && !Array.isArray(value) }
function hasExactKeys (value, keys) { const actual = Object.keys(value).sort(); const expected = [...keys].sort(); return actual.length === expected.length && actual.every((key, index) => key === expected[index]) }
function hasRequiredAndOnlyKeys (value, required, optional = []) { const actual = Object.keys(value); return required.every(key => Object.hasOwn(value, key)) && actual.every(key => required.includes(key) || optional.includes(key)) }
function nullableString (value) { return value == null || typeof value === 'string' }
function validId (value) {
  if (typeof value !== 'string' || hasUnpairedSurrogate(value)) return false
  const points = Array.from(value)
  return points.length > 0 && points.length <= 100 && !points.every(isJavaPaddingCharacter) && !isJavaPaddingCharacter(points[0]) && !isJavaPaddingCharacter(points.at(-1)) && !points.some(isIsoControlCharacter)
}
function validMetadata (value) {
  return typeof value === 'string' && !hasUnpairedSurrogate(value) && Array.from(value).length > 0 && Array.from(value).length <= 64 && METADATA_TOKEN.test(value) && !SENSITIVE_METADATA_MARKERS.some(marker => value.toLowerCase().includes(marker))
}
function validText (value, maximum) { return typeof value === 'string' && Array.from(value).some(point => !isJavaWhitespaceCharacter(point)) && !hasUnpairedSurrogate(value) && Array.from(value).length <= maximum && !Array.from(value).some(isIsoControlCharacter) }
function validIdMaximum (value, maximum) { return validId(value) && Array.from(value).length <= maximum }
function nullableId (value) { return value == null || validId(value) }
function nullableJavaLong (value) { return value == null || parseTaskEventVersion(value) != null }
function intRange (value) { return Number.isInteger(value) && value >= MIN_INT && value <= MAX_INT }
function nonnegativeInt (value) { return intRange(value) && value >= 0 }
function nullableInt (value, minimum) { return value == null || intRange(value) && value >= minimum }
function positiveInt (value) { return intRange(value) && value > 0 }
function positiveDecimal (value) { return parseTaskEventVersion(value) != null && value !== '0' }
function hasUnpairedSurrogate (value) {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff) { if (++index >= value.length || value.charCodeAt(index) < 0xdc00 || value.charCodeAt(index) > 0xdfff) return true } else if (unit >= 0xdc00 && unit <= 0xdfff) return true
  }
  return false
}
function isJavaPaddingCharacter (value) { const point = value.codePointAt(0); return isJavaWhitespaceCodePoint(point) || isJavaSpaceCharCodePoint(point) }
function isJavaWhitespaceCharacter (value) { return isJavaWhitespaceCodePoint(value.codePointAt(0)) }
function isJavaWhitespaceCodePoint (point) { return point >= 0x0009 && point <= 0x000d || point >= 0x001c && point <= 0x001f || point === 0x0020 || point === 0x1680 || point >= 0x2000 && point <= 0x2006 || point >= 0x2008 && point <= 0x200a || point === 0x2028 || point === 0x2029 || point === 0x205f || point === 0x3000 }
function isJavaSpaceCharCodePoint (point) { return point === 0x0020 || point === 0x00a0 || point === 0x1680 || point >= 0x2000 && point <= 0x200a || point === 0x2028 || point === 0x2029 || point === 0x202f || point === 0x205f || point === 0x3000 }
function isIsoControlCharacter (value) { const point = value.codePointAt(0); return point >= 0x0000 && point <= 0x001f || point >= 0x007f && point <= 0x009f }
function clone (value) { return structuredClone(value) }
