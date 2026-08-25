import { computed } from 'vue'

// This is a view-only boundary over the frozen FE1 workspace refs. It does not
// own state or lifecycle; it only exposes concrete top-level values for Vue
// template unwrapping.
export const useTaskWorkspaceView = taskWorkspace => ({
  subject: computed(() => taskWorkspace?.subject?.value ?? null),
  workspace: computed(() => taskWorkspace?.workspace?.value ?? null),
  connectionState: computed(() => taskWorkspace?.connectionState?.value ?? 'idle'),
  error: computed(() => taskWorkspace?.error?.value ?? null),
  retry: () => taskWorkspace?.retry?.()
})
