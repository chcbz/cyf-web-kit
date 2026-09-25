<template>
  <main ref="workspaceRoot" class="personal-workspace" :class="{ 'is-hall-treasure': embedded, 'is-compact-hall': embedded && compact, 'is-progress-view': activeModal === 'delivery' && showDeliveryProgress }">
    <header v-if="!embedded" class="workspace-header">
      <div><p class="workspace-eyebrow">聚义厅 · 内堂收纳</p><h1>百宝箱</h1><p>打开一件事，再专心办完它。</p></div>
      <p class="workspace-header-note">资料只在你明确提交时，才会授权给所选 Agent。</p>
    </header>

    <section v-if="embedded" class="treasure-content" :data-view="treasureView">
      <template v-if="treasureView === 'list'">
        <div class="treasure-intro"><div><h2>这一箱，都是可继续用的资料</h2><p>独立管理文件；办事中选完资料，仍回到原事项。</p></div><button class="treasure-primary" type="button" @click="treasureView = 'upload'">上传资料</button></div>
        <nav class="treasure-tabs" aria-label="百宝箱分类"><button v-for="tab in treasureTabs" :key="tab.key" type="button" :aria-pressed="treasureTab === tab.key" @click="changeTreasureTab(tab.key)">{{ tab.label }}</button></nav>
        <form class="treasure-search" @submit.prevent="refresh"><label><span class="sr-only">搜索文件名称</span><input v-model="query" maxlength="100" placeholder="搜索文件名称" /></label><button type="submit" :disabled="workspace.loading.value">搜索</button></form>
        <p v-if="workspace.listState.value === 'loading'" role="status">正在翻看资料…</p>
        <div ref="fileListRef" class="treasure-file-list">
          <div v-for="file in treasureFiles" :key="file.fileId" class="treasure-file-row"><div><strong>{{ file.displayName }}</strong><p>{{ originText(file.originKind) }} · {{ familyText(file.mediaFamily) }} · v{{ file.latestVersion }}</p></div><button type="button" :data-file-id="file.fileId" :disabled="!detailAllowed || workspace.actionState.value === 'loading-detail'" @click="openTreasureFile(file.fileId)">查看</button></div>
        </div>
        <p v-if="!workspace.loading.value && workspace.listState.value !== 'error' && !treasureFiles.length" class="treasure-empty">{{ workspace.nextCursor.value ? '已读取的文件中暂无此分类；可继续读取更多。' : treasureTab === 'trash' ? '回收站为空。' : query.trim() ? '没有找到匹配的文件。' : '这里还没有文件，可上传资料或到事项中查看成果。' }}</p>
        <p v-if="workspace.listState.value === 'error'" role="alert">文件暂未完整读取，不能据此判断为空。<button type="button" @click="refresh">重新读取</button></p>
        <button v-if="workspace.nextCursor.value" type="button" :disabled="workspace.loading.value" @click="loadMore">读取更多文件</button>
      </template>
      <form v-else-if="treasureView === 'upload'" class="treasure-form" @submit.prevent="uploadTreasure">
        <p>上传后可在草稿里选用；上传本身不会把资料交给好汉。</p>
        <label><span>选择资料</span><input type="file" :accept="acceptTypes" @change="onUploadFile" /></label>
        <label><span>显示名称（可选）</span><input v-model="uploadDisplayName" maxlength="255" placeholder="留空使用文件名称" /></label>
        <p v-if="uploadFile">{{ uploadFile.name }} · {{ byteText(uploadFile.size) }}</p>
        <div class="treasure-actions"><button type="button" @click="back">取消</button><button class="treasure-primary" type="submit" :disabled="!uploadFile || workspace.actionState.value === 'uploading'">{{ workspace.actionState.value === 'uploading' ? '正在上传…' : '确认上传' }}</button></div>
      </form>
      <template v-else-if="workspace.detail.value">
        <div class="treasure-file-heading"><div><h2 ref="detailTitleRef" tabindex="-1">{{ workspace.detail.value.file.displayName }}</h2><p>{{ originText(workspace.detail.value.file.originKind) }} · {{ workspace.detail.value.file.state === 'TRASHED' ? '已回收' : '仅自己可见' }}</p></div><button v-if="treasureView === 'preview'" type="button" @click="treasureView = 'manage'">更多管理</button></div>
        <template v-if="treasureView === 'preview'">
          <div class="treasure-preview-tools treasure-version-tools"><label><span class="treasure-version-label">版本</span><select v-model.number="selectedVersion" @change="preview(selectedVersion)"><option v-for="version in workspace.detail.value.versions" :key="version.version" :value="version.version">v{{ version.version }} · {{ version.originalFilename }}</option></select></label><button type="button" @click="download(selectedVersion)">下载</button></div>
          <p class="treasure-note">本次使用固定的 v{{ selectedVersion }}；以后上传新版本，不会替换已交办的资料。</p>
          <section class="treasure-preview" aria-label="文件预览" aria-live="polite">
            <p v-if="workspace.actionState.value === 'loading-preview'">正在读取预览…</p>
            <template v-else-if="workspace.preview.value.kind === 'parts'"><div class="treasure-preview-tools"><button type="button" :disabled="workspace.preview.value.selectedIndex === 0" @click="workspace.selectPreviewPart(workspace.preview.value.selectedIndex - 1)">上一页</button><span>第 {{ workspace.preview.value.selectedIndex + 1 }} / {{ workspace.preview.value.parts.length }} 页</span><button type="button" :disabled="workspace.preview.value.selectedIndex >= workspace.preview.value.parts.length - 1" @click="workspace.selectPreviewPart(workspace.preview.value.selectedIndex + 1)">下一页</button></div><pre v-if="selectedPreviewPart?.kind === 'text'" v-text="selectedPreviewPart.text"></pre><img v-else-if="selectedPreviewPart?.kind === 'image'" :src="selectedPreviewPart.url" alt="文件固定版本预览" /></template>
            <pre v-else-if="workspace.preview.value.kind === 'text'" v-text="workspace.preview.value.text"></pre><img v-else-if="workspace.preview.value.kind === 'image'" :src="workspace.preview.value.url" alt="文件固定版本预览" /><p v-else>{{ workspace.preview.value.message || '可下载查看完整文件。' }}</p>
          </section>
          <div class="treasure-actions"><button v-if="workspace.detail.value.file.state === 'ACTIVE'" class="treasure-primary" type="button" @click="useForDraft">用于新委托</button><button v-else type="button" @click="treasureView = 'manage'">恢复文件</button></div>
        </template>
        <section v-else class="treasure-management">
          <template v-if="workspace.detail.value.file.state === 'ACTIVE'">
            <form class="treasure-form" @submit.prevent="rename"><label><span>文件名称</span><input v-model="renameValue" maxlength="255" /></label><button type="submit" :disabled="workspace.actionState.value === 'saving'">保存名称</button></form>
            <div class="treasure-form"><label><span>上传新版本</span><input type="file" :accept="acceptTypes" @change="onVersionFile" /></label><p>旧版本及已有事项的资料引用会保留。</p><button type="button" :disabled="!versionFile || workspace.actionState.value === 'appending-version'" @click="appendVersion">上传为新版本</button></div>
            <div class="treasure-manage-danger"><button v-if="!trashUsage" type="button" @click="prepareTrash">移入回收站</button><div v-else role="group" aria-label="回收确认"><p>确认移入回收站？仍可恢复。{{ trashReferenceCount ? `此文件有 ${trashReferenceCount} 个关联引用。` : '' }}</p><div class="treasure-actions"><button type="button" @click="trashUsage = null">取消</button><button type="button" :disabled="workspace.actionState.value === 'saving'" @click="confirmTrash">确认回收</button></div></div></div>
          </template>
          <template v-else><p>恢复后可继续在资料列表中使用。本版不提供永久删除。</p><button class="treasure-primary" type="button" @click="restoreTreasure">恢复文件</button></template>
        </section>
      </template>
    </section>

    <section v-if="!embedded" class="modal-stage" :class="{ 'has-child-modal': activeModal !== 'home', 'has-detail-modal': activeModal === 'detail' }" aria-label="百宝箱多层弹窗">
      <section
        v-if="!embedded"
        class="babao-modal box-modal"
        :class="{ recessed: activeModal !== 'home' }"
        aria-labelledby="babao-box-title"
      >
        <p class="section-kicker">第一层 · 箱面</p><h2 id="babao-box-title">这一箱，先办哪一件？</h2>
        <p class="modal-copy">百宝箱只保留入口；资料、交付和文件详情在下一层分别打开。</p>
        <div class="box-actions">
          <button type="button" @click="openModal('library')"><span>资料柜</span><small>{{ workspace.items.value.length ? `已读入 ${workspace.items.value.length} 份资料` : '查看、收纳和取用资料' }}</small></button>
          <button type="button" @click="openModal('delivery')"><span>交付台</span><small>不上传资料，也可直接发起交付</small></button>
          <button type="button" :disabled="!workspace.items.value.length" @click="openRecentFile"><span>继续办事</span><small>取出最近一份资料，进入办事笺</small></button>
        </div>
        <div class="box-footnote"><span>待交办资料 {{ executionMaterials.length }} 份</span><span>最近执行：{{ recentExecutionText }}</span></div>
      </section>

      <section
        v-if="isLibraryModal"
        v-show="!embedded || activeModal === 'library'"
        :inert="embedded && activeModal !== 'library' ? '' : null"
        :aria-hidden="embedded && activeModal !== 'library' ? 'true' : null"
        class="babao-modal child-modal library-modal"
        :class="{ recessed: activeModal === 'detail' }"
        aria-labelledby="workspace-files-title"
      >
        <div class="modal-heading"><div><p v-if="!embedded" class="section-kicker">第二层 · 资料柜</p><h2 id="workspace-files-title">{{ state === 'TRASHED' ? '回收站' : '我的文件' }}</h2><p>选择资料，查看固定版本、预览及来源。</p></div><button
          v-if="!embedded"
          type="button"
          class="quiet-action"
          @click="backToBox"
        >返回箱面</button></div>
        <div class="library-tools">
          <label class="file-picker"><span>添入资料</span><input type="file" :accept="acceptTypes" @change="onUploadFile" /></label>
          <label class="inline-name"><span class="sr-only">显示名（可选）</span><input v-model="uploadDisplayName" maxlength="255" placeholder="显示名（可选）" /></label>
          <button type="button" :disabled="!uploadFile || workspace.actionState.value === 'uploading'" @click="upload">{{ workspace.actionState.value === 'uploading' ? '收入箱中…' : '收入百宝箱' }}</button>
        </div>
        <p v-if="uploadFile" class="selected-file">待收入：{{ uploadFile.name }}（{{ byteText(uploadFile.size) }}）</p>
        <form class="filters" @submit.prevent="refresh"><label><span>搜索</span><input v-model="query" maxlength="100" placeholder="按显示名搜索" /></label><label><span>类型</span><select v-model="mediaFamily"><option value="">全部类型</option><option value="IMAGE">图片</option><option value="TEXT">文本</option><option value="DOCUMENT">Word 文档</option><option value="SPREADSHEET">Excel 表格</option><option value="PRESENTATION">PPT 演示</option><option value="PDF">PDF</option></select></label><div class="filter-actions"><button type="submit">筛选</button><button type="button" :class="{ active: state === 'ACTIVE' }" @click="switchState('ACTIVE')">文件</button><button type="button" :class="{ active: state === 'TRASHED' }" @click="switchState('TRASHED')">回收站</button></div></form>
        <p v-if="workspace.listState.value === 'loading'" class="workspace-note" role="status">正在翻看资料…</p><p v-else-if="workspace.listState.value === 'empty'" class="workspace-empty">{{ state === 'TRASHED' ? '回收站为空。' : embedded ? '还没有文件。可先添入资料。' : '还没有文件。可先添入资料，或返回箱面打开交付台。' }}</p>
        <div v-else ref="fileListRef" class="file-list"><button
          v-for="file in workspace.items.value"
          :key="file.fileId"
          :data-file-id="file.fileId"
          type="button"
          class="file-row"
          :disabled="embedded && !detailAllowed"
          @click="openFile(file.fileId)"
        ><span class="file-icon" aria-hidden="true">{{ iconFor(file.mediaFamily) }}</span><span class="file-summary"><strong>{{ file.displayName }}</strong><small>v{{ file.latestVersion }} · {{ familyText(file.mediaFamily) }} · {{ originText(file.originKind) }}</small></span><span class="file-state">取出</span></button></div>
        <p v-if="embedded && !detailAllowed" class="workspace-note">请先返回，再打开文件详情。</p>
        <button
          v-if="workspace.nextCursor.value"
          type="button"
          class="load-more quiet-action"
          :disabled="workspace.loading.value"
          @click="loadMore"
        >加载更多</button>
      </section>

      <section v-if="!embedded && activeModal === 'delivery'" class="babao-modal child-modal delivery-modal" aria-labelledby="workspace-generation-title">
        <div class="modal-heading"><div><p class="section-kicker">第二层 · 交付台</p><h2 id="workspace-generation-title">{{ showDeliveryProgress ? '交付进度' : '直接生成交付件' }}</h2><p>{{ showDeliveryProgress ? '服务端回执与查询结果在此处显示。' : '只保留一条清晰流程：选 Agent、定类型、写需求。' }}</p></div><button type="button" class="quiet-action" @click="backToBox">返回箱面</button></div>
        <section v-if="showDeliveryProgress" class="execution-status delivery-receipt" aria-live="polite"><p class="receipt-title">本次交付回执</p><template v-if="execution.receipt.value"><dl class="file-details"><div><dt>执行状态</dt><dd>{{ executionStateText(execution.receipt.value.state) }}</dd></div><div><dt>目标 Agent</dt><dd>{{ execution.selectedExecutionAgent.value?.name || execution.receipt.value.targetAgentId }}</dd></div><div><dt>执行编号</dt><dd>{{ execution.receipt.value.executionId }}</dd></div></dl><p v-if="execution.receipt.value.state === 'QUEUED'" class="workspace-note">服务端已接受请求，正在等待结果；尚未确认任何运行阶段或交付完成。</p></template><p v-else class="workspace-note">{{ execution.executionState.value === 'creating' ? '正在提交原请求；尚未收到服务端执行回执。' : '原请求结果待确认；只查询原请求，不会再次提交。' }}</p><div class="actions"><button type="button" @click="refreshExecution">刷新进度</button><button type="button" :disabled="execution.execution.value?.state !== 'QUEUED'" @click="revokeExecutionInputs">撤销尚未开始的输入授权</button><button
          type="button"
          class="quiet-action"
          :disabled="cannotPrepareNewExecution"
          @click="prepareNewExecution"
        >另起一项新交付（不重试当前）</button></div></section><p v-if="execution.completionNotice.value" class="execution-notice" role="status">{{ execution.completionNotice.value }}</p><p v-if="execution.error.value" class="workspace-error" role="alert">{{ execution.error.value }}</p>
        <template v-if="!showDeliveryProgress"><ol class="composer-steps"><li>选 Agent</li><li>定交付类型</li><li>写需求并生成</li></ol>
          <p v-if="execution.capabilityState.value === 'loading'" class="workspace-note">正在读取可执行交付类型…</p><p v-else-if="execution.capabilityError.value" class="workspace-error" role="alert">{{ execution.capabilityError.value }}</p>
          <template v-else-if="execution.allowedMimeTypes.value.length"><label><span>已有 Agent</span><select :value="execution.selectedAgentId.value" :disabled="execution.rosterState.value === 'loading'" @change="selectExecutionAgent($event.target.value)"><option value="">请选择已有 Agent</option><option v-for="agent in execution.agents.value" :key="agent.agentId" :value="agent.agentId">{{ agent.name }}{{ agent.status ? `（${agent.status}）` : '' }}</option></select></label><label><span>交付类型</span><select v-model="generationMime"><option v-for="mime in execution.allowedMimeTypes.value" :key="mime" :value="mime">{{ deliveryTypeText(mime) }}</option></select></label><label><span>需求说明</span><textarea v-model="generationInstruction" maxlength="4000" placeholder="例如：生成一份面向客户的项目介绍 PPT，包含目标、方案和时间表。"></textarea></label><p class="workspace-note consent-note">提交会将本轮需求交给所选 Agent 及其配置的 Provider；资料可能外发并产生费用，费用未知。</p><div class="actions"><button type="button" :disabled="!canCreateGeneration" @click="createGeneration">生成交付件</button><button
            type="button"
            class="quiet-action"
            :disabled="execution.capabilityState.value === 'loading'"
            @click="loadExecutionCapabilities"
          >刷新能力</button></div></template>
          <p v-else class="workspace-note">当前没有已确认开放的直接生成类型，不会用演示内容代替。</p></template>
        <details class="execution-history" aria-label="服务端执行历史"><summary>最近执行</summary><div class="history-content"><div class="history-heading"><span>服务端记录</span><button
          type="button"
          class="quiet-action"
          :disabled="execution.historyState.value === 'loading'"
          @click="execution.loadHistory({ adopt: false })"
        >刷新记录</button></div><p v-if="execution.historyState.value === 'loading'" class="workspace-note" role="status">正在读取服务端执行记录…</p><p v-else-if="execution.historyState.value === 'error'" class="workspace-error" role="alert">{{ execution.historyError.value }}</p><p v-else-if="execution.historyState.value === 'empty'" class="workspace-note">服务端暂无最近执行记录。</p><div v-else-if="execution.historyState.value === 'ready'" class="history-list"><button
          v-for="item in execution.history.value"
          :key="item.executionId"
          type="button"
          class="history-row"
          :disabled="historySelectionBlocked"
          :class="{ active: execution.receipt.value?.executionId === item.executionId }"
          @click="chooseHistoryExecution(item.executionId)"
        ><span><strong>{{ executionStateText(item.state) }}</strong><small>{{ execution.selectedExecutionAgent.value?.agentId === item.targetAgentId ? execution.selectedExecutionAgent.value?.name : item.targetAgentId }}</small></span><small>{{ item.executionId }}</small></button></div><button
          v-if="execution.historyNextCursor.value"
          type="button"
          class="load-more quiet-action"
          :disabled="execution.historyState.value === 'loading'"
          @click="loadMoreExecutionHistory"
        >加载更早记录</button></div></details>
      </section>

      <section v-if="activeModal === 'detail' && workspace.detail.value" class="babao-modal detail-modal" aria-labelledby="workspace-detail-title">
        <div class="modal-heading"><div><p v-if="!embedded" class="section-kicker">第三层 · 文件详情</p><h2 id="workspace-detail-title" ref="detailTitleRef" tabindex="-1">{{ workspace.detail.value.file.displayName }}</h2><p>{{ embedded ? '旧版本仍可查看，上传新版本不会替换已交办的资料。' : '每次只处理一个角度：概况、版本或办事笺。' }}</p></div><button type="button" class="quiet-action" @click="backToLibrary">返回资料柜</button></div>
        <button v-if="embedded && workspace.detail.value.file.state === 'ACTIVE'" type="button" @click="useForDraft">使用当前固定版本起草交办</button>
        <nav class="detail-tabs" aria-label="文件详情操作"><button type="button" :class="{ active: detailPane === 'summary' }" @click="detailPane = 'summary'">概况</button><button type="button" :class="{ active: detailPane === 'versions' }" @click="detailPane = 'versions'">版本与预览</button><button
          v-if="!embedded && workspace.detail.value.file.state === 'ACTIVE'"
          type="button"
          :class="{ active: detailPane === 'execution' }"
          @click="detailPane = 'execution'"
        >办事笺</button></nav>
        <section v-if="detailPane === 'summary'" class="detail-pane"><dl class="file-details"><div><dt>最新版本</dt><dd>v{{ workspace.detail.value.file.latestVersion }}</dd></div><div><dt>状态</dt><dd>{{ workspace.detail.value.file.state === 'TRASHED' ? '回收站' : '可用' }}</dd></div><div><dt>来源</dt><dd>{{ originText(workspace.detail.value.file.originKind) }}</dd></div></dl><template v-if="workspace.detail.value.file.state === 'ACTIVE'"><form class="inline-form" @submit.prevent="rename"><label><span>显示名</span><input v-model="renameValue" maxlength="255" /></label><button type="submit" :disabled="workspace.actionState.value === 'saving'">保存名称</button></form><div class="version-upload"><label class="file-picker"><span>追加新版本</span><input type="file" :accept="acceptTypes" @change="onVersionFile" /></label><span v-if="versionFile">将创建 v{{ workspace.detail.value.file.latestVersion + 1 }}：{{ versionFile.name }}</span><button type="button" :disabled="!versionFile || workspace.actionState.value === 'appending-version'" @click="appendVersion">上传为新版本</button></div></template><div class="danger-zone"><template v-if="workspace.detail.value.file.state === 'ACTIVE'"><p>移入回收站后仍可恢复。</p><button
          type="button"
          class="danger"
          :disabled="workspace.actionState.value === 'saving'"
          @click="trash"
        >移入回收站</button></template><template v-else><p>本版不提供永久删除。</p><button type="button" :disabled="workspace.actionState.value === 'saving'" @click="restore">恢复文件</button></template></div></section>
        <section v-else-if="detailPane === 'versions'" class="detail-pane"><div
          v-for="version in workspace.detail.value.versions"
          :key="version.version"
          class="version-row"
          :class="{ active: selectedVersion === version.version }"
        ><button type="button" @click="selectedVersion = version.version">v{{ version.version }}</button><span>{{ version.originalFilename }}</span><small>{{ byteText(version.byteLength) }} · {{ formatDate(version.createdAt) }}</small><div class="version-actions"><button
          v-if="!embedded"
          type="button"
          :disabled="!canAddVersionAsMaterial(version)"
          @click="addExecutionMaterial({ fileId: workspace.detail.value.file.fileId, version: version.version, displayName: workspace.detail.value.file.displayName, contentMimeType: version.contentMimeType })"
        >{{ isExecutionMaterial(workspace.detail.value.file.fileId) ? '已选资料' : '加入资料' }}</button><button type="button" @click="preview(version.version)">预览</button><button type="button" @click="download(version.version)">下载</button></div></div><section class="preview" aria-live="polite"><p v-if="workspace.actionState.value === 'loading-preview'">正在读取预览…</p><template v-else-if="workspace.preview.value.kind === 'parts'"><div class="preview-navigation"><button type="button" :disabled="workspace.preview.value.selectedIndex === 0" @click="workspace.selectPreviewPart(workspace.preview.value.selectedIndex - 1)">上一页</button><span>第 {{ workspace.preview.value.selectedIndex + 1 }} / {{ workspace.preview.value.parts.length }} {{ selectedPreviewPart?.kind === 'text' ? '项' : '页' }}</span><button type="button" :disabled="workspace.preview.value.selectedIndex >= workspace.preview.value.parts.length - 1" @click="workspace.selectPreviewPart(workspace.preview.value.selectedIndex + 1)">下一页</button></div><pre v-if="selectedPreviewPart?.kind === 'text'" v-text="selectedPreviewPart.text"></pre><img v-else-if="selectedPreviewPart?.kind === 'image'" :src="selectedPreviewPart.url" :alt="workspace.detail.value.file.displayName" /></template><pre v-else-if="workspace.preview.value.kind === 'text'" v-text="workspace.preview.value.text"></pre><img v-else-if="workspace.preview.value.kind === 'image'" :src="workspace.preview.value.url" :alt="workspace.detail.value.file.displayName" /><p v-else-if="workspace.preview.value.kind === 'unsupported'">{{ workspace.preview.value.message }}</p><p v-else-if="workspace.preview.value.kind === 'error'" class="workspace-error">{{ workspace.preview.value.message }}</p></section></section>
        <section v-else class="detail-pane execution-pane"><p class="workspace-note">当前版本：{{ workspace.detail.value.file.displayName }} · v{{ selectedVersion }}</p><div class="material-actions"><button type="button" :disabled="!canAddSelectedMaterial" @click="addSelectedMaterial">加入执行资料</button><button
          v-for="item in executionMaterials"
          :key="item.fileId"
          type="button"
          @click="removeExecutionMaterial(item.fileId)"
        >{{ materialLabel(item) }} ×</button></div><p v-if="!executionMaterials.length" class="workspace-note">先从“版本与预览”选择一份资料，或将当前版本加入本次执行。</p><p v-if="!canExecuteSelectedVersion" class="workspace-note">当前文件类型未被服务端确认可作为执行资料。</p><label><span>已有 Agent</span><select :value="execution.selectedAgentId.value" :disabled="execution.rosterState.value === 'loading'" @change="selectExecutionAgent($event.target.value)"><option value="">请选择已有 Agent</option><option v-for="agent in execution.agents.value" :key="agent.agentId" :value="agent.agentId">{{ agent.name }}{{ agent.status ? `（${agent.status}）` : '' }}</option></select></label><label><span>交付类型</span><select v-model="executionOutputMime"><option v-for="mime in execution.allowedMimeTypes.value" :key="mime" :value="mime">{{ deliveryTypeText(mime) }}</option></select></label><label><span>需求说明</span><textarea v-model="executionInstruction" maxlength="4000" placeholder="例如：请根据所选资料制作 PPT，并说明保留项。"></textarea></label><p v-if="execution.rosterError.value" class="workspace-error" role="alert">{{ execution.rosterError.value }}</p><div class="actions"><button type="button" :disabled="!canCreateExecution" @click="createExecution">创建私人执行</button><button
          type="button"
          class="quiet-action"
          :disabled="execution.rosterState.value === 'loading'"
          @click="loadExecutionAgents"
        >刷新 Agent</button><button
          v-if="execution.pending.value"
          type="button"
          class="quiet-action"
          @click="prepareNewExecution"
        >另起一项新交付（不重试当前）</button></div><section v-if="execution.receipt.value" class="execution-status"><dl class="file-details"><div><dt>执行状态</dt><dd>{{ executionStateText(execution.receipt.value.state) }}</dd></div><div><dt>目标 Agent</dt><dd>{{ execution.selectedExecutionAgent.value?.name || execution.receipt.value.targetAgentId }}</dd></div><div><dt>执行编号</dt><dd>{{ execution.receipt.value.executionId }}</dd></div></dl><p v-if="execution.receipt.value.state === 'QUEUED'" class="workspace-note">服务端已接受请求，正在等待结果；尚未确认任何运行阶段或交付完成。</p><div class="actions"><button type="button" @click="refreshExecution">刷新进度</button><button type="button" :disabled="execution.execution.value?.state !== 'QUEUED'" @click="revokeExecutionInputs">撤销尚未开始的输入授权</button></div></section><p v-if="execution.completionNotice.value" class="execution-notice" role="status">{{ execution.completionNotice.value }}</p><p v-if="execution.error.value" class="workspace-error" role="alert">{{ execution.error.value }}</p></section>
      </section>
    </section>
    <p v-if="workspace.error.value" class="workspace-error workspace-page-message" role="alert">{{ workspace.error.value }}</p><p v-if="workspace.lastOperation.value" class="workspace-receipt" role="status">最近操作：{{ workspace.lastOperation.value.operationId }}（{{ workspace.lastOperation.value.state }}）</p>
  </main>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useApiStore } from '@/stores/api'
