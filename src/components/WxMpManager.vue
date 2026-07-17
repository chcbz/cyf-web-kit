<template>
  <main class="mp-manager">
    <section class="mp-hero">
      <div>
        <p class="eyebrow">WECHAT OFFICIAL ACCOUNT</p>
        <h1>公众号管理</h1>
        <p class="hero-description">集中维护公众号资料、开发者回调、粉丝同步和自定义菜单。</p>
      </div>
      <div class="hero-actions">
        <button class="outline-button" type="button" :disabled="loading" @click="loadAccounts">
          <var-icon name="refresh" /> 刷新
        </button>
        <button class="primary-button" type="button" @click="openCreateDialog">
          <var-icon name="plus" /> 新建公众号
        </button>
      </div>
    </section>

    <section class="account-section" aria-label="公众号列表">
      <div class="section-heading">
        <div>
          <h2>已接入公众号</h2>
          <p>{{ accountSummary }}</p>
        </div>
        <label class="search-field">
          <var-icon name="magnify" />
          <input v-model.trim="keyword" type="search" placeholder="搜索名称、AppID 或原始 ID">
        </label>
      </div>

      <div v-if="loading" class="empty-state">正在加载公众号配置…</div>
      <div v-else-if="filteredAccounts.length" class="account-grid">
        <article
          v-for="account in filteredAccounts"
          :key="account.acid"
          class="account-card"
          :class="{ selected: selectedAccount?.acid === account.acid }"
          @click="selectAccount(account)"
        >
          <div class="account-card-header">
            <div class="account-mark">{{ accountInitial(account) }}</div>
            <div class="account-title">
              <h3>{{ account.name || '未命名公众号' }}</h3>
              <span>{{ account.account || account.original || '未设置帐号' }}</span>
            </div>
            <span class="status-badge" :class="account.status === 1 ? 'active' : 'inactive'">
              {{ account.status === 1 ? '启用' : '停用' }}
            </span>
          </div>
          <dl class="account-details">
            <div><dt>AppID</dt><dd>{{ account.appid || '未配置' }}</dd></div>
            <div><dt>原始 ID</dt><dd>{{ account.original || '未配置' }}</dd></div>
            <div><dt>帐号类型</dt><dd>{{ levelLabel(account.level) }}</dd></div>
          </dl>
          <div class="card-actions" @click.stop>
            <button type="button" @click="selectAccount(account)">管理</button>
            <button type="button" @click="openEditDialog(account)">编辑</button>
            <button class="danger-link" type="button" @click="confirmDelete(account)">删除</button>
          </div>
        </article>
      </div>
      <div v-else class="empty-state">
        <var-icon name="wechat" size="30" />
        <strong>{{ keyword ? '没有匹配的公众号' : '还没有接入公众号' }}</strong>
        <span>{{ keyword ? '换个关键词试试。' : '点击“新建公众号”录入微信公众平台的开发者信息。' }}</span>
      </div>
    </section>

    <section v-if="selectedAccount" class="workspace" aria-label="公众号工作台">
      <header class="workspace-header">
        <div>
          <p class="eyebrow">CURRENT ACCOUNT</p>
          <h2>{{ selectedAccount.name || '未命名公众号' }}</h2>
          <p>{{ selectedAccount.appid || '请先配置 AppID' }}</p>
        </div>
        <button class="outline-button" type="button" @click="openEditDialog(selectedAccount)">
          <var-icon name="pencil" /> 编辑资料
        </button>
      </header>

      <div class="management-grid">
        <article class="management-card callback-card">
          <div class="card-heading">
            <div class="feature-icon callback"><var-icon name="link" /></div>
            <div><h3>服务器配置</h3><p>用于微信公众平台验证和接收消息</p></div>
          </div>
          <label>服务器地址（URL）</label>
          <div class="copy-row">
            <code>{{ callbackUrl }}</code>
            <button type="button" :disabled="!selectedAccount.appid" @click="copyCallbackUrl">复制</button>
          </div>
          <dl class="config-list">
            <div><dt>Token</dt><dd>{{ maskSecret(selectedAccount.token) }}</dd></div>
            <div><dt>消息加解密</dt><dd>{{ selectedAccount.encodingaeskey ? '已配置' : '未启用' }}</dd></div>
            <div><dt>配置状态</dt><dd>{{ selectedAccount.status === 1 ? '可用' : '已停用' }}</dd></div>
          </dl>
          <p class="hint">在微信公众平台「基本配置」中填入 URL 和 Token，URL 已自动携带当前 AppID。</p>
        </article>

        <article class="management-card">
          <div class="card-heading">
            <div class="feature-icon audience"><var-icon name="account-multiple" /></div>
            <div><h3>粉丝同步</h3><p>从微信拉取关注用户到本系统</p></div>
          </div>
          <p class="card-copy">同步会按微信开放接口读取当前公众号粉丝资料，并写入本地用户库。重复执行只会补齐最新资料。</p>
          <button class="primary-button full-button" type="button" :disabled="actionLoading === 'sync'" @click="syncUsers">
            <var-icon :name="actionLoading === 'sync' ? 'loading' : 'account-sync'" />
            {{ actionLoading === 'sync' ? '正在同步…' : '同步关注用户' }}
          </button>
        </article>

        <article class="management-card menu-card">
          <div class="card-heading">
            <div class="feature-icon menu"><var-icon name="menu" /></div>
            <div><h3>自定义菜单</h3><p>按一级菜单和子菜单编辑，发布到公众号底部菜单</p></div>
          </div>
          <p class="menu-hint">最多 3 个一级菜单；每个一级菜单最多 5 个子菜单。一级菜单添加子菜单后，仅发布其子菜单。</p>
          <div v-if="menuButtons.length" class="menu-button-list">
            <section v-for="(menu, menuIndex) in menuButtons" :key="`menu-${menuIndex}`" class="menu-group">
              <div class="menu-group-header">
                <strong>一级菜单 {{ menuIndex + 1 }}</strong>
                <div class="menu-sort-actions">
                  <button type="button" :disabled="menuIndex === 0" @click="moveMenu(menuButtons, menuIndex, -1)">上移</button>
                  <button type="button" :disabled="menuIndex === menuButtons.length - 1" @click="moveMenu(menuButtons, menuIndex, 1)">下移</button>
                  <button class="danger-link" type="button" @click="removeTopMenu(menuIndex)">删除</button>
                </div>
              </div>
              <label class="menu-field menu-name-field"><span>菜单名称</span><input v-model.trim="menu.name" maxlength="16" placeholder="例如：FUN.服务"></label>

              <div v-if="menu.subButtons.length" class="sub-menu-list">
                <section v-for="(subMenu, subMenuIndex) in menu.subButtons" :key="`menu-${menuIndex}-sub-${subMenuIndex}`" class="sub-menu-item">
                  <div class="sub-menu-header">
                    <strong>子菜单 {{ subMenuIndex + 1 }}</strong>
                    <div class="menu-sort-actions">
                      <button type="button" :disabled="subMenuIndex === 0" @click="moveMenu(menu.subButtons, subMenuIndex, -1)">上移</button>
                      <button type="button" :disabled="subMenuIndex === menu.subButtons.length - 1" @click="moveMenu(menu.subButtons, subMenuIndex, 1)">下移</button>
                      <button class="danger-link" type="button" @click="removeSubMenu(menu, subMenuIndex)">删除</button>
                    </div>
                  </div>
                  <div class="menu-item-fields">
                    <label class="menu-field"><span>名称</span><input v-model.trim="subMenu.name" maxlength="16" placeholder="例如：我的积分"></label>
                    <label class="menu-field"><span>动作</span><select v-model="subMenu.type"><option value="view">跳转网页</option><option value="click">点击事件</option><option value="miniprogram">打开小程序</option><option value="media_id">发送素材</option><option value="view_limited">图文消息</option></select></label>
                    <label v-if="subMenu.type === 'view'" class="menu-field full-menu-field"><span>网页链接</span><input v-model.trim="subMenu.url" type="url" placeholder="https://..."></label>
                    <label v-else-if="subMenu.type === 'click'" class="menu-field full-menu-field"><span>事件 Key</span><input v-model.trim="subMenu.key" placeholder="例如：POINT_MINE"></label>
                    <template v-else-if="subMenu.type === 'miniprogram'"><label class="menu-field"><span>AppID</span><input v-model.trim="subMenu.appId" placeholder="wx..."></label><label class="menu-field"><span>页面路径</span><input v-model.trim="subMenu.pagePath" placeholder="pages/index/index"></label><label class="menu-field full-menu-field"><span>备用网页链接</span><input v-model.trim="subMenu.url" type="url" placeholder="https://..."></label></template>
                    <label v-else class="menu-field full-menu-field"><span>素材 ID</span><input v-model.trim="subMenu.mediaId" placeholder="media_id"></label>
                  </div>
                </section>
              </div>

              <div v-else class="menu-item-fields top-menu-fields">
                <label class="menu-field"><span>动作</span><select v-model="menu.type"><option value="view">跳转网页</option><option value="click">点击事件</option><option value="miniprogram">打开小程序</option><option value="media_id">发送素材</option><option value="view_limited">图文消息</option></select></label>
                <label v-if="menu.type === 'view'" class="menu-field full-menu-field"><span>网页链接</span><input v-model.trim="menu.url" type="url" placeholder="https://..."></label>
                <label v-else-if="menu.type === 'click'" class="menu-field full-menu-field"><span>事件 Key</span><input v-model.trim="menu.key" placeholder="例如：POINT_MINE"></label>
                <template v-else-if="menu.type === 'miniprogram'"><label class="menu-field"><span>AppID</span><input v-model.trim="menu.appId" placeholder="wx..."></label><label class="menu-field"><span>页面路径</span><input v-model.trim="menu.pagePath" placeholder="pages/index/index"></label><label class="menu-field full-menu-field"><span>备用网页链接</span><input v-model.trim="menu.url" type="url" placeholder="https://..."></label></template>
                <label v-else class="menu-field full-menu-field"><span>素材 ID</span><input v-model.trim="menu.mediaId" placeholder="media_id"></label>
              </div>

              <button class="add-sub-menu" type="button" :disabled="menu.subButtons.length >= 5" @click="addSubMenu(menu)">+ 添加子菜单</button>
            </section>
          </div>
          <div v-else class="menu-empty-state"><strong>还没有菜单项</strong><span>添加一级菜单后，可继续添加子菜单或配置动作。</span></div>
          <button class="add-top-menu" type="button" :disabled="menuButtons.length >= 3" @click="addTopMenu">+ 添加一级菜单</button>
          <div class="menu-actions">
            <button class="outline-button" type="button" :disabled="actionLoading === 'menuGet'" @click="fetchMenu">
              {{ actionLoading === 'menuGet' ? '读取中…' : '读取菜单' }}
            </button>
            <button class="primary-button" type="button" :disabled="actionLoading === 'menuSave'" @click="saveMenu">
              {{ actionLoading === 'menuSave' ? '发布中…' : '发布菜单' }}
            </button>
            <button class="danger-button" type="button" :disabled="actionLoading === 'menuDelete'" @click="confirmDeleteMenu">删除</button>
          </div>
        </article>
      </div>
    </section>

    <var-dialog v-model:show="showEditor" :title="editorTitle" :confirm-button-text="saving ? '保存中…' : '保存'" :cancel-button="true" :close-on-click-overlay="false" @confirm="saveAccount">
      <div class="editor-form">
        <label><span>公众号名称 *</span><input v-model.trim="form.name" placeholder="例如：朝有范" maxlength="64"></label>
        <label><span>AppID *</span><input v-model.trim="form.appid" placeholder="wxxxxxxxxxxxxxxxxx" maxlength="64"></label>
        <label><span>AppSecret {{ editingAccount ? '（留空则不修改）' : '*' }}</span><input v-model.trim="form.secret" type="password" placeholder="微信公众平台 AppSecret" maxlength="128"></label>
        <label><span>Token *</span><input v-model.trim="form.token" placeholder="微信公众平台设置的 Token" maxlength="128"></label>
        <label><span>原始 ID</span><input v-model.trim="form.original" placeholder="gh_xxxxxxxxxxxx" maxlength="64"></label>
        <label><span>微信号</span><input v-model.trim="form.account" placeholder="公众号帐号" maxlength="64"></label>
        <label><span>帐号类型</span><select v-model.number="form.level"><option :value="1">普通订阅号</option><option :value="2">普通服务号</option><option :value="3">认证订阅号</option><option :value="4">认证服务号</option></select></label>
        <label><span>状态</span><select v-model.number="form.status"><option :value="1">启用</option><option :value="0">停用</option></select></label>
        <label class="full-field"><span>消息加解密密钥</span><input v-model.trim="form.encodingaeskey" type="password" placeholder="EncodingAESKey（可选）" maxlength="128"></label>
        <label class="full-field"><span>介绍</span><textarea v-model.trim="form.signature" rows="3" placeholder="公众号介绍" maxlength="255" /></label>
      </div>
    </var-dialog>

    <div v-if="notice" class="notice" :class="notice.type" role="status">{{ notice.message }}</div>
  </main>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { Dialog } from '@varlet/ui'
