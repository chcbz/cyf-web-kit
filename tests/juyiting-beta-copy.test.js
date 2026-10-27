import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { projectHallTask } from '../src/composables/juyiting/hallTaskPresentation.js'
import { taskStatusFilters } from '../src/constants/juyiting.js'
const source = path => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')
describe('beta workbench copy boundaries', () => {
  it('renames presentation without granting execution or acceptance', () => {
    const pending = projectHallTask({ task: { status: 'open' } })
    expect(pending.label).to.equal('待确认承办')
    expect(pending.phase).to.equal('PENDING_ASSIGNMENT')
    expect(pending.actions).to.deep.equal(['VIEW', 'ASSIGN'])
    expect(taskStatusFilters.find(filter => filter.value === pending.phase).label).to.equal(pending.label)
    const failed = projectHallTask({ task: { status: 'failed' } })
    expect(failed.label).to.equal('办理未完成')
    expect(failed.readOnly).to.equal(true)
    expect(failed.actions).to.deep.equal(['VIEW'])
  })
  it('discloses external processing and submission is not execution', () => {
    const panel = source('components/juyiting/BountyPanel.vue')
    expect(panel).to.include('所属用户 / 当前状态')
    expect(panel).to.include('其运行环境及模型服务会处理这些内容')
    expect(panel).to.include('提交成功不代表已经开始办理')
    expect(panel).to.include('查询发送结果')
    expect(panel).to.include('继续原请求')
  })
  it('does not promise download inside discussion or confuse file viewing with task input', () => {
    const outputs = source('components/juyiting/BountyExecutionOutputs.vue')
    expect(outputs).not.to.include('请下载查看')
    expect(outputs).to.include('暂不支持在议事中预览')
    const files = source('components/workspace/PersonalWorkspace.vue')
    expect(files).not.to.include('仅自己可见')
    expect(files).to.include('资料由你管理')
    expect(files).to.include('当前查看版本 {{ selectedVersion }}')
    expect(files).to.include('@click="download(selectedVersion)"')
  })
  it('keeps write recovery and lifetime explicit instead of calling replay a query', () => {
    const recovery = source('components/personal-workspace/WorkspaceWriteRecovery.vue')
    expect(recovery).to.include('继续核对')
    expect(recovery).to.include('刷新后将无法在此继续恢复')
    expect(recovery).to.include("$emit('retry', item.target)")
    expect(recovery).not.to.include('>查询结果<')
  })
})