import { useGlobalStore } from '@/stores/global'
import { savePersonalWorkspaceBlob, usePersonalWorkspace } from '@/composables/usePersonalWorkspace'
import { usePersonalWorkspaceExecution } from '@/composables/usePersonalWorkspaceExecution'
import { deliveryTypeText } from '@/utils/executionFormats'

const { embedded, detailAllowed, compact } = defineProps({
  compact: { type: Boolean, default: false },
  embedded: { type: Boolean, default: false },
  detailAllowed: { type: Boolean, default: true }
})
const emit = defineEmits(['start-draft'])
const useForDraft = () => {
  const file = workspace.detail.value?.file
  if (file?.state !== 'ACTIVE' || !selectedExecutionVersion.value) return
  emit('start-draft', {
    originRef: 'juyiting:file',
    sourceRef: { sourceType: 'FILE', sourceId: file.fileId, version: selectedVersion.value },
    inputs: [{ fileId: file.fileId, version: selectedVersion.value }]
  })
}
const apiStore = useApiStore()
const globalStore = useGlobalStore()
const identityEpoch = computed(() => apiStore.authorizationGeneration)
const executionIdentityScope = computed(() => {
  const owner = String(globalStore.user?.id || globalStore.user?.openid || globalStore.getUserId || globalStore.getOpenid || '').trim()
  const client = String(apiStore.oauthClientId || '').trim()
  const tenant = String(globalStore.user?.tenantId || globalStore.user?.tenantCode || globalStore.user?.tenant || '').trim()
  return owner && client ? [tenant, client, owner].filter(Boolean).join('\u0000') : ''
})
const workspace = usePersonalWorkspace({ identityEpoch })
const execution = usePersonalWorkspaceExecution({ identityEpoch, identityScope: executionIdentityScope })
const query = ref('')
const mediaFamily = ref('')
const state = ref('ACTIVE')
const activeModal = ref(embedded ? 'library' : 'home')
const detailPane = ref('summary')
const isLibraryModal = computed(() => activeModal.value === 'library' || activeModal.value === 'detail')
const selectedId = ref('')
const selectedVersion = ref(1)
const uploadFile = ref(null)
const versionFile = ref(null)
const uploadDisplayName = ref('')
const renameValue = ref('')
const executionInstruction = ref('')
const generationInstruction = ref('')
const generationMime = ref('')
const executionOutputMime = ref('')
const executionMaterials = ref([])
const selectedExecutionVersion = computed(() => workspace.detail.value?.versions?.find(version => version.version === selectedVersion.value) || null)
const canExecuteSelectedVersion = computed(() => Boolean(selectedExecutionVersion.value?.contentMimeType && execution.inputMimeTypes.value.includes(selectedExecutionVersion.value.contentMimeType)))
const canAddSelectedMaterial = computed(() => Boolean(workspace.detail.value?.file?.fileId && selectedExecutionVersion.value && canExecuteSelectedVersion.value && !executionMaterials.value.some(item => item.fileId === workspace.detail.value.file.fileId)))
const canCreateExecution = computed(() => Boolean(!execution.pending.value && executionMaterials.value.length && executionOutputMime.value && execution.allowedMimeTypes.value.includes(executionOutputMime.value) && execution.selectedAgent.value && executionInstruction.value.trim()))
const canCreateGeneration = computed(() => Boolean(!execution.pending.value && execution.generationEnabled.value && generationMime.value && execution.allowedMimeTypes.value.includes(generationMime.value) && execution.selectedAgent.value && generationInstruction.value.trim()))
const showDeliveryProgress = computed(() => Boolean(execution.receipt.value || execution.pending.value))
const cannotPrepareNewExecution = computed(() => Boolean(execution.unresolvedIntent.value || ['creating', 'reconciling', 'unknown'].includes(execution.executionState.value)))
const historySelectionBlocked = computed(() => Boolean(execution.unresolvedIntent.value || ['creating', 'reconciling'].includes(execution.executionState.value)))
const recentExecutionText = computed(() => {
  if (execution.historyState.value === 'loading' || execution.historyState.value === 'idle') return '查询中…'
  if (execution.historyState.value === 'error') return '查询失败'
  const recent = execution.receipt.value || execution.history.value[0]
  return recent ? executionStateText(recent.state) : '暂无'
})
const acceptTypes = '.png,.jpg,.jpeg,.txt,.pdf,.docx,.xlsx,.pptx,image/png,image/jpeg,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.presentationml.presentation'