import { wxApi } from '@/composables/useHttp'
import { useGlobalStore } from '@/stores/global'

const globalStore = useGlobalStore()
const accounts = ref([])
const selectedAccount = ref(null)
const keyword = ref('')
const loading = ref(false)
const saving = ref(false)
const actionLoading = ref('')
const showEditor = ref(false)
const editingAccount = ref(null)
const menuButtons = ref([])
const notice = ref(null)
let noticeTimer

const emptyForm = () => ({
  name: '', appid: '', secret: '', token: '', original: '', account: '', encodingaeskey: '', signature: '', level: 4, status: 1
})
const form = ref(emptyForm())

const filteredAccounts = computed(() => {
  const query = keyword.value.toLowerCase()
  if (!query) return accounts.value
  return accounts.value.filter((account) => [account.name, account.appid, account.original, account.account]
    .filter(Boolean)
    .some((value) => value.toLowerCase().includes(query)))
})
const accountSummary = computed(() => `共 ${accounts.value.length} 个公众号，已启用 ${accounts.value.filter((account) => account.status === 1).length} 个`)
const editorTitle = computed(() => editingAccount.value ? '编辑公众号' : '接入公众号')
const callbackUrl = computed(() => {
  const origin = window.location.origin.replace('kit.', 'api.')
  const appid = selectedAccount.value?.appid || ''
  return `${origin}/wx/mp/checksignature${appid ? `?appid=${encodeURIComponent(appid)}` : ''}`
})

