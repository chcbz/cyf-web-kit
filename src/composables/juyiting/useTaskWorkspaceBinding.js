import { ref, watch } from 'vue'

const actorIdOf = agent => typeof agent?.agentId === 'string' && agent.agentId ? agent.agentId : null

export function useTaskWorkspaceBinding ({ selectedTask, selectedAgent, taskWorkspace } = {}) {
  if (!selectedTask || !selectedAgent || !taskWorkspace) throw new TypeError('Task workspace binding requires explicit selection refs and workspace')

  const explicitActorAgentId = ref(null)
  const clearExplicitActor = () => {
    explicitActorAgentId.value = null
  }
  const stopActorProvenance = watch(
    () => selectedAgent.value?.agentId,
    selectedAgentId => {
      if (selectedAgentId !== explicitActorAgentId.value) clearExplicitActor()
    },
    { flush: 'sync' }
  )
  const stopWorkspace = watch(
    [() => selectedTask.value?.id, () => selectedAgent.value?.agentId, () => explicitActorAgentId.value],
    ([taskId, selectedAgentId, actorAgentId]) => {
      if (taskId && selectedAgentId && selectedAgentId === actorAgentId) {
        void taskWorkspace.open({ taskId, actorAgentId })
        return
      }
      taskWorkspace.close()
    },
    { immediate: true }
  )

  const selectExplicitActor = agent => {
    const actorAgentId = actorIdOf(agent)
    explicitActorAgentId.value = actorAgentId
    selectedAgent.value = agent || null
    if (selectedAgent.value?.agentId !== actorAgentId) clearExplicitActor()
  }
  const dispose = () => {
    stopWorkspace()
    stopActorProvenance()
    taskWorkspace.dispose()
  }

  return { clearExplicitActor, explicitActorAgentId, selectExplicitActor, dispose }
}
