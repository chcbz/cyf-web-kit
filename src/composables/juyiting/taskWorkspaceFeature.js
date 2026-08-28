export const isTaskWorkspaceBuildEnabled = value => value === 'true'

export const createDisabledTaskWorkspaceBinding = selectedAgent => ({
  selectExplicitActor: agent => {
    selectedAgent.value = agent || null
  },
  clearExplicitActor: () => {},
  dispose: () => {}
})