const notify = (message, type = 'success') => {
  notice.value = { message, type }
  clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => { notice.value = null }, 3600)
}

const unwrap = (response) => {
  const result = response?.data
  if (!result || result.code === 'E0' || result.code === '0' || result.code === 0 || result.code === '200' || result.code === 200) return result
  throw new Error(result.msg || '请求未成功')
}

const loadAccounts = async () => {
  loading.value = true
  try {
    const result = unwrap(await wxApi.list('/mp/info/list', { pageNum: 1, pageSize: 100, search: {} }))
    accounts.value = Array.isArray(result?.data) ? result.data : []
    if (selectedAccount.value) {
      selectedAccount.value = accounts.value.find((account) => account.acid === selectedAccount.value.acid) || accounts.value[0] || null
    } else {
      selectedAccount.value = accounts.value[0] || null
    }
  } catch (error) {
    notify(`加载公众号失败：${error.message}`, 'error')
  } finally {
    loading.value = false
  }
}

const selectAccount = (account) => {
  selectedAccount.value = account
  menuButtons.value = []
}

const accountInitial = (account) => (account.name || account.account || '微').slice(0, 1).toUpperCase()
const levelLabel = (level) => ({ 1: '普通订阅号', 2: '普通服务号', 3: '认证订阅号', 4: '认证服务号' }[level] || '未设置')
const maskSecret = (value) => value ? `${value.slice(0, 3)}${'•'.repeat(Math.max(4, Math.min(value.length - 3, 10)))}` : '未配置'
const accountParams = () => ({ appid: selectedAccount.value?.appid })

