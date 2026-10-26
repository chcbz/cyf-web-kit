import { expect } from 'chai'
import { mount } from '@vue/test-utils'
import { skillComponents, button, until, settle } from './helpers/skill-management-components.js'
import { apiFixture, locks, deferred, fixture } from './fixtures/skill-management/helpers.js'

describe('SM-C1 actual management component lifecycle (no composable stub)', () => {
  let wrapper; let previousLocks; let mock
  beforeEach(() => {
    window.localStorage.clear(); mock = apiFixture()
    previousLocks = Object.getOwnPropertyDescriptor(navigator, 'locks'); Object.defineProperty(navigator, 'locks', { configurable: true, value: locks })
  })
  afterEach(async () => { wrapper?.unmount(); await settle(); window.localStorage.clear(); if (previousLocks) Object.defineProperty(navigator, 'locks', previousLocks); else delete navigator.locks })
  const open = async () => {
    wrapper = mount(skillComponents().Management, { attachTo: document.body, props: { show: true, targetAgent: { agentId: 'agt_demo', name: '测试好汉' }, actorScopeKey: 'actor-a', agentApi: mock.api }, global: { stubs: { teleport: true } } })
    await until(() => button(wrapper, '安装')); await button(wrapper, '安装').trigger('click')
  }
  it('Chinese permission labels submit original enum keys through quote and installation', async () => {
    await open()
    expect(wrapper.findAll('.skill-permission-details span').map(label => label.text().replace(/；$/, ""))).to.deep.equal(['读取本次授权的输入', '生成结果并写回当前任务'])
    expect(wrapper.findAll('input[type=checkbox]')).to.have.length(0)
    await button(wrapper, '获取报价').trigger('click'); await until(() => button(wrapper, '确认安装'))
    expect(mock.requests.find(r => r.method === 'POST' && r.path === '/skill-orders/quotes').data).to.deep.equal(fixture('quote-install-request').data)
    await button(wrapper, '确认安装').trigger('click'); await until(() => mock.requests.some(r => r.method === 'POST' && r.path === '/agt_demo/skill-changes'))
    expect(mock.requests.find(r => r.method === 'POST' && r.path === '/agt_demo/skill-changes').data).to.deep.equal(fixture('create-install').data)
  })
  it('unknown permission keys remain literal escaped text, including inherited object names', async () => {
    const permissions = ['__proto__', 'constructor', '<img src=x onerror="alert(1)">']
    mock.list.items[0].candidate.requiredPermissions = permissions
    await open()
    expect(wrapper.findAll('.skill-permission-details span').map(label => label.text().replace(/；$/, ""))).to.deep.equal(permissions)
    expect(wrapper.find('.skill-permission-details img').exists()).to.equal(false)
    expect(wrapper.findAll('input[type=checkbox]')).to.have.length(0)
    expect(button(wrapper, '获取报价').element.disabled).to.equal(false)
    await wrapper.find('dialog').trigger('keydown', { key: 'Escape' })
    mock.list.items[0].allowedActions = ['VIEW']
    await wrapper.setProps({ show: false }); await settle()
    await wrapper.setProps({ show: true }); await until(() => button(wrapper, '详情'))
    await button(wrapper, '详情').trigger('click')
    expect(wrapper.find('.skill-detail-grid').text()).to.include(permissions.join('；'))
    expect(wrapper.find('.skill-detail-grid img').exists()).to.equal(false)
  })
  it('collapse/Esc preserves permission draft and valid quote; quote focus moves near target; close emits only dismissal', async () => {
    await open()
    expect(wrapper.findAll('input[type=checkbox]')).to.have.length(0)
    await button(wrapper, '获取报价').trigger('click'); await until(() => button(wrapper, '确认安装'))
    expect(document.activeElement.textContent).to.equal('确认安装')
    expect(wrapper.find('.skill-inline-footer').text()).to.include('测试好汉 · 图片修改 · 1.1.0')
    await wrapper.find('dialog').trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('.skill-inline-panel').exists()).to.equal(false)
    await button(wrapper, '安装').trigger('click')
    expect(wrapper.findAll('input').every(input => input.element.checked)).to.equal(true)
    expect(button(wrapper, '确认安装')).not.to.equal(undefined)
    await wrapper.find('dialog').trigger('keydown', { key: 'Escape' }); await wrapper.find('dialog').trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('update:show').at(-1)).to.deep.equal([false])
    expect(mock.requests.filter(r => r.method === 'POST')).to.have.length(1)
  })
  it('closed window does not cancel pending write; reopening reads its original operation', async () => {
    await open(); for (const input of wrapper.findAll('input')) await input.setValue(true)
    await button(wrapper, '获取报价').trigger('click'); await until(() => button(wrapper, '确认安装'))
    const wait = deferred(); const post = mock.api.post
    mock.api.post = async (...args) => { await wait.promise; return post(...args) }
    await button(wrapper, '确认安装').trigger('click'); await settle(); await wrapper.setProps({ show: false })
    wait.resolve(); await until(() => mock.requests.some(r => r.path === '/agt_demo/skill-changes'))
    await wrapper.setProps({ show: true }); await until(() => wrapper.text().includes('等待连接'))
    expect(mock.requests.filter(r => r.path === '/agt_demo/skill-changes' && r.method === 'POST')).to.have.length(1)
  })
  it('real Agent projection replacement retains draft; changed identity clears it and rejects late quote', async () => {
    await open(); for (const input of wrapper.findAll('input')) await input.setValue(true)
    await wrapper.setProps({ targetAgent: { agentId: 'agt_demo', name: '同一好汉补齐投影', version: '13' } })
    expect(wrapper.findAll('input').every(input => input.element.checked)).to.equal(true)
    const wait = deferred(); const post = mock.api.post
    mock.api.post = async (...args) => { await wait.promise; return post(...args) }
    await until(() => button(wrapper, '获取报价'))
    await button(wrapper, '获取报价').trigger('click')
    await wrapper.setProps({ actorScopeKey: 'actor-b', targetAgent: { agentId: 'other', name: '另一身份' } })
    wait.resolve(); await settle(); await settle()
    expect(wrapper.find('.skill-inline-panel').exists()).to.equal(false)
    expect(button(wrapper, '确认安装')).to.equal(undefined)
  })
  it('installed-version details stay truthful; enable/disable require confirmation and use the sole write', async () => {
    mock.list = fixture('skill-list').data
    const installed = mock.list.items[0]
    installed.skillRevision = '8'; installed.installed.skillInstallationId = 'si_new'
    wrapper = mount(skillComponents().Management, { attachTo: document.body, props: { embedded: true, targetAgent: { agentId: 'agt_demo', name: '测试好汉' }, actorScopeKey: 'actor-a', agentApi: mock.api } })
    await until(() => button(wrapper, '详情')); await button(wrapper, '详情').trigger('click')
    expect(wrapper.find('.skill-detail-grid').text()).to.include('image/png、image/jpeg')
    expect(wrapper.find('.skill-detail-grid').text()).to.include('读取本次授权的输入；生成结果并写回当前任务')
    expect(wrapper.find('.skill-detail-grid').text()).not.to.include('READ_AUTHORIZED_INPUT')
    expect(wrapper.find('.skill-detail-grid').text()).not.to.include('image/avif')
    await button(wrapper, '停用新调用').trigger('click')
    expect(mock.requests.filter(r => r.method === 'POST')).to.have.length(0)
    mock.accepted = fixture('disabled-api-admission-closed').data
    await button(wrapper, '确认停用').trigger('click'); await until(() => wrapper.text().includes('Runtime策略仍待同步'))
    expect(mock.requests.find(r => r.method === 'POST').data).to.deep.equal(fixture('create-disable').data)
  })
  it('explicit original quote recovery after remount returns to inline confirmation, never automatic installation', async () => {
    await open(); for (const input of wrapper.findAll('input')) await input.setValue(true)
    const post = mock.api.post; mock.api.post = async () => { throw new TypeError('lost quote') }
    await button(wrapper, '获取报价').trigger('click'); await until(() => button(wrapper, '放弃未提交报价'))
    wrapper.unmount(); mock.api.post = post
    wrapper = mount(skillComponents().Management, { attachTo: document.body, props: { show: true, targetAgent: { agentId: 'agt_demo', name: '测试好汉' }, actorScopeKey: 'actor-a', agentApi: mock.api }, global: { stubs: { teleport: true } } })
    await until(() => button(wrapper, '核对结果')); await button(wrapper, '核对结果').trigger('click')
    expect(wrapper.text()).to.include('报价结果待核对')
    await button(wrapper, '以原键重放').trigger('click'); await until(() => button(wrapper, '确认安装'))
    expect(mock.requests.some(r => r.path === '/agt_demo/skill-changes' && r.method === 'POST')).to.equal(false)
    expect(wrapper.find('.skill-inline-footer').text()).to.include('测试好汉 · 图片修改 · 1.1.0')
  })
  it('confirmed terminal failure does not hide a new INSTALL action explicitly allowed by the server', async () => {
    mock.list.items[0].latestChange = { ...fixture('accepted-offline-install').data, status: 'FAILED_FINAL', fundingStatus: 'REFUNDED' }
    wrapper = mount(skillComponents().Management, { attachTo: document.body, props: { embedded: true, targetAgent: { agentId: 'agt_demo' }, actorScopeKey: 'actor-a', agentApi: mock.api } })
    await until(() => button(wrapper, '安装')); expect(button(wrapper, '查看进度')).to.equal(undefined)
    await button(wrapper, '安装').trigger('click'); expect(wrapper.find('.skill-inline-title').text()).to.include('确认安装')
  })
  it('real keyboard trap wraps Tab in both directions and dismissal restores the opening control', async () => {
    const trigger = document.createElement('button'); document.body.append(trigger); trigger.focus()
    try {
      await open()
      const controls = wrapper.findAll('button,summary,input').filter(el => !el.element.disabled)
      for (const control of controls) control.element.getClientRects = () => [{}]
      const first = controls[0]; const last = controls.at(-1)
      first.element.focus(); await first.trigger('keydown', { key: 'Tab', shiftKey: true }); expect(document.activeElement).to.equal(last.element)
      await last.trigger('keydown', { key: 'Tab' }); expect(document.activeElement).to.equal(first.element)
      await wrapper.setProps({ show: false }); await settle(); expect(document.activeElement).to.equal(trigger)
      const before = mock.requests.length; await settle(); expect(mock.requests.length).to.equal(before)
    } finally { trigger.remove() }
  })

  it('actual UPGRADE flow shows old/target versions, authorizes declared permissions and submits its exact covered quote', async () => {
    mock.list = fixture('skill-list').data; mock.accepted = fixture('accepted-upgrade').data
    wrapper = mount(skillComponents().Management, { attachTo: document.body, props: { embedded: true, targetAgent: { agentId: 'agt_demo', name: '测试好汉' }, actorScopeKey: 'actor-a', agentApi: mock.api } })
    await until(() => button(wrapper, '升级')); await button(wrapper, '升级').trigger('click')
    expect(wrapper.find('.skill-version-compare').text()).to.include('1.0.0').and.include('1.1.0')
    expect(button(wrapper, '获取报价').element.disabled).to.equal(false)
    expect(wrapper.findAll('input[type=checkbox]')).to.have.length(0)
    await button(wrapper, '获取报价').trigger('click'); await until(() => button(wrapper, '确认升级'))
    expect(wrapper.find('.skill-install-quote').text()).to.include('现有权益覆盖')
    await button(wrapper, '确认升级').trigger('click'); await until(() => wrapper.text().includes('下载与校验'))
    expect(mock.requests.find(r => r.method === 'POST' && r.path === '/agt_demo/skill-changes').data).to.deep.equal(fixture('create-upgrade').data)
  })
  it('ENABLE is a confirmed server action; VERIFYING is not optimistic admission or runtime success', async () => {
    mock.list = fixture('skill-list').data; const row = mock.list.items[0]
    row.skillRevision = '8'; row.installed = { skillInstallationId: 'si_new', version: row.candidate }; row.desiredEnabled = false; row.admissionEnabled = false; row.allowedActions = ['VIEW', 'ENABLE']
    mock.accepted = { ...fixture('disabled-api-admission-closed').data, action: 'ENABLE', desiredEnabled: true, status: 'VERIFYING', runtimeSynced: false }
    wrapper = mount(skillComponents().Management, { attachTo: document.body, props: { embedded: true, targetAgent: { agentId: 'agt_demo' }, actorScopeKey: 'actor-a', agentApi: mock.api } })
    await until(() => button(wrapper, '详情')); await button(wrapper, '详情').trigger('click'); await button(wrapper, '启用新调用').trigger('click')
    expect(mock.requests.filter(r => r.method === 'POST')).to.have.length(0)
    await button(wrapper, '确认启用').trigger('click'); await until(() => wrapper.text().includes('已应用，待运行核验'))
    expect(mock.requests.find(r => r.method === 'POST').data).to.deep.equal(fixture('create-enable').data)
    expect(wrapper.text()).not.to.include('该动作已完成')
  })

  it('UNINSTALL stays in the detail row, cancel sends nothing, exact submit waits for removal evidence', async () => {
    mock.list = fixture('skill-list').data
    const row = mock.list.items[0]; row.allowedActions.push('UNINSTALL')
    const source = { ...fixture('disabled-api-admission-closed').data.target, skillInstallationId: row.installed.skillInstallationId }
    mock.accepted = { ...fixture('disabled-api-admission-closed').data, action: 'UNINSTALL', source, target: source, status: 'WAITING_AGENT', runtimeSynced: false, reasonCode: 'AGENT_OFFLINE' }
    wrapper = mount(skillComponents().Management, { attachTo: document.body, props: { embedded: true, targetAgent: { agentId: 'agt_demo', name: '测试好汉' }, actorScopeKey: 'actor-a', agentApi: mock.api } })
    await until(() => button(wrapper, '详情')); await button(wrapper, '详情').trigger('click')
    await button(wrapper, '卸载技能').trigger('click')
    expect(wrapper.find('.skill-inline-panel').text()).to.include('不删除成果、历史和已购权益')
    await button(wrapper, '取消').trigger('click')
    expect(mock.requests.filter(r => r.method === 'POST')).to.have.length(0)
    await button(wrapper, '卸载技能').trigger('click'); await button(wrapper, '确认卸载').trigger('click')
    await until(() => wrapper.text().includes('等待连接'))
    const writes = mock.requests.filter(r => r.method === 'POST')
    expect(writes).to.have.length(1); expect(writes[0].path).to.equal('/agt_demo/skill-changes')
    expect(writes[0].data).to.deep.equal({ action: 'UNINSTALL', skillKey: row.skillKey, sourceSkillInstallationId: row.installed.skillInstallationId, expectedAgentVersion: mock.list.agentVersion, expectedSkillRevision: row.skillRevision })
    expect(wrapper.text()).not.to.include('已卸载；')
    mock.accepted = { ...mock.accepted, status: 'SUCCEEDED', runtimeSynced: true, reasonCode: null, changeRevision: '3' }
    row.installed = null; row.allowedActions = ['VIEW', 'INSTALL']; row.latestChange = mock.accepted
    await button(wrapper, '查询原操作').trigger('click'); await until(() => wrapper.text().includes('已卸载；'))
    await button(wrapper, '收起').trigger('click'); expect(button(wrapper, '安装')).not.to.equal(undefined)
  })

})
