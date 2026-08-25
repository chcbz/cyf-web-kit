import { expect } from 'chai'
import { readFileSync } from 'fs'
import { ref } from 'vue'
import { createDisabledTaskWorkspaceBinding, isTaskWorkspaceBuildEnabled } from '../src/composables/juyiting/taskWorkspaceFeature.js'

const hallSource = readFileSync(new URL('../src/components/world/JuyiHall.vue', import.meta.url), 'utf8')
const defaultEnv = readFileSync(new URL('../.env', import.meta.url), 'utf8')
const productionEnv = readFileSync(new URL('../.env.production', import.meta.url), 'utf8')
const featureSource = readFileSync(new URL('../src/composables/juyiting/taskWorkspaceFeature.js', import.meta.url), 'utf8')
const panelSource = readFileSync(new URL('../src/components/juyiting/TaskWorkspacePanel.vue', import.meta.url), 'utf8')

describe('C07F task workspace build flag', () => {
  it('enables the M2 surface only for the exact build-time string true', () => {
    expect(isTaskWorkspaceBuildEnabled('true')).to.equal(true)
    for (const value of [undefined, null, '', 'TRUE', 'True', ' true', 'true ', '1', true, false, 'false']) {
      expect(isTaskWorkspaceBuildEnabled(value)).to.equal(false)
    }
    expect(defaultEnv).to.match(/^VITE_JUYITING_TASK_WORKSPACE_ENABLED=false$/m)
    expect(productionEnv).to.match(/^VITE_JUYITING_TASK_WORKSPACE_ENABLED=false$/m)
  })

  it('uses a disabled adapter with no watch, open, request, stream, poll, retry, or timer behavior', () => {
    const selectedAgent = ref({ agentId: 'before' })
    const binding = createDisabledTaskWorkspaceBinding(selectedAgent)
    binding.clearExplicitActor()
    binding.selectExplicitActor({ agentId: 'clicked-agent' })
    binding.dispose()
    expect(selectedAgent.value).to.deep.equal({ agentId: 'clicked-agent' })
    expect(binding).not.to.have.property('open')
    expect(featureSource).not.to.match(/watch\(|useTaskWorkspace|agentApi|fetch\(|EventSource|setTimeout|setInterval|retry|poll/)
  })

  it('conditionally creates the real workspace and binding only for the immutable build flag', () => {
    expect(hallSource).to.include('isTaskWorkspaceBuildEnabled(import.meta.env.VITE_JUYITING_TASK_WORKSPACE_ENABLED)')
    expect(hallSource).to.include('const taskWorkspace = taskWorkspaceEnabled ? useTaskWorkspace() : null')
    expect(hallSource).to.include('? useTaskWorkspaceBinding({ selectedTask, selectedAgent, taskWorkspace })')
    expect(hallSource).to.include(': createDisabledTaskWorkspaceBinding(selectedAgent)')
    expect(hallSource).to.include('v-if="taskWorkspaceEnabled && renderedPanel === \'workspace\' && taskWorkspaceSubject"')
    expect(hallSource).to.include('v-if="taskWorkspaceEnabled && renderedPanel === \'tasks\' && taskWorkspaceSubject"')
    expect(hallSource).not.to.match(/URLSearchParams|location\.search|route\.query|window\.__.*TASK_WORKSPACE|localStorage.*TASK_WORKSPACE/)
  })

  it('keeps backend-disabled 503 presentation bounded and delegates at most one retry intent', () => {
    expect(panelSource).to.include("degraded: '服务暂不可用'")
    expect(panelSource).to.include('v-if="canRetry"')
    expect(panelSource).to.include('@click="$emit(\'retry\')"')
    expect(panelSource).not.to.match(/setTimeout|setInterval|fetch\(|agentApi|EventSource/)
  })
})