const openCreateDialog = () => {
  editingAccount.value = null
  form.value = emptyForm()
  showEditor.value = true
}

const openEditDialog = (account) => {
  editingAccount.value = account
  form.value = { ...emptyForm(), ...account, secret: '' }
  showEditor.value = true
}

const saveAccount = async () => {
  if (saving.value) return
  if (!form.value.name || !form.value.appid || !form.value.token || (!editingAccount.value && !form.value.secret)) {
    notify('请填写名称、AppID、Token 和 AppSecret。', 'error')
    return
  }
  saving.value = true
  try {
    const payload = { ...form.value }
    if (editingAccount.value) {
      payload.acid = editingAccount.value.acid
      if (!payload.secret) delete payload.secret
      unwrap(await wxApi.update('/mp/info/update', payload))
      notify('公众号资料已更新。')
    } else {
      unwrap(await wxApi.create('/mp/info/create', payload))
      notify('公众号已接入。')
    }
    showEditor.value = false
    await loadAccounts()
  } catch (error) {
    notify(`保存失败：${error.message}`, 'error')
  } finally {
    saving.value = false
  }
}

const confirmDelete = (account) => {
  Dialog({
    title: '删除公众号',
    message: `确认删除“${account.name || account.appid}”吗？删除后需要重新录入配置。`,
    confirmButtonText: '删除',
    confirmButtonTextType: 'danger',
    onConfirm: async () => {
      try {
        unwrap(await wxApi.get('/mp/info/delete', { id: account.acid }))
        if (selectedAccount.value?.acid === account.acid) selectedAccount.value = null
        await loadAccounts()
        notify('公众号已删除。')
      } catch (error) {
        notify(`删除失败：${error.message}`, 'error')
      }
    }
  })
}