const byteText = size => Number.isFinite(size) ? size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${Math.ceil(size / 1024)} KiB` : `${(size / (1024 * 1024)).toFixed(1)} MiB` : '大小未知'
const formatDate = value => Number.isFinite(value) ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '时间未知'
const familyText = value => ({ IMAGE: '图片', TEXT: '文本', DOCUMENT: 'Word 文档', SPREADSHEET: 'Excel 表格', PRESENTATION: 'PPT 演示', PDF: 'PDF' })[value] || '文件'
const originText = value => ({ USER_UPLOAD: '本人上传', AGENT_DELIVERY: 'Agent 交付' })[value] || '来源待确认'
const executionStateText = value => ({ QUEUED: '已接受，等待结果', OUTPUT_COMMITTED: '交付已归档', FAILED: '交付失败', INPUTS_REVOKED: '输入已撤销', UNKNOWN: '提交结果待确认' })[value] || '状态待确认'
const iconFor = value => ({ IMAGE: '🖼', TEXT: '📝', DOCUMENT: '📄', SPREADSHEET: '📊', PRESENTATION: '📽', PDF: '📕' })[value] || '📁'
const currentFilters = () => ({ q: query.value.trim(), mediaFamily: mediaFamily.value, state: state.value })
const refresh = () => workspace.refresh(currentFilters())
const loadMore = () => workspace.loadMore(currentFilters())
const switchState = next => { if (state.value === next) return; state.value = next; closeDetail(); void refresh() }
const openModal = modal => { activeModal.value = modal; if (modal !== 'detail') closeDetail() }
const backToBox = () => { closeDetail(); activeModal.value = embedded ? 'library' : 'home' }
const fileListRef = ref(null)
const detailTitleRef = ref(null)
const backToLibrary = () => {
  const fileId = selectedId.value
  closeDetail()
  activeModal.value = 'library'
  nextTick(() => {
    const row = [...(fileListRef.value?.querySelectorAll('[data-file-id]') || [])]
      .find(element => element.dataset.fileId === fileId)
    row?.focus({ preventScroll: true })
  })
}
const openFile = async fileId => {
  if (embedded && !detailAllowed) return null
  const detail = await select(fileId)
  if (detail && (!embedded || detailAllowed)) {
    detailPane.value = 'summary'
    activeModal.value = 'detail'
    await nextTick()
    detailTitleRef.value?.focus({ preventScroll: true })
  }
  return detail
}
const openRecentFile = () => { const recent = workspace.items.value[0]; if (recent) void openFile(recent.fileId) }
const onUploadFile = event => { uploadFile.value = event.target.files?.[0] || null }
const onVersionFile = event => { versionFile.value = event.target.files?.[0] || null }
const upload = async () => { const result = await workspace.upload(uploadFile.value, uploadDisplayName.value); if (result) { uploadFile.value = null; uploadDisplayName.value = ''; activeModal.value = 'library'; selectedId.value = result.file.fileId; selectedVersion.value = result.version.version; await refresh() } }
const select = async fileId => { const detail = await workspace.select(fileId); if (detail) { selectedId.value = fileId; selectedVersion.value = detail.latestVersion.version; renameValue.value = detail.file.displayName; versionFile.value = null }; return detail }
const closeDetail = () => { selectedId.value = ''; versionFile.value = null; workspace.revokePreview(); workspace.detail.value = null }
const rename = async () => { const result = await workspace.rename(renameValue.value); if (result) renameValue.value = result.displayName }
const appendVersion = async () => { const result = await workspace.appendVersion(versionFile.value); if (result) { versionFile.value = null; selectedVersion.value = result.version.version; await refresh() } }
const selectedPreviewPart = computed(() => workspace.preview.value?.parts?.[workspace.preview.value?.selectedIndex] || null)
const preview = version => { selectedVersion.value = version; void workspace.previewVersion(version) }
const download = async version => { const result = await workspace.download(version); if (result) savePersonalWorkspaceBlob(result) }
const trash = async () => { const usage = await workspace.usage(); if (!usage) return; const references = (usage.taskReferences?.length || 0) + (usage.activeExecutions?.length || 0); const message = references ? `该文件仍有 ${references} 个关联引用，确认移入回收站吗？` : '确认将该文件移入回收站吗？'; if (!globalThis.confirm?.(message)) return; const result = await workspace.trash(usage); if (result) { closeDetail(); await refresh() } }
const restore = async () => { const result = await workspace.restore(); if (result) { closeDetail(); await refresh() } }
const loadExecutionAgents = () => execution.loadAgents()
const loadExecutionCapabilities = async () => {
  const result = await execution.loadCapabilities()
  if (result?.allowedMimeTypes?.length) {
    if (!result.allowedMimeTypes.includes(generationMime.value)) generationMime.value = result.allowedMimeTypes[0]
    if (!result.allowedMimeTypes.includes(executionOutputMime.value)) executionOutputMime.value = result.allowedMimeTypes[0]
  }
}
const selectExecutionAgent = agentId => execution.selectAgent(agentId)
const materialLabel = item => `${item.displayName || item.fileId} · v${item.version}`
const isExecutionMaterial = fileId => executionMaterials.value.some(item => item.fileId === fileId)
const canAddVersionAsMaterial = version => Boolean(version?.contentMimeType && execution.inputMimeTypes.value.includes(version.contentMimeType) && !isExecutionMaterial(workspace.detail.value.file.fileId))
const addExecutionMaterial = item => { if (!item?.fileId || !Number.isSafeInteger(Number(item.version)) || isExecutionMaterial(item.fileId) || !execution.inputMimeTypes.value.includes(item.contentMimeType)) return; executionMaterials.value = [...executionMaterials.value, { fileId: item.fileId, version: String(item.version), displayName: item.displayName, contentMimeType: item.contentMimeType }]; if (!executionOutputMime.value) executionOutputMime.value = execution.allowedMimeTypes.value[0] || '' }
const addSelectedMaterial = () => addExecutionMaterial({ fileId: workspace.detail.value.file.fileId, version: selectedVersion.value, displayName: workspace.detail.value.file.displayName, contentMimeType: selectedExecutionVersion.value?.contentMimeType })
const removeExecutionMaterial = fileId => { executionMaterials.value = executionMaterials.value.filter(item => item.fileId !== fileId) }
const createExecution = () => execution.create({ inputs: executionMaterials.value.map(({ fileId, version }) => ({ fileId, version })), instruction: executionInstruction.value, outputContentMimeType: executionOutputMime.value })
const createGeneration = () => execution.create({ instruction: generationInstruction.value, outputContentMimeType: generationMime.value })
const refreshExecution = () => execution.refreshExecution()
const revokeExecutionInputs = () => execution.revokeInputs()
const prepareNewExecution = () => execution.prepareNewRequest()
const chooseHistoryExecution = executionId => execution.selectHistoryExecution(executionId)
const loadMoreExecutionHistory = () => { const cursor = execution.historyNextCursor.value; return cursor ? execution.loadHistory({ beforeCreatedAt: cursor.createdAt, beforeExecutionId: cursor.executionId, append: true, adopt: false }) : Promise.resolve([]) }

const workspaceRoot = ref(null)
let treasureListScroll = 0
const treasureView = ref('list')
const treasureTab = ref('all')
const treasureTabs = [{ key: 'all', label: '全部' }, { key: 'materials', label: '资料' }, { key: 'results', label: '成果' }, { key: 'trash', label: '回收站' }]
// The server supports state/query but not originKind. Never declare a category
// empty while the unfiltered cursor still has pages; expose continuation explicitly.
const treasureFiles = computed(() => workspace.items.value.filter(file => treasureTab.value === 'materials' ? file.originKind === 'USER_UPLOAD' : treasureTab.value === 'results' ? file.originKind === 'AGENT_DELIVERY' : true))
const trashUsage = ref(null)
const trashReferenceCount = computed(() => (trashUsage.value?.taskReferences?.length || 0) + (trashUsage.value?.activeExecutions?.length || 0))
const changeTreasureTab = key => {
  treasureTab.value = key
  const next = key === 'trash' ? 'TRASHED' : 'ACTIVE'
  if (state.value !== next) { state.value = next; void refresh() }
}
const openTreasureFile = async fileId => {
  treasureListScroll = workspaceRoot.value?.scrollTop || 0
  const detail = await openFile(fileId)
  if (!detail || !detailAllowed) return
  treasureView.value = 'preview'
  preview(selectedVersion.value)
  await nextTick()
  detailTitleRef.value?.focus({ preventScroll: true })
}
const uploadTreasure = async () => {
  const result = await workspace.upload(uploadFile.value, uploadDisplayName.value)
  if (!result) return
  uploadFile.value = null; uploadDisplayName.value = ''; treasureView.value = 'list'; activeModal.value = 'library'
  treasureTab.value = 'all'; state.value = 'ACTIVE'; query.value = ''; await refresh()
}
const prepareTrash = async () => { trashUsage.value = await workspace.usage() }
const confirmTrash = async () => {
  if (!trashUsage.value) return
  const result = await workspace.trash(trashUsage.value)
  if (result) { trashUsage.value = null; treasureView.value = 'list'; backToLibrary(); await refresh() }
}
const restoreTreasure = async () => {
  const result = await workspace.restore()
  if (result) { treasureView.value = 'list'; backToLibrary(); await refresh() }
}
const canGoBack = computed(() => embedded ? treasureView.value !== 'list' : activeModal.value === 'detail')
const logicalDepth = computed(() => !embedded || treasureView.value === 'list' ? 1 : treasureView.value === 'manage' ? 3 : 2)
const windowTitle = computed(() => !embedded ? '' : ({ list: '百宝箱', upload: '上传资料', preview: '文件预览', manage: '文件管理' })[treasureView.value])
const back = () => {
  if (!canGoBack.value) return false
  if (embedded && treasureView.value === 'manage') { treasureView.value = 'preview'; trashUsage.value = null; return true }
  treasureView.value = 'list'; trashUsage.value = null
  backToLibrary()
  nextTick(() => { if (workspaceRoot.value) workspaceRoot.value.scrollTop = treasureListScroll })
  return true
}
watch(identityEpoch, () => { treasureView.value = 'list'; treasureTab.value = 'all'; trashUsage.value = null; uploadFile.value = null; versionFile.value = null; query.value = ''; uploadDisplayName.value = ''; renameValue.value = ''; selectedId.value = ''; activeModal.value = embedded ? 'library' : 'home' })
defineExpose({ canGoBack, back, logicalDepth, windowTitle })

onMounted(() => {
  void refresh()
  if (!embedded) {
    void loadExecutionAgents()
    void loadExecutionCapabilities()
    void execution.recover()
  }
})
onBeforeUnmount(() => { workspace.dispose(); execution.dispose() })
</script>

<style scoped>
/* In Hall this is content of the one work window, not an app behind stacked cards. */
.is-hall-treasure .modal-stage {
  min-height: 0;
  padding: 0;
  overflow: visible;
  border: 0;
  background: transparent;
  box-shadow: none;
}
.is-hall-treasure .babao-modal {
  position: static;
  overflow: visible;
  padding: 12px;
  box-shadow: none;
}
.is-hall-treasure .babao-modal.recessed {
  filter: none;
  opacity: 1;
  transform: none;
}

.personal-workspace { --treasure-ink: #3f2818; --treasure-muted: #806542; --treasure-wood: #6d3f1f; --treasure-wood-dark: #452817; --treasure-line: #d7c3a2; --treasure-paper: #fff8e8; --treasure-red: #8c2f20; flex:1; min-width:0; overflow:auto; padding:20px; color:var(--treasure-ink); background:radial-gradient(circle at 14% 0,rgba(255,255,255,.7),transparent 27%),linear-gradient(135deg,rgba(114,70,35,.12),transparent 36%),#e7d5b5; }
.personal-workspace.is-hall-treasure { min-height:0; border-top:2px solid rgba(109,63,31,.5); box-shadow:inset 0 10px 22px rgba(64,37,20,.1); }
.workspace-header,.modal-stage,.workspace-page-message,.workspace-receipt { max-width:920px; margin-inline:auto; }
.workspace-header { display:flex; align-items:end; justify-content:space-between; gap:24px; padding:8px 4px 18px; }
.workspace-header h1 { margin:5px 0; color:var(--treasure-wood-dark); font-family:serif; font-size:clamp(26px,4vw,34px); letter-spacing:.16em; }
.workspace-header p { margin:0; color:var(--treasure-muted); line-height:1.65; }
.workspace-eyebrow,.section-kicker { color:var(--treasure-red)!important; font-size:12px; font-weight:700; letter-spacing:.12em; }
.workspace-header-note { max-width:260px; padding-left:15px; border-left:2px solid #b88940; font-size:13px; }
.modal-stage { position:relative; min-height:550px; padding:28px; overflow:hidden; border:1px solid var(--treasure-line); border-radius:8px; background:linear-gradient(90deg,rgba(136,90,45,.06) 1px,transparent 1px) 0 0 / 28px 28px,linear-gradient(rgba(136,90,45,.04) 1px,transparent 1px) 0 0 / 28px 28px,var(--treasure-paper); box-shadow:0 4px 0 rgba(86,47,25,.12),0 12px 28px rgba(65,39,21,.14); }
.babao-modal { position:absolute; inset:28px; overflow:auto; padding:26px; border:1px solid #c7aa7b; border-radius:8px; background:linear-gradient(135deg,rgba(255,252,243,.98),rgba(246,230,196,.97)); box-shadow:0 14px 32px rgba(66,39,21,.2); transition:opacity .18s ease,transform .18s ease,filter .18s ease; }
.box-modal { display:flex; flex-direction:column; justify-content:center; max-width:690px; margin:auto; }
.child-modal { z-index:2; inset:18px 40px; }
.detail-modal { z-index:3; inset:8px 18px; background:linear-gradient(135deg,#fffdf5,#f3e1bd); }
.babao-modal.recessed { pointer-events:none; filter:blur(2px) saturate(.72); opacity:.38; transform:scale(.965); }
.box-modal h2,.modal-heading h2 { margin:5px 0 7px; color:var(--treasure-wood-dark); font-family:serif; letter-spacing:.07em; }
.modal-copy,.modal-heading p,.workspace-note { color:var(--treasure-muted); font-size:13px; line-height:1.65; }
.modal-copy { margin:0; }
.box-actions { display:grid; gap:10px; margin:24px 0 16px; }
.box-actions button { display:grid; gap:3px; min-height:68px; padding:12px 16px; text-align:left; }
.box-actions button span { font-family:serif; font-size:18px; letter-spacing:.05em; }.box-actions button small { color:#f5dfaf; }
.box-footnote { display:flex; flex-wrap:wrap; gap:12px; color:var(--treasure-muted); font-size:12px; }
.modal-heading { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; padding-bottom:15px; border-bottom:1px solid rgba(191,159,108,.52); }
.modal-heading p { margin:0; }
.personal-workspace button { min-height:35px; padding:0 11px; border:1px solid #56331b; border-radius:5px; background:linear-gradient(#82502a,var(--treasure-wood)); box-shadow:inset 0 1px rgba(255,239,194,.3),0 1px 1px rgba(74,42,20,.24); color:#fff8e8; cursor:pointer; font:inherit; }.personal-workspace button:hover { background:linear-gradient(#956033,#59331b); }.personal-workspace button:disabled { cursor:not-allowed; opacity:.58; }.personal-workspace button:focus-visible,.personal-workspace input:focus-visible,.personal-workspace select:focus-visible,.personal-workspace textarea:focus-visible { outline:2px solid #bd8633; outline-offset:2px; }
.quiet-action { border-color:#b99761!important; background:rgba(255,248,232,.9)!important; box-shadow:none!important; color:#654122!important; }.quiet-action:hover { background:#f1dfb6!important; }
.library-tools,.inline-form,.version-upload { display:flex; flex-wrap:wrap; align-items:end; gap:8px; margin-top:16px; }.library-tools { padding-bottom:15px; border-bottom:1px solid rgba(191,159,108,.42); }.personal-workspace label { display:grid; gap:6px; margin-top:14px; color:#644526; font-size:13px; font-weight:700; }.library-tools label,.inline-form label { margin:0; }.personal-workspace input,.personal-workspace select,.personal-workspace textarea { min-height:37px; padding:0 10px; border:1px solid #c5a978; border-radius:4px; background:rgba(255,253,246,.9); box-shadow:inset 0 1px 3px rgba(88,51,25,.1); color:var(--treasure-ink); font:inherit; }.personal-workspace textarea { min-height:104px; padding:10px; resize:vertical; }
.file-picker { display:inline-flex!important; width:fit-content; position:relative; overflow:hidden; margin:0!important; padding:8px 11px; border:1px dashed #9a6d36; border-radius:4px; background:#f5e8c7; color:#5a3519!important; cursor:pointer; }.file-picker input { position:absolute; inset:0; opacity:0; cursor:pointer; }.inline-name { display:block!important; }.inline-name input { width:min(190px,36vw); }.selected-file { color:#694b2a; font-size:13px; }
.filters { display:grid; grid-template-columns:minmax(0,1fr) 150px auto; align-items:end; gap:10px; margin:15px 0 10px; padding:12px 0; border-bottom:1px solid rgba(191,159,108,.5); }.filters label { margin:0; }.filter-actions,.actions,.version-actions,.material-actions { display:flex; flex-wrap:wrap; gap:7px; }.filter-actions .active,.detail-tabs .active { border-color:#412516; background:#442717; color:#fff8e8; }
.file-list { display:grid; gap:7px; }.file-row { display:grid; grid-template-columns:30px minmax(0,1fr) auto; align-items:center; width:100%; border-color:#dac69f!important; background:rgba(255,253,246,.58)!important; color:var(--treasure-ink)!important; text-align:left; }.file-row:hover { border-color:#a8773a!important; background:#f7e9ca!important; }.file-icon { color:var(--treasure-red); font-size:17px; }.file-summary { display:grid; min-width:0; gap:3px; }.file-summary strong,.file-summary small,.version-row > span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.file-summary small,.file-state,.version-row small { color:var(--treasure-muted); font-size:12px; }.workspace-empty { padding:24px 0; color:var(--treasure-muted); }.load-more { margin-top:11px; }
.composer-steps { display:flex; flex-wrap:wrap; gap:6px; padding:0; margin:17px 0 2px; list-style:none; counter-reset:composer-step; }.composer-steps li { padding:5px 9px; border:1px solid rgba(184,137,64,.58); border-radius:999px; color:#644526; font-size:12px; }.composer-steps li::before { counter-increment:composer-step; content:counter(composer-step) ' · '; color:var(--treasure-red); font-weight:700; }.consent-note { padding-left:10px; border-left:2px solid #c59a55; }.actions { margin-top:14px; }
.detail-tabs { display:flex; gap:7px; margin:16px 0; padding-bottom:12px; border-bottom:1px solid rgba(191,159,108,.5); }.detail-tabs button { background:rgba(255,248,232,.82); color:#654122; box-shadow:none; border-color:#b99761; }.detail-pane { max-width:760px; margin:auto; }.file-details { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; margin:15px 0; }.file-details div { padding:9px; border:1px solid rgba(202,177,130,.5); border-radius:4px; background:rgba(244,230,201,.62); }.file-details dt { color:var(--treasure-muted); font-size:12px; }.file-details dd { margin:4px 0 0; color:#4b2d19; word-break:break-word; }.version-upload { align-items:center; }.version-row { display:grid; grid-template-columns:auto minmax(0,1fr) auto auto; align-items:center; gap:9px; padding:9px 0; border-bottom:1px solid #decba7; }.version-row.active { margin-inline:-8px; padding-inline:8px; background:#f2e1b9; }.version-actions { justify-content:flex-end; }
.preview { margin-top:15px; overflow:auto; border:1px solid #d4bc91; border-radius:4px; background:#f5e8cc; }.preview pre { margin:0; padding:12px; white-space:pre-wrap; overflow-wrap:anywhere; color:#4d301d; }.preview img { display:block; max-width:100%; max-height:380px; margin:auto; object-fit:contain; }.preview p { padding:12px; color:var(--treasure-muted); }.preview-navigation { display:flex; align-items:center; gap:8px; padding:10px 12px 0; color:#654122; }.preview-navigation button { min-height:30px; padding:0 8px; }
.execution-pane { max-width:600px; }.execution-history summary { cursor:pointer; color:var(--treasure-wood-dark); font-family:serif; font-weight:700; }.execution-history[open] summary { margin-bottom:12px; }.history-content { padding-top:2px; }.delivery-receipt { margin-top:18px; }.receipt-title { margin:0; color:var(--treasure-wood-dark); font-family:serif; font-weight:700; }.execution-history { margin-top:18px; padding-top:14px; border-top:1px solid var(--treasure-line); }.history-heading { display:flex; align-items:center; justify-content:space-between; gap:10px; color:var(--treasure-wood-dark); }.history-heading .quiet-action { min-height:30px; }.history-list { display:grid; gap:7px; margin-top:10px; }.history-row { display:flex; align-items:center; justify-content:space-between; gap:12px; width:100%; text-align:left; border-color:#dac69f!important; background:rgba(255,253,246,.58)!important; color:var(--treasure-ink)!important; }.history-row.active { border-color:#a8773a!important; background:#f2e1b9!important; }.history-row span { display:grid; gap:2px; min-width:0; }.history-row small { color:var(--treasure-muted); overflow-wrap:anywhere; }.execution-status { margin-top:15px; padding-top:15px; border-top:1px solid var(--treasure-line); }.execution-notice { margin-top:14px; padding:11px; border:1px solid #9da877; border-radius:4px; background:#e8efd6; color:#405322; }.danger-zone { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:12px; margin-top:20px; padding-top:15px; border-top:1px solid var(--treasure-line); }.danger-zone p { margin:0; color:var(--treasure-muted); }.danger-zone .danger { border-color:#76271c; background:linear-gradient(#9d3e2b,var(--treasure-red)); }
.workspace-error { padding:11px; border:1px solid #c88174; border-radius:4px; background:#f7e1d9; color:#7e271c; }.workspace-page-message { margin-top:14px; }.workspace-receipt { margin-top:12px; padding:8px 12px; border-left:3px solid #b88940; background:rgba(255,248,232,.72); color:#694b2a; font-size:14px; }.sr-only { position:absolute; width:1px; height:1px; padding:0; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
@media (max-height:500px) and (min-width:701px) { .personal-workspace.is-progress-view { padding:8px 14px; }.personal-workspace.is-progress-view .workspace-header { display:none; }.personal-workspace.is-progress-view .modal-stage { height:calc(100vh - 16px); min-height:0; padding:10px; }.personal-workspace.is-progress-view .babao-modal { inset:10px; padding:14px; }.personal-workspace.is-progress-view .delivery-modal .modal-heading { padding-bottom:7px; }.personal-workspace.is-progress-view .delivery-modal .section-kicker,.personal-workspace.is-progress-view .delivery-modal .modal-heading p { display:none; }.personal-workspace.is-progress-view .delivery-receipt { margin-top:8px; padding-top:0; border-top:0; }.personal-workspace.is-progress-view .delivery-receipt .file-details { margin:8px 0; }.personal-workspace.is-progress-view .execution-history { margin-top:10px; padding-top:9px; } }
@media (max-width:700px) { .personal-workspace { padding:13px; }.workspace-header { align-items:flex-start; flex-direction:column; gap:7px; }.workspace-header-note { max-width:none; }.modal-stage { min-height:580px; padding:15px; }.babao-modal { inset:15px; padding:18px; }.child-modal { inset:8px; }.detail-modal { inset:0; }.filters { grid-template-columns:1fr; }.file-details { grid-template-columns:1fr; }.version-row { grid-template-columns:auto minmax(0,1fr); }.version-row small,.version-actions { grid-column:2; justify-content:flex-start; }.file-state { display:none; }.modal-heading { flex-direction:column; }.inline-name input { width:100%; } }
/* A03: one content scroller; compact the file tools, not their actions. */
.personal-workspace.is-compact-hall { padding:8px; }
.is-compact-hall .babao-modal { padding:8px; }
.is-compact-hall .modal-heading { gap:8px; padding-bottom:6px; }
.is-compact-hall .modal-heading h2 { margin:0; font-size:18px; }
.is-compact-hall .modal-heading p { display:none; }
.is-compact-hall .library-tools { margin-top:6px; padding-bottom:6px; }
.is-compact-hall .filters { margin:6px 0; padding:6px 0; }
/* Embedded treasure follows the approved list → preview → management flow. */
.personal-workspace.is-hall-treasure { padding:28px 30px; background:#fff9ed; border-top:0; box-shadow:none; font-size:16px; }
.treasure-content { max-width:100%; margin:0; }
.treasure-content h2 { font-size:22px; line-height:1.45; font-weight:500; margin:0 0 6px; overflow-wrap:anywhere; }
.treasure-file-heading h2:focus { outline:none; }.treasure-file-heading h2:focus-visible { padding-left:9px; border-left:3px solid var(--treasure-red); }
.treasure-content p { margin:6px 0; color:#7b634b; font-size:14px; line-height:1.6; }
.treasure-intro,.treasure-file-heading { display:flex; gap:16px; align-items:center; justify-content:space-between; margin-bottom:20px; }
.treasure-content button { min-height:44px; padding:8px 14px; font:inherit; background:transparent; color:#533922; border:1px solid #d5bd98; border-radius:4px; box-shadow:none; cursor:pointer; }
.treasure-content button:focus-visible,.treasure-content input:focus-visible,.treasure-content select:focus-visible { outline:3px solid #bf8045; outline-offset:2px; }
.treasure-content button:disabled { opacity:.5; cursor:default; }
.treasure-content button.treasure-primary { background:#8d402c; color:#fff9ee; border-color:#8d402c; }
.treasure-tabs { display:flex; gap:8px; border-bottom:1px solid #d6bf99; margin-bottom:18px; }
.treasure-tabs button,.treasure-tabs button:hover,.treasure-tabs button[aria-pressed=true] { border:0; border-radius:0; background:transparent!important; box-shadow:none!important; }
.treasure-tabs button[aria-pressed=true] { border-bottom:2px solid var(--hall-brand,#8d402c); color:var(--hall-brand,#8d402c); }
.treasure-search { display:flex; align-items:center; gap:12px; margin:18px 0 12px; }
.treasure-search label { width:min(360px,100%); }
.treasure-content input:not([type=file]),.treasure-content select { padding:10px 12px; min-height:44px; box-sizing:border-box; border:1px solid #d5bd98; border-radius:4px; font:inherit; color:#513922; background:#fffdf8; max-width:100%; }
.treasure-search input { width:100%; }
.treasure-file-row { display:flex; justify-content:space-between; align-items:center; gap:16px; padding:20px 0; border-bottom:1px solid #d6bf99; }
.treasure-file-row>div { min-width:0; overflow-wrap:anywhere; }.treasure-file-row button,.treasure-intro>button { flex:0 0 auto; }
.treasure-empty { padding:28px 0; }.treasure-form { display:grid; gap:18px; max-width:680px; margin:20px 0; }.treasure-form label { display:grid; gap:8px; }.treasure-form>button { justify-self:start; }
.treasure-preview-tools,.treasure-actions { display:flex; gap:12px; align-items:center; flex-wrap:wrap; }.treasure-actions { justify-content:flex-end; margin-top:24px; padding-top:18px; border-top:1px solid #d6bf99; }.treasure-preview-tools label { display:flex; gap:8px; align-items:center; min-width:0; }.treasure-preview-tools select { max-width:min(520px,60vw); }.treasure-version-tools{display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-rows:auto auto;column-gap:10px;row-gap:6px;width:100%;align-items:stretch}.treasure-version-tools label{display:contents}.treasure-version-label{grid-column:1/-1;grid-row:1}.treasure-version-tools select{grid-column:1;grid-row:2;width:100%;max-width:none;min-width:0}.treasure-version-tools>button{grid-column:2;grid-row:2;align-self:stretch;white-space:nowrap}
.treasure-preview { min-height:140px; margin-top:14px; padding:18px; border:1px solid #dfd2bd; border-radius:8px; background:#fffdf8; }.treasure-preview pre { white-space:pre-wrap; overflow-wrap:anywhere; font:inherit; }.treasure-preview img { max-width:100%; height:auto; }.treasure-manage-danger { margin-top:32px; padding-top:20px; border-top:1px solid #d6bf99; }
@media(max-width:600px) { .personal-workspace.is-hall-treasure { padding:20px 16px; }.treasure-intro { align-items:flex-start; }.treasure-content h2 { font-size:19px; }.treasure-tabs { gap:4px;overflow-x:auto; }.treasure-tabs button { flex:none;padding:8px 12px;white-space:nowrap; }.treasure-version-tools{column-gap:8px;row-gap:5px}.treasure-file-row { padding:16px 0; } }
@media(max-height:500px) { .personal-workspace.is-hall-treasure { padding:16px 20px; }.treasure-intro,.treasure-file-heading { margin-bottom:12px; }.treasure-tabs { margin-bottom:10px; }.treasure-file-row { padding:12px 0; } }
</style>