const copyCallbackUrl = async () => {
  try {
    await navigator.clipboard.writeText(callbackUrl.value)
    notify('回调地址已复制。')
  } catch {
    notify('复制失败，请手动复制回调地址。', 'error')
  }
}

const runAction = async (key, request, successMessage) => {
  actionLoading.value = key
  try {
    unwrap(await request())
    notify(successMessage)
  } catch (error) {
    notify(`${successMessage.replace('。', '')}失败：${error.message}`, 'error')
  } finally {
    actionLoading.value = ''
  }
}

const syncUsers = () => runAction('sync', () => wxApi.get('/mp/user/sync', accountParams()), '粉丝同步任务已完成。')

const removeEmptyValues = (value) => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null && item !== undefined && item !== ''))

const createMenuButton = () => ({
  name: '', type: 'view', key: '', url: '', mediaId: '', articleId: '', appId: '', pagePath: '', subButtons: []
})

const normalizeMenuButton = (button = {}) => {
  const subButtons = button.subButtons || button.sub_button
  return {
    ...createMenuButton(),
    name: button.name || '',
    type: button.type || 'view',
    key: button.key || '',
    url: button.url || '',
    mediaId: button.mediaId || button.media_id || '',
    articleId: button.articleId || button.article_id || '',
    appId: button.appId || button.appid || '',
    pagePath: button.pagePath || button.pagepath || '',
    subButtons: Array.isArray(subButtons) ? subButtons.map(normalizeMenuButton) : []
  }
}

const addTopMenu = () => {
  if (menuButtons.value.length >= 3) return notify('微信菜单最多支持 3 个一级菜单。', 'error')
  menuButtons.value.push(createMenuButton())
}

const addSubMenu = (menu) => {
  if (menu.subButtons.length >= 5) return notify('每个一级菜单最多支持 5 个子菜单。', 'error')
  menu.subButtons.push(createMenuButton())
}

const removeTopMenu = (menuIndex) => menuButtons.value.splice(menuIndex, 1)
const removeSubMenu = (menu, subMenuIndex) => menu.subButtons.splice(subMenuIndex, 1)

const moveMenu = (items, index, offset) => {
  const targetIndex = index + offset
  if (targetIndex < 0 || targetIndex >= items.length) return
  const [item] = items.splice(index, 1)
  items.splice(targetIndex, 0, item)
}

const validateMenuButton = (button, path) => {
  if (!button.name) return `${path}缺少名称。`
  if (button.subButtons.length) {
    if (button.subButtons.length > 5) return `${path}最多只能包含 5 个子菜单。`
    for (let index = 0; index < button.subButtons.length; index += 1) {
      const error = validateMenuButton(button.subButtons[index], `${path}的子菜单 ${index + 1}`)
      if (error) return error
    }
    return ''
  }
  if (button.type === 'view' && !button.url) return `${path}的网页链接不能为空。`
  if (button.type === 'click' && !button.key) return `${path}的事件 Key 不能为空。`
  if (button.type === 'miniprogram' && (!button.appId || !button.pagePath || !button.url)) return `${path}的小程序 AppID、页面路径和备用网页链接不能为空。`
  if (['media_id', 'view_limited'].includes(button.type) && !button.mediaId) return `${path}的素材 ID 不能为空。`
  return ''
}

const toWechatMenuButton = (button) => {
  const subButtons = button?.subButtons || button?.sub_button
  if (Array.isArray(subButtons) && subButtons.length) {
    return removeEmptyValues({
      name: button.name,
      sub_button: subButtons.map(toWechatMenuButton)
    })
  }
  return removeEmptyValues({
    type: button.type,
    name: button.name,
    key: button.key,
    url: button.url,
    media_id: button.mediaId || button.media_id,
    article_id: button.articleId || button.article_id,
    appid: button.appId || button.appid,
    pagepath: button.pagePath || button.pagepath
  })
}

const toWechatMenuPayload = (menu) => {
  const menuDefinition = menu?.menu || menu || {}
  const buttons = menuDefinition.buttons || menuDefinition.button
  if (!Array.isArray(buttons)) {
    throw new Error('菜单必须包含 button 数组。')
  }
  return { button: buttons.map(toWechatMenuButton) }
}

const fetchMenu = async () => {
  actionLoading.value = 'menuGet'
  try {
    const result = unwrap(await wxApi.get('/mp/menu/get', accountParams()))
    const payload = toWechatMenuPayload(result?.data)
    menuButtons.value = payload.button.map(normalizeMenuButton)
    notify('已读取微信端菜单。')
  } catch (error) {
    notify(`读取菜单失败：${error.message}`, 'error')
  } finally {
    actionLoading.value = ''
  }
}

const saveMenu = async () => {
  if (!menuButtons.value.length) {
    notify('请先添加至少一个一级菜单。', 'error')
    return
  }
  for (let index = 0; index < menuButtons.value.length; index += 1) {
    const error = validateMenuButton(menuButtons.value[index], `一级菜单 ${index + 1}`)
    if (error) {
      notify(error, 'error')
      return
    }
  }
  const payload = toWechatMenuPayload({ button: menuButtons.value })
  await runAction('menuSave', () => wxApi.post(`/mp/menu/create?appid=${encodeURIComponent(selectedAccount.value.appid)}`, payload, {
    headers: { 'Content-Type': 'application/json' }
  }), '菜单已发布到微信。')
}

const confirmDeleteMenu = () => {
  Dialog({
    title: '删除自定义菜单',
    message: '确认删除微信端当前自定义菜单吗？',
    confirmButtonText: '删除',
    confirmButtonTextType: 'danger',
    onConfirm: () => runAction('menuDelete', () => wxApi.get('/mp/menu/delete', accountParams()), '微信端菜单已删除。')
  })
}

onMounted(() => {
  globalStore.setTitle('公众号管理')
  globalStore.setShowBack(false)
  loadAccounts()
})
</script>

<style scoped>
.mp-manager { box-sizing: border-box; min-height: 100%; overflow-y: auto; padding: 30px clamp(18px, 5vw, 72px) 52px; background: linear-gradient(145deg, #f7fbff 0%, #f9f8ff 48%, #f7faf8 100%); color: #172033; }
.mp-hero, .workspace-header, .section-heading, .account-card-header, .card-heading, .card-actions, .hero-actions, .copy-row, .menu-actions { display: flex; align-items: center; }
.mp-hero, .workspace-header, .section-heading { justify-content: space-between; gap: 20px; }
.mp-hero { max-width: 1240px; margin: 0 auto 30px; }
.eyebrow { margin: 0 0 7px; color: #1a8d67; font-size: 11px; font-weight: 800; letter-spacing: .14em; }
h1, h2, h3, p { margin-top: 0; } h1 { margin-bottom: 8px; font-size: clamp(28px, 4vw, 42px); letter-spacing: -.045em; } h2 { margin-bottom: 5px; font-size: 22px; letter-spacing: -.025em; } h3 { margin: 0 0 4px; font-size: 17px; } .hero-description, .section-heading p, .workspace-header p, .card-heading p, .card-copy, .hint { margin-bottom: 0; color: #68738a; font-size: 14px; line-height: 1.6; }
.hero-actions { gap: 10px; }.primary-button, .outline-button, .danger-button, .copy-row button, .card-actions button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; border: 0; border-radius: 10px; padding: 10px 15px; font: inherit; font-size: 14px; font-weight: 700; cursor: pointer; transition: transform .2s, box-shadow .2s, background .2s; }.primary-button { background: #17885f; color: #fff; box-shadow: 0 8px 18px rgba(23, 136, 95, .2); }.outline-button { border: 1px solid #d5deeb; background: #fff; color: #344158; }.danger-button { background: #fff0f0; color: #c64242; }.primary-button:hover, .outline-button:hover, .danger-button:hover, .copy-row button:hover { transform: translateY(-1px); }.primary-button:disabled, .outline-button:disabled, .danger-button:disabled { opacity: .6; cursor: not-allowed; transform: none; }
.account-section, .workspace { max-width: 1240px; margin: 0 auto; }.account-section { padding: 24px; border: 1px solid #e4eaf2; border-radius: 20px; background: rgba(255, 255, 255, .86); box-shadow: 0 12px 35px rgba(31, 58, 91, .055); }.section-heading { margin-bottom: 20px; }.section-heading h2 { margin-bottom: 4px; }.search-field { display: flex; align-items: center; gap: 8px; width: min(100%, 320px); padding: 10px 12px; border: 1px solid #dce5f0; border-radius: 10px; background: #fff; color: #7a879a; }.search-field input, .editor-form input, .editor-form select, .editor-form textarea, .menu-editor { width: 100%; box-sizing: border-box; border: 0; outline: none; background: transparent; color: #1b2739; font: inherit; }.search-field input { min-width: 0; }.account-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; }.account-card { display: flex; flex-direction: column; min-height: 206px; padding: 17px; border: 1px solid #e2e8f0; border-radius: 14px; background: #fff; cursor: pointer; transition: border .2s, box-shadow .2s, transform .2s; }.account-card:hover, .account-card.selected { border-color: #6dc5a5; box-shadow: 0 10px 24px rgba(31, 108, 81, .1); transform: translateY(-2px); }.account-card-header { gap: 10px; }.account-mark { display: grid; flex: 0 0 38px; width: 38px; height: 38px; place-items: center; border-radius: 12px; background: linear-gradient(135deg, #1aa06e, #52b99c); color: #fff; font-size: 18px; font-weight: 800; }.account-title { min-width: 0; flex: 1; }.account-title h3, .account-title span, dd { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.account-title span { display: block; color: #7a879a; font-size: 12px; }.status-badge { padding: 4px 7px; border-radius: 99px; font-size: 11px; font-weight: 700; }.status-badge.active { background: #e6f8ef; color: #158254; }.status-badge.inactive { background: #f1f3f7; color: #788296; }.account-details, .config-list { margin: 16px 0; }.account-details div, .config-list div { display: flex; justify-content: space-between; gap: 12px; padding: 5px 0; }.account-details dt, .config-list dt { color: #8893a6; font-size: 12px; }.account-details dd, .config-list dd { max-width: 64%; margin: 0; color: #42506a; font-size: 12px; text-align: right; }.card-actions { gap: 12px; margin-top: auto; }.card-actions button { padding: 0; background: transparent; color: #24765b; font-size: 12px; }.card-actions .danger-link { color: #cb5353; }.empty-state { display: flex; min-height: 180px; align-items: center; justify-content: center; gap: 9px; flex-direction: column; color: #77849a; text-align: center; }.empty-state strong { color: #48566d; }.empty-state span { font-size: 13px; }
.workspace { margin-top: 28px; }.workspace-header { padding: 0 4px 16px; }.management-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }.management-card { display: flex; min-width: 0; flex-direction: column; padding: 20px; border: 1px solid #e0e8f1; border-radius: 18px; background: #fff; box-shadow: 0 8px 28px rgba(31, 58, 91, .05); }.callback-card { grid-column: span 2; }.card-heading { gap: 11px; }.feature-icon { display: grid; flex: 0 0 38px; width: 38px; height: 38px; place-items: center; border-radius: 11px; }.feature-icon.callback { background: #e6f4ff; color: #2870c3; }.feature-icon.audience { background: #f6edff; color: #8a4db3; }.feature-icon.menu { background: #fff2e0; color: #c77618; }.management-card > label { display: block; margin: 19px 0 7px; color: #69768b; font-size: 12px; font-weight: 700; }.copy-row { gap: 8px; padding: 7px 8px 7px 11px; border: 1px solid #dfe7f1; border-radius: 10px; background: #f8fafc; }.copy-row code { min-width: 0; flex: 1; overflow: hidden; color: #46627f; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }.copy-row button { padding: 7px 10px; background: #e6f5ee; color: #157151; font-size: 12px; }.config-list { margin: 15px 0 0; }.hint { margin-top: 10px; font-size: 12px; }.card-copy { min-height: 70px; margin-top: 17px; }.full-button { width: 100%; margin-top: auto; }.menu-card { grid-row: span 1; }.menu-editor { min-height: 154px; margin: 16px 0 12px; padding: 11px; border: 1px solid #dfe7f1; border-radius: 10px; background: #162334; color: #d6f5e8; font: 12px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace; resize: vertical; }.menu-actions { justify-content: flex-end; gap: 8px; margin-top: auto; }.menu-actions .outline-button, .menu-actions .primary-button, .menu-actions .danger-button { padding: 8px 10px; font-size: 12px; }
.editor-form { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; padding: 5px 2px 2px; }.editor-form label { display: grid; gap: 6px; }.editor-form label > span { color: #536179; font-size: 12px; font-weight: 700; }.editor-form input, .editor-form select, .editor-form textarea { border: 1px solid #dce5ef; border-radius: 9px; padding: 10px; background: #fff; }.editor-form textarea { resize: vertical; }.editor-form .full-field { grid-column: 1 / -1; }.notice { position: fixed; z-index: 99; right: 22px; bottom: 24px; max-width: min(390px, calc(100vw - 44px)); padding: 12px 15px; border-radius: 10px; box-shadow: 0 14px 35px rgba(24, 35, 52, .18); color: #fff; font-size: 14px; }.notice.success { background: #167c58; }.notice.error { background: #c84949; }
.menu-card { grid-column: span 3; }.menu-hint { margin: 15px 0 0; color: #758198; font-size: 12px; }.menu-button-list { display: grid; gap: 12px; margin-top: 13px; }.menu-group, .sub-menu-item { padding: 14px; border: 1px solid #dce6f0; border-radius: 12px; background: #f9fbfd; }.menu-group-header, .sub-menu-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }.menu-group-header strong { color: #2d5e88; }.sub-menu-header strong { color: #536179; font-size: 13px; }.menu-sort-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }.menu-sort-actions button { padding: 0; background: transparent; color: #39765f; font-size: 12px; }.menu-sort-actions button:disabled { color: #a9b4c3; }.menu-sort-actions .danger-link { color: #c44c4c; }.menu-field { display: grid; gap: 6px; min-width: 0; }.menu-field span { color: #5a687d; font-size: 12px; font-weight: 700; }.menu-field input, .menu-field select { width: 100%; box-sizing: border-box; border: 1px solid #d9e3ee; border-radius: 8px; padding: 9px 10px; background: #fff; color: #2c3950; }.menu-name-field { margin-top: 13px; }.menu-item-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 12px; }.top-menu-fields { grid-template-columns: minmax(160px, 280px) minmax(0, 1fr); }.full-menu-field { grid-column: 1 / -1; }.sub-menu-list { display: grid; gap: 10px; margin-top: 12px; }.add-top-menu, .add-sub-menu { border: 1px dashed #82c6a8; border-radius: 9px; background: #f3fbf7; color: #157151; font-size: 12px; font-weight: 700; }.add-top-menu { align-self: flex-start; margin-top: 13px; padding: 9px 12px; }.add-sub-menu { margin-top: 12px; padding: 8px 10px; }.add-top-menu:disabled, .add-sub-menu:disabled { border-color: #d6dee8; background: #f5f7f9; color: #9aa6b7; }.menu-empty-state { display: grid; gap: 5px; margin-top: 14px; padding: 22px; border: 1px dashed #cedae7; border-radius: 11px; color: #748197; text-align: center; }.menu-empty-state strong { color: #516176; }.menu-empty-state span { font-size: 12px; }
@media (max-width: 950px) { .management-grid { grid-template-columns: 1fr 1fr; }.callback-card { grid-column: span 2; }.menu-card { grid-column: span 2; } }
@media (max-width: 640px) { .mp-manager { padding: 22px 14px 36px; }.mp-hero, .workspace-header, .section-heading, .menu-group-header, .sub-menu-header { align-items: flex-start; flex-direction: column; }.hero-actions { width: 100%; }.hero-actions button { flex: 1; }.account-section { padding: 17px; }.search-field { width: calc(100% - 24px); }.management-grid { grid-template-columns: 1fr; }.callback-card, .menu-card { grid-column: span 1; }.editor-form, .menu-item-fields, .top-menu-fields { grid-template-columns: 1fr; }.editor-form .full-field, .full-menu-field { grid-column: auto; }.menu-actions { flex-wrap: wrap; }.menu-actions button { flex: 1; }.callback-card { overflow: hidden; }.menu-sort-actions { justify-content: flex-start; } }
</style>
