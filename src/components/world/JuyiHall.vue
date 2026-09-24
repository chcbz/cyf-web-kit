<template>
  <div ref="hallRootRef" class="juyi-page" tabindex="-1" :style="hallViewportStyle" :class="{ 'is-immersive-map': isImmersiveMap, 'is-panel-open': isPanelSessionActive, 'is-virtual-landscape': isVirtualLandscape, [`experience-${experienceMode}`]: true, [`home-${homeMode}`]: true }">
    <aside v-show="isOverviewHome" class="hall-workbench-sidebar" :inert="voiceInteractionLocked || isPanelSessionActive && !workbenchPrimaryPanelSet.has(renderedPanel) ? '' : null" aria-label="工作台侧栏">
      <button class="workbench-brand" type="button" @click="openWorkbenchPage('overview')"><span class="workbench-seal">聚</span><span>聚义厅<small>一起，把事情办成。</small></span></button>
      <p class="workbench-nav-caption">我的工作空间</p>
      <nav class="workbench-side-nav" aria-label="工作台主导航">
        <button v-for="tab in workbenchPrimaryTabs" :key="tab.panel" type="button" :data-workbench-tab="tab.panel" :aria-current="workbenchCurrentPage === tab.panel ? 'page' : null" @click="openWorkbenchPage(tab.panel)"><var-icon :name="tab.icon" /><span>{{ tab.label }}</span></button>
      </nav>
      <div class="workbench-sidebar-bottom">
        <button class="workbench-map-entry" type="button" @click="openWorkbenchMap"><var-icon name="map-marker-outline" /><span>厅中实景<small>去梁山走一走</small></span><var-icon name="chevron-right" /></button>
        <nav class="workbench-side-nav workbench-side-utility" aria-label="工作台辅助导航">
          <button type="button" @click="emit('open-onboarding', $event.currentTarget)"><var-icon name="help-circle-outline" /><span>使用帮助</span></button>
          <button type="button" :disabled="accountEntryDisabled" @click="openProfile"><var-icon name="account-circle-outline" /><span>个人中心</span></button>
        </nav>
      </div>
    </aside>
    <header v-show="!isImmersiveMap" class="hall-app-header" :inert="isPanelSessionActive && !workbenchPrimaryPanelSet.has(renderedPanel) || voiceInteractionLocked ? '' : null" :aria-hidden="isPanelSessionActive && !workbenchPrimaryPanelSet.has(renderedPanel) ? 'true' : null">
      <button class="hall-brand" type="button" @click="setHomeMode('overview')"><span class="hall-seal">聚</span><span>聚义厅<small>梁山好汉 · 共成其事</small></span></button>
      <nav class="hall-main-nav" aria-label="聚义厅主导航">
        <button type="button" :aria-current="isOverviewHome && !activePanel ? 'page' : null" @click="openWorkbenchPage('overview')">办事概览</button>
        <button type="button" @click="openWorkbenchPage('tasks')">我的事项</button>
        <button type="button" @click="openWorkbenchPage('chat')">厅内议事</button>
        <button type="button" aria-label="打开百宝箱" @click="openWorkbenchPage('treasure')">百宝箱</button>
      </nav>
      <div class="hall-header-tools">
        <button type="button" @click="isOverviewHome ? openWorkbenchPage('agents') : openPanel('agents')">好汉</button>
        <button type="button" aria-label="查看消息" @click="isOverviewHome ? openWorkbenchPage('messages') : openPanel('messages')">消息</button>
        <button class="workbench-create-action" type="button" @click="openPrivateDraft()">＋ 提出需求</button>
        <button type="button" :disabled="accountEntryDisabled" aria-label="个人中心" @click="openProfile">账户</button>
        <button class="workbench-mobile-more" type="button" aria-label="全部入口" :aria-expanded="workbenchMenuOpen" @click="workbenchMenuOpen = !workbenchMenuOpen"><var-icon name="menu" /></button>
      </div>
      <nav v-if="workbenchMenuOpen && isOverviewHome" class="workbench-more-menu" aria-label="全部入口">
        <button v-for="tab in workbenchPrimaryTabs" :key="tab.panel" type="button" @click="openWorkbenchPage(tab.panel, $event)">{{ tab.label }}</button>
        <button type="button" @click="openWorkbenchMap">厅中实景</button>
        <button type="button" :disabled="accountEntryDisabled" @click="workbenchMenuOpen = false; openProfile()">个人中心</button>
        <button type="button" @click="workbenchMenuOpen = false; emit('open-onboarding', $event.currentTarget)">使用帮助</button>
      </nav>
    </header>
    <div v-show="!isImmersiveMap" class="hall-mode-toolbar" :inert="isPanelSessionActive || voiceInteractionLocked ? '' : null" :aria-hidden="isPanelSessionActive ? 'true' : null">
      <div class="hall-mode-switch" aria-label="聚义厅视图"><button type="button" :aria-pressed="homeMode === 'map'" @click="setHomeMode('map')">厅中实景</button><button type="button" :aria-pressed="homeMode === 'overview'" @click="setHomeMode('overview')">办事概览</button></div>
      <span class="hall-mode-hint">地图入口与办事入口，通向同一件事</span>
      <div class="hall-scene-tools">
        <button type="button" @click="openPanel('library')">典籍阁</button>
        <button v-if="homeMode === 'map' && experienceMode === 'landscape-map'" type="button" aria-label="缩小地图" @click="hallStageRef?.zoom(-0.12)">−</button>
        <button v-if="homeMode === 'map' && experienceMode === 'landscape-map'" type="button" aria-label="放大地图" @click="hallStageRef?.zoom(0.12)">+</button>
        <button v-if="homeMode === 'map' && experienceMode === 'landscape-map'" type="button" @click="hallStageRef?.resetCamera()">全景</button>
        <button v-if="experienceMode === 'landscape-map'" type="button" aria-label="方向控制" @click="requestPanelOrientation">{{ orientationRequestPending ? '取消切换' : (experienceMode === 'landscape-map' ? '纵向布局' : '横向布局') }}</button>
        <button class="hall-sound-action" type="button" :aria-pressed="soundEnabled" @click="toggleHallSound">{{ soundEnabled ? '关闭声音' : '开启声音' }}</button>
        <button class="hall-help-action" type="button" @click="emit('open-onboarding', $event.currentTarget)">怎么开始？</button>
      </div>
    </div>
    <nav v-show="isOverviewHome" class="workbench-mobile-nav" aria-label="移动端导航" :inert="voiceInteractionLocked || isPanelSessionActive && !workbenchPrimaryPanelSet.has(renderedPanel) ? '' : null">
      <button v-for="tab in workbenchMobileTabs" :key="tab.panel" type="button" :data-workbench-tab="tab.panel" :aria-label="tab.label" :aria-current="workbenchCurrentPage === tab.panel ? 'page' : null" @click="openWorkbenchPage(tab.panel)"><var-icon :name="tab.icon" /><span>{{ tab.label }}</span></button>
    </nav>
    <HallPortraitHome
      ref="portraitHomeRef"
      unified-shell
      v-show="!experienceReady || experienceMode === 'portrait-command' || isOverviewHome"
      :home-mode="homeMode"
      :compact="isLowHeightPanel"
      :live-preview-enabled="true"
      :account-avatar="accountAvatar"
      :account-display-name="accountDisplayName"
      :account-entry-disabled="accountEntryDisabled"
      :live-preview-state="previewPresentationState"
      :live-preview-error="previewSceneError"
      :live-preview-map-width="previewSceneBounds.width"
      :live-preview-map-height="previewSceneBounds.height"
      :agents="agents"
      :map-agents="mapAgents"
      :operable-agents="operableRosterAgents"
      :orientation-hint="orientationHint"
      :orientation-request-pending="orientationRequestPending"
      :selected-agent="selectedAgent"
      :selected-task="selectedTask"
      :can-start-agent-conversation="canStartAgentConversation"
      :task-detail-open="portraitTaskDetailOpen"
      :status-class="statusClass"
      :task-state-class="taskStateClass"
      :task-status-text="taskStatusText"
      :tasks="tasks"
      :inert="isPanelSessionActive || voiceInteractionLocked ? '' : null"
      :aria-hidden="isPanelSessionActive || voiceInteractionLocked ? 'true' : null"
      @set-home-mode="setHomeMode"
      @quick-action="handlePortraitQuickAction"
      @open-profile="openProfile"
      @open-workspace="openBabaoBox"
      @open-onboarding="emit('open-onboarding', $event)"
      @request-landscape="requestPortraitLandscape"
      @cancel-orientation="requestPortrait"
      @retry-live-preview="retryLivePreview"
      @live-preview-visibility-change="handlePreviewVisibility"
      @select-agent="handlePortraitAgentSelect"
      @start-agent-conversation="handleStartAgentConversation"
      @open-task="handlePortraitTaskOpen"
      @close-task-detail="closePortraitTaskDetail"
      @open-task-board="handlePortraitTaskBoard"
      @discuss-task="handlePortraitTaskDiscussion"
    >
      <template #overview>
        <HallOverview
          :refresh-key="hallReadRevision"
          :enabled="Boolean(hallIdentityScope)"
          :identity-scope="hallIdentityScope"
          :identity-epoch="apiStore.authorizationGeneration"
          :agents="operableRosterAgents"
          @set-home-mode="setHomeMode"
          @open-board="openPanel('tasks')"
          @open-workspace="openBabaoBox"
          @open-agents="openPanel('agents')"
          @start-chat="startContextConversation"
          @start-draft="openPrivateDraft()"
          @open-item="openOverviewItem"
          @open-task="openOverviewTask"
        />
      </template>
    </HallPortraitHome>

    <div ref="landscapeTargetRef" v-show="experienceMode === 'landscape-map' && !isOverviewHome" class="hall-live-landscape-target"></div>
    <Teleport :to="stageTarget" :disabled="!stageTarget">
    <HallStage
      v-if="stageMounted"
      ref="hallStageRef"
      :unified-shell="!isImmersiveMap"
      v-show="experienceReady"
      :read-only-preview="experienceMode === 'portrait-command' || isOverviewHome"
      :account-avatar="accountAvatar"
      :account-display-name="accountDisplayName"
      :account-entry-disabled="accountEntryDisabled"
      :preview-visible="stageDrawVisible"
      :agent-bubbles="agentBubbles"
      :agent-key="agentKey"
      :agent-style="sceneAgentStyle"
      :hidden-agent-count="hiddenAgentCount"
      :experience-mode="experienceMode"
      :home-mode="homeMode"
      :interaction-locked="isPanelSessionActive || voiceInteractionLocked"
      :is-mobile-coarse="isMobileCoarse"
      :inert="isPanelSessionActive ? '' : null"
      :aria-hidden="isPanelSessionActive ? 'true' : null"
      :landscape-entry-target="landscapeEntryTarget"
      :map-resume-snapshot="mapResumeSnapshot"
      :orientation-hint="orientationHint"
      :orientation-request-pending="orientationRequestPending"
      :portrait-name="portraitName"
      :portrait-short-name="portraitShortName"
      :portrait-style="portraitStyle"
      :role-class="roleClass"
      :simulation-enabled="simulationEnabled"
      :scene-agents="sceneAgents"
      :scene-hotspots="sceneHotspots"
      :selected-agent="selectedAgent"
      :sound-enabled="soundEnabled"
      :status-class="statusClass"
      :status-text="statusText"
      :tasks="tasks"
      :virtual-landscape="isVirtualLandscape"
      :tasks-total="tasks.length"
      :visible-agents="visibleAgents"
      @landscape-target-consumed="handleLandscapeTargetConsumed"
      @map-snapshot="handleMapSnapshot"
      @map-snapshot-clear="clearMapResumeSnapshot"
      @open-profile="openProfile"
      @open-workspace="openBabaoBox"
      @new-conversation="handleNewHallConversation"
      @open-panel="handleStagePanelOpen"
      @set-home-mode="setHomeMode"
      @request-landscape="requestLandscape"
      @request-portrait="requestPortrait"
      @open-onboarding="emit('open-onboarding', $event)"
      @select-agent="selectAgent"
      @simulation-phase-events="handleSimulationPhaseEvents"
      @simulation-ready="handleSimulationReady"
      @simulation-reset="resetSimulationLifecycle"
      @scene-mode-change="handleSceneModeChange"
      @scene-state-change="handlePreviewSceneState"
      @scene-error="handlePreviewSceneError"
      @scene-bounds-change="handlePreviewSceneBounds"
      @toggle-sound="toggleHallSound"
    >

      <HallVoiceHud v-if="effectiveSceneMode === 'landscape' && !activePanel" :voice="hallVoice" @apply="applyVoiceTranscript" />

      <div v-if="selectedAgent" class="quick-bar">
        <transition name="agent-card">
          <SelectedAgentCard
            :ability-text="abilityText"
            :agent="selectedAgent"
            :locked="voiceInteractionLocked"
            :portrait-name="portraitName"
            :portrait-style="portraitStyle"
            :status-text="statusText"
            @close-card="closeSelectedAgentCard"
            @open-agents="openPanel('agents')"
          />
        </transition>
      </div>
    </HallStage>
    </Teleport>

    <footer v-if="homeMode === 'map' && !isImmersiveMap" class="hall-map-actions" :inert="isPanelSessionActive || voiceInteractionLocked ? '' : null" :aria-hidden="isPanelSessionActive ? 'true' : null">
      <button class="hall-primary" type="button" @click="openPrivateDraft()">＋ 提出需求</button>
      <button type="button" :aria-label="conversationEntryLabel" @click="startContextConversation">{{ conversationEntryLabel }}</button>
      <span>不必先懂所有功能，就能开始办事</span>
      <button class="hall-continue" type="button" @click="setHomeMode('overview')">接着上次办 →</button>
    </footer>

    <HallVoiceHud
      v-if="experienceMode === 'portrait-command' && voiceInteractionLocked && !activePanel"
      :voice="hallVoice"
      @apply="applyVoiceTranscript"
    />

    <transition name="panel" @after-leave="handlePanelAfterLeave">
      <div v-if="activePanel" :key="panelSessionGeneration" class="panel-overlay" :class="{ 'is-full-window': panelLayout === 'full-window', 'is-low-height': isLowHeightPanel, 'is-chat-overlay': renderedPanel === 'chat', 'is-compact-chat-overlay': renderedPanel === 'chat' && isCompactChat, 'is-workbench-panel': isOverviewHome && workbenchPrimaryPanelSet.has(renderedPanel) }" :data-panel-generation="panelSessionGeneration" @pointerdown.self="closePanel">
        <section
          ref="panelRef"
          class="floating-panel"
          :class="[`panel-${renderedPanel}`, `layout-${panelLayout}`]"
          role="dialog"
          :aria-modal="isOverviewHome && workbenchPrimaryPanelSet.has(renderedPanel) ? 'false' : 'true'"
          :aria-labelledby="panelTitleId"
          tabindex="-1"
          @wheel.stop
          @pointerdown.stop
          @pointermove.stop
          @pointerup.stop
          @pointercancel.stop
          @keydown="handlePanelKeydown"
          @keyup.stop
          @input.stop
          @click.stop
        >
          <div class="panel-title">
            <button
              class="panel-close"
              type="button"
              aria-label="关闭面板"
              :disabled="voiceInteractionLocked"
              @click="closePanel"
            >
              <var-icon name="close-circle-outline" />
            </button>
            <button
              v-if="panelReturnPanel || panelChildCanReturn"
              class="panel-return"
              type="button"
              aria-label="返回上一层"
              :disabled="voiceInteractionLocked"
              @click="returnPanel"
            >返回</button>
            <span :id="panelTitleId">{{ activePanelTitle }}</span>
            <button
              v-if="experienceMode === 'landscape-map'"
              class="panel-orientation"
              type="button"
              :aria-label="orientationRequestPending ? '取消方向请求' : (experienceMode === 'landscape-map' ? '切换竖向布局' : '切换横向布局')"
              :disabled="voiceInteractionLocked"
              @click="requestPanelOrientation"
            >{{ orientationRequestPending ? '取消切换' : (experienceMode === 'landscape-map' ? '竖向' : '横向') }}</button>
            <button
              v-if="taskWorkspaceEnabled && renderedPanel === 'tasks' && taskWorkspaceSubject"
              class="panel-workspace-link"
              type="button"
              @click="openTaskWorkspace"
            >
              协作工作台
            </button>
          </div>

          <AgentPanel
            v-if="panelFrames.includes('agents')"
            v-show="renderedPanel === 'agents'"
            :inert="renderedPanel !== 'agents' ? '' : null"
            :aria-hidden="renderedPanel !== 'agents' ? 'true' : null"
            :ability-text="abilityText"
            :agents="agents"
            :filtered-agents="filteredAgents"
            :map-agents="mapAgents"
            :portrait-name="portraitName"
            :portrait-style="portraitStyle"
            :selected-agent="selectedAgent"
            :status-class="statusClass"
            :status-filters="statusFilters"
            :status-text="statusText"
            :agent-filter="agentFilter"
            :loading="rosterLoading"
            :error-message="rosterError"
            @set-agent-filter="setAgentFilter"
            @select-agent="selectAgent"
            :can-start-conversation="canStartAgentConversation"
            @start-conversation="handleStartAgentConversation"
            @open-catalog="openPanel('catalog')"
          />

          <section v-if="leaveState !== 'idle'" class="panel-save-warning" role="alert">
            <p>{{ leaveState === 'saving' ? '正在保存草稿，请稍候…' : '草稿尚未保存，仍留在原处。请重试、继续编辑，或明确放弃未保存的修改。' }}</p>
            <button type="button" :disabled="leaveState === 'saving'" @click="retryPanelLeave">重试保存并继续</button>
            <button type="button" @click="cancelPanelLeave">留在当前页</button>
            <button type="button" :disabled="leaveState === 'saving'" @click="discardPanelChangesAndLeave">放弃未保存修改并继续</button>
          </section>

          <BountyPanel
            v-if="panelFrames.includes('tasks')"
            v-show="renderedPanel === 'tasks' && !formalTaskRef"
            ref="bountyPanelRef"
            v-model:task-ability-filter="taskAbilityFilter"
            v-model:task-keyword="taskKeyword"
            embedded-hall
            :detail-allowed="canOpenPanelDetail"
            :inert="renderedPanel !== 'tasks' || formalTaskRef ? '' : null"
            :aria-hidden="renderedPanel !== 'tasks' || formalTaskRef ? 'true' : null"
            :ability-text="abilityText"
            :can-assign="canAssign"
            :funded-preview-enabled="economyPreviewEnabled"
            :work-item-plan-enabled="workItemPlanEnabled"
            :authorization-generation="apiStore.authorizationGeneration"
            :identity-scope="hallIdentityScope"
            :formal-task-execution-context="formalTaskExecutionContext"
            :funded-quote-preview="fundedQuotePreview"
            :funded-claim-state="fundedClaimState"
            :funded-create-recovery="fundedCreateRecovery"
            :format-time="formatTime"
            :portrait-name="portraitName"
            :portrait-style="portraitStyle"
            :recommended-agents="recommendedAgents"
            :selected-agent="selectedAgent"
            :operable-agents="operableRosterAgents"
            :selected-task="selectedTask"
            :task-ability-options="taskAbilityOptions"
            :task-agent-match-score="taskAgentMatchScore"
            :task-state-class="taskStateClass"
            :task-status-count="taskStatusCount"
            :task-status-filter="taskStatusFilter"
            :task-status-filters="taskStatusFilters"
            :task-status-text="taskStatusText"
            :tasks="tasks"
            :loading="tasksLoading"
            :error-message="tasksError"
            :counts-loading="taskCountsLoading"
            :counts-error-message="taskCountsError"
            @mark-changed="hallReadRevision += 1"
            @confirm-funded-quote="settleFundedQuote(true)"
            @cancel-funded-quote="settleFundedQuote(false)"
            @refresh-funded-claim="refreshFundedClaim"
            @auto-assign-task="autoAssignTask"
            @assign-task="assignTask"
            @archive-task="archiveTask"
            @brief-selected-task="briefSelectedTask"
            @create-task="createTask"
            @start-private-draft="openPrivateDraft()"
            @open-formal-results="openFormalResults"
            @start-formal-draft="openPanel('formalDraft', { restore: true })"
            @resume-funded-create="resumeFundedCreate"
            @cancel-funded-create-recovery="showToast('原资金榜请求仍会保留；请在准备好后明确恢复。')"
            @cancel-funding="cancelFunding"
            @load-settlement="loadSettlement"
            @open-workspace="openBabaoBox"
            @formal-execution-created="hallReadRevision += 1"
            @formal-execution-recovered="hallReadRevision += 1"
            @discuss-task="discussTask"
            @load-tasks="loadTasks"
            @select-agent="selectAgent"
            @select-task="selectTask"
            @set-status-filter="setTaskStatusFilter"
          />

          <FormalTaskDeliveryPanel
            v-if="renderedPanel === 'tasks' && formalTaskRef && hallIdentityScope"
            :key="formalTaskRef.id"
            :task-id="formalTaskRef.id"
            :identity-fingerprint="`${hallIdentityScope}:${apiStore.authorizationGeneration}`"
            :focus-delivery-id="taskReviewRef?.taskId === formalTaskRef.id ? taskReviewRef.deliveryId : ''"
            :execution-context="formalTaskExecutionContext"
            :selected-agent-id="selectedAgent?.agentId || ''"
            @discuss-task="discussTask(formalTaskRef)"
            @rework-created="hallReadRevision += 1"
          />

          <template v-if="taskWorkspaceEnabled && renderedPanel === 'workspace' && taskWorkspaceSubject">
            <TaskWorkspacePanel
              :actor-agent-id="taskWorkspaceSubject.actorAgentId"
              :connection-state="taskWorkspaceConnectionState"
              :error="taskWorkspaceError"
              :workspace="taskWorkspaceSnapshot"
              @retry="retryTaskWorkspace"
            />
            <ArtifactTransferPanel
              :subject="taskWorkspaceSubject"
              :workspace="taskWorkspaceSnapshot"
              :identity-epoch="apiStore.authorizationGeneration"
            />
            <ArtifactOutcomePanel
              :subject="taskWorkspaceSubject"
              :workspace="taskWorkspaceSnapshot"
              :identity-epoch="apiStore.authorizationGeneration"
            />
          </template>

          <HallOverview
            v-if="panelFrames.includes('messages')"
            v-show="renderedPanel === 'messages'"
            :refresh-key="hallReadRevision"
            :inert="renderedPanel !== 'messages' ? '' : null"
            :aria-hidden="renderedPanel !== 'messages' ? 'true' : null"
            messages-only
            :enabled="Boolean(hallIdentityScope)"
            :identity-scope="hallIdentityScope"
            :identity-epoch="apiStore.authorizationGeneration"
            @open-item="openOverviewItem"
            @open-task="openOverviewTask"
          />

          <HallDraftEditor
            v-if="panelFrames.includes('item') && overviewItemRef"
            v-show="renderedPanel === 'item'"
            :key="`${overviewItemRef.sourceType}:${overviewItemRef.sourceId}`"
            ref="itemDraftRef"
            :inert="renderedPanel !== 'item' ? '' : null"
            :aria-hidden="renderedPanel !== 'item' ? 'true' : null"
            :initial-ref="overviewItemRef"
            :agents="operableRosterAgents"
            :identity-scope="hallIdentityScope"
            :identity-epoch="apiStore.authorizationGeneration"
            @open-task="openOverviewTask"
            @changed="hallReadRevision += 1"
            @close="returnPanel() || closePanel()"
          />

          <HallDraftEditor
            v-if="panelFrames.includes('formalDraft')"
            v-show="renderedPanel === 'formalDraft'"
            ref="formalDraftRef"
            :inert="renderedPanel !== 'formalDraft' ? '' : null"
            :aria-hidden="renderedPanel !== 'formalDraft' ? 'true' : null"
            initial-kind="TASK_CREATE"
            :identity-scope="hallIdentityScope"
            :identity-epoch="apiStore.authorizationGeneration"
            @open-task="openOverviewTask"
            @close="returnPanel() || closePanel()"
          />

          <HallDraftEditor
            v-if="panelFrames.includes('draft')"
            v-show="renderedPanel === 'draft'"
            :key="privateDraftGeneration"
            ref="privateDraftRef"
            :inert="renderedPanel !== 'draft' ? '' : null"
            :aria-hidden="renderedPanel !== 'draft' ? 'true' : null"
            :initial-context="draftContext"
            :agents="operableRosterAgents"
            :identity-scope="hallIdentityScope"
            :identity-epoch="apiStore.authorizationGeneration"
            @changed="hallReadRevision += 1"
            @close="returnPanel() || closePanel()"
          />

          <PersonalWorkspace
            v-if="panelFrames.includes('treasure')"
            v-show="renderedPanel === 'treasure'"
            ref="treasurePanelRef"
            :compact="isLowHeightPanel"
            :inert="renderedPanel !== 'treasure' ? '' : null"
            :aria-hidden="renderedPanel !== 'treasure' ? 'true' : null"
            :detail-allowed="true"
            embedded
            @start-draft="openPrivateDraft"
          />

          <PersonaCatalogPanel
            v-if="panelFrames.includes('catalog')"
            v-show="renderedPanel === 'catalog'"
            :inert="renderedPanel !== 'catalog' ? '' : null"
            :aria-hidden="renderedPanel !== 'catalog' ? 'true' : null"
            :personas="personaCatalog"
            :portrait-name="portraitName"
            :portrait-style="portraitStyle"
            :setup-result="personaSetupResult"
            :loading="catalogLoading"
            :error-message="catalogError"
            @bind-persona="handleBindPersona"
            @clear-setup-result="personaSetupResult = null"
            @hosting-changed="refreshHall({ silent: true })"
            @unbind-persona="handleUnbindPersona"
          />

          <PublicDiscussionPanel
            v-if="panelFrames.includes('chat') && chatMode === 'public'"
            v-show="renderedPanel === 'chat'"
            :inert="renderedPanel !== 'chat' ? '' : null"
            :aria-hidden="renderedPanel !== 'chat' ? 'true' : null"
            :draft="draft"
            :voice="hallVoice"
            @update:draft="setDraft"
            @voice-apply="applyVoiceTranscript"
            :agents="chatMentionAgents"
            :event-stream-recovering="eventStreamRecovering"
            :is-awaiting-reply="isAwaitingReply"
            :is-streaming="isStreaming"
            :messages="messages"
            :mention-label="portraitShortName"
            :pending-agent-name="pendingAgentName"
            :selected-agent="conversationAgent"
            :selected-task="conversationTask"
            :sender-text="senderText"
            :connection-status="chatConnectionStatus"
            :conversation-busy="isConversationBusy"
            :conversation-history="conversationHistory"
            :conversation-history-deleting-id="conversationHistoryDeletingId"
            :conversation-history-error="conversationHistoryError"
            :conversation-history-has-more="conversationHistoryHasMore"
            :conversation-history-loading="conversationHistoryLoading"
            :conversation-id="conversationId"
            :identity-epoch="apiStore.authorizationGeneration"
            :conversation-load-error="conversationLoadError"
            :target-text="chatTargetText"
            :scope-hint="chatContext.conversationScopeKey"
            @clear-target="handleClearChatTarget"
            @delete-conversation="deleteHallConversation"
            @load-history="loadHallConversationHistory({ force: true })"
            @load-more-history="loadMoreHallConversationHistory"
            @load-messages="retryHallConversation"
            @mention-agent="handleMentionAgent"
            @new-conversation="handleNewHallConversation"
            @open-workspace="openBabaoBox"
            @retry-conversation="retryHallConversation"
            @select-conversation="selectHallConversation"
            @send-message="handleSendHallMessage"
          />

          <BountyDiscussionPanel
            v-if="panelFrames.includes('chat') && chatMode === 'bounty'"
            v-show="renderedPanel === 'chat'"
            :inert="renderedPanel !== 'chat' ? '' : null"
            :aria-hidden="renderedPanel !== 'chat' ? 'true' : null"
            :draft="draft"
            :voice="hallVoice"
            @update:draft="setDraft"
            @voice-apply="applyVoiceTranscript"
            :agents="chatMentionAgents"
            :event-stream-recovering="eventStreamRecovering"
            :is-awaiting-reply="isAwaitingReply"
            :is-streaming="isStreaming"
            :messages="messages"
            :mention-label="portraitShortName"
            :pending-agent-name="pendingAgentName"
            :selected-agent="conversationAgent"
            :selected-task="conversationTask"
            :sender-text="senderText"
            :connection-status="chatConnectionStatus"
            :conversation-busy="isConversationBusy"
            :conversation-history="conversationHistory"
            :conversation-history-deleting-id="conversationHistoryDeletingId"
            :conversation-history-error="conversationHistoryError"
            :conversation-history-has-more="conversationHistoryHasMore"
            :conversation-history-loading="conversationHistoryLoading"
            :conversation-id="conversationId"
            :identity-epoch="apiStore.authorizationGeneration"
            :conversation-load-error="conversationLoadError"
            :target-text="chatTargetText"
            :scope-hint="chatContext.conversationScopeKey"
            @clear-target="handleClearChatTarget"
            @delete-conversation="deleteHallConversation"
            @load-history="loadHallConversationHistory({ force: true })"
            @load-more-history="loadMoreHallConversationHistory"
            @load-messages="retryHallConversation"
            @mention-agent="handleMentionAgent"
            @new-conversation="handleNewHallConversation"
            @open-workspace="openBabaoBox"
            @retry-conversation="retryHallConversation"
            @select-conversation="selectHallConversation"
            @send-message="handleSendHallMessage"
          />

          <PrivateDiscussionPanel
            v-if="panelFrames.includes('chat') && chatMode === 'private'"
            v-show="renderedPanel === 'chat'"
            :inert="renderedPanel !== 'chat' ? '' : null"
            :aria-hidden="renderedPanel !== 'chat' ? 'true' : null"
            :draft="draft"
            :voice="hallVoice"
            @update:draft="setDraft"
            @voice-apply="applyVoiceTranscript"
            :agents="chatMentionAgents"
            :event-stream-recovering="eventStreamRecovering"
            :is-awaiting-reply="isAwaitingReply"
            :is-streaming="isStreaming"
            :messages="messages"
            :mention-label="portraitShortName"
            :pending-agent-name="pendingAgentName"
            :selected-agent="conversationAgent"
            :selected-task="conversationTask"
            :sender-text="senderText"
            :connection-status="chatConnectionStatus"
            :conversation-busy="isConversationBusy"
            :conversation-history="conversationHistory"
            :conversation-history-deleting-id="conversationHistoryDeletingId"
            :conversation-history-error="conversationHistoryError"
            :conversation-history-has-more="conversationHistoryHasMore"
            :conversation-history-loading="conversationHistoryLoading"
            :conversation-id="conversationId"
            :identity-epoch="apiStore.authorizationGeneration"
            :conversation-load-error="conversationLoadError"
            :target-text="chatTargetText"
            :scope-hint="chatContext.conversationScopeKey"
            @clear-target="handleClearChatTarget"
            @delete-conversation="deleteHallConversation"
            @load-history="loadHallConversationHistory({ force: true })"
            @load-more-history="loadMoreHallConversationHistory"
            @load-messages="retryHallConversation"
            @mention-agent="handleMentionAgent"
            @new-conversation="handleNewHallConversation"
            @open-workspace="openBabaoBox"
            @retry-conversation="retryHallConversation"
            @select-conversation="selectHallConversation"
            @send-message="handleSendHallMessage"
          />

          <LibraryPanel
            v-if="panelFrames.includes('library')"
            v-show="renderedPanel === 'library'"
            ref="libraryPanelRef"
            v-model:keyword="libraryKeyword"
            v-model:source-type="librarySourceType"
            :inert="renderedPanel !== 'library' ? '' : null"
            :aria-hidden="renderedPanel !== 'library' ? 'true' : null"
            :error-message="libraryErrorMessage"
            :format-time="formatTime"
            :has-searched="libraryHasSearched"
            :loading="libraryLoading"
            :results="libraryResults"
            :detail-allowed="canOpenPanelDetail"
            embedded
            :active="renderedPanel === 'library'"
            :virtual-landscape="isVirtualLandscape"
            @start-draft="openPrivateDraft"
            @cite-library="citeLibraryItem"
            @search-library="searchLibrary"
          />
        </section>
      </div>
    </transition>

    <transition name="toast">
      <div v-if="toast" class="toast" role="status" aria-live="polite">{{ toast }}</div>
    </transition>
  </div>
</template>

<script setup>
import HallOverview from '@/components/juyiting/HallOverview.vue'
import HallDraftEditor from '@/components/juyiting/HallDraftEditor.vue'
import FormalTaskDeliveryPanel from '@/components/deliveries/FormalTaskDeliveryPanel.vue'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRouter } from 'vue-router'
import { useGlobalStore } from '@/stores/global'
import { useApiStore } from '@/stores/api'
import { agentApi, chatApi } from '@/composables/useHttp'
import { useHallChatContext } from '@/composables/juyiting/useHallChatContext'
import { useHallBackendSceneState } from '@/composables/juyiting/useHallBackendSceneState'
import { useHallCommandQueue } from '@/composables/juyiting/useHallCommandQueue'
import { useHallConversation } from '@/composables/juyiting/useHallConversation'
import { useHallVoiceConversation } from '@/composables/juyiting/useHallVoiceConversation'
import { confirmHallLeave, hasMeaningfulHallLeaveWork } from '@/composables/juyiting/hallAccountNavigation'
import { createHallVoiceReplyCorrelation } from '@/composables/juyiting/hallVoiceReplyCorrelation'
import { useHallData } from '@/composables/juyiting/useHallData'
import { useHallLibrary } from '@/composables/juyiting/useHallLibrary'
import { resolveLiveMapPreviewActivation } from '@/composables/juyiting/liveMapPreviewPolicy'
import { useHallExperienceMode } from '@/composables/juyiting/useHallExperienceMode'
import { useHallHomeMode } from '@/composables/juyiting/useHallHomeMode'
import { capturePanelReturnTarget, focusHallPanel, isCurrentPanelGeneration, isSafePanelFocusTarget, resolvePanelReturnTarget, restorePanelFocus, trapPanelFocus, useHallPanels } from '@/composables/juyiting/useHallPanels'
import { useHallScene } from '@/composables/juyiting/useHallScene'
import { useHallSceneState } from '@/composables/juyiting/useHallSceneState'
import { useHallSceneDebugBridge } from '@/composables/juyiting/useHallSceneDebugBridge'
import { useHallSound } from '@/composables/juyiting/useHallSound'
import { useHallTaskActions } from '@/composables/juyiting/useHallTaskActions'
import { useTaskWorkspace } from '@/composables/juyiting/useTaskWorkspace'
import { createDisabledTaskWorkspaceBinding, isTaskWorkspaceBuildEnabled } from '@/composables/juyiting/taskWorkspaceFeature'
import { useTaskWorkspaceView } from '@/composables/juyiting/useTaskWorkspaceView'
import { useTaskWorkspaceBinding } from '@/composables/juyiting/useTaskWorkspaceBinding'
import { useFormalTaskExecutionScope } from '@/composables/useFormalTaskExecutionScope'
import TaskWorkspacePanel from '@/components/juyiting/TaskWorkspacePanel.vue'
import ArtifactTransferPanel from '@/components/juyiting/ArtifactTransferPanel.vue'
import ArtifactOutcomePanel from '@/components/juyiting/ArtifactOutcomePanel.vue'
import { portraitName, portraitRole, portraitShortName, portraitStyle, roleClass } from '@/composables/juyiting/useWaterMarginRoles'
import AgentPanel from '@/components/juyiting/AgentPanel.vue'
import BountyDiscussionPanel from '@/components/juyiting/BountyDiscussionPanel.vue'
import BountyPanel from '@/components/juyiting/BountyPanel.vue'
import HallPortraitHome from '@/components/juyiting/HallPortraitHome.vue'
import HallStage from '@/components/juyiting/HallStage.vue'
import HallVoiceHud from '@/components/juyiting/HallVoiceHud.vue'
import LibraryPanel from '@/components/juyiting/LibraryPanel.vue'
import PersonaCatalogPanel from '@/components/juyiting/PersonaCatalogPanel.vue'
import PrivateDiscussionPanel from '@/components/juyiting/PrivateDiscussionPanel.vue'
import PublicDiscussionPanel from '@/components/juyiting/PublicDiscussionPanel.vue'
import SelectedAgentCard from '@/components/juyiting/SelectedAgentCard.vue'
import PersonalWorkspace from '@/components/workspace/PersonalWorkspace.vue'
import {
  roleDialogues,
  statusFilters,
  taskStatusFilters
} from '@/constants/juyiting'
import { log } from '@/utils/logger'
import { isEconomyPreviewBuildEnabled } from '@/utils/silverAmount'
import { isEconomyPreviewCapability, loadEconomyPreviewCapability } from '@/utils/economyPreviewCapability'
import { juyitingGame } from '@/game/index.js'

const emit = defineEmits(['open-onboarding'])

const globalStore = useGlobalStore()
const apiStore = useApiStore()
const router = useRouter()
const accountAvatar = computed(() => String(globalStore.user?.avatar || '').trim())
const accountDisplayName = computed(() => {
  const user = globalStore.user || {}
  return String(user.nickname || user.username || globalStore.getUserId || '个人中心').trim() || '个人中心'
})
const hallIdentityScope = computed(() => {
  const owner = String(globalStore.user?.id || globalStore.user?.openid || globalStore.getUserId || globalStore.getOpenid || '').trim()
  const client = String(apiStore.oauthClientId || '').trim()
  const tenant = String(globalStore.user?.tenantId || globalStore.user?.tenantCode || globalStore.user?.tenant || '').trim()
  return owner && client ? [tenant, client, owner].filter(Boolean).join('\u0000') : ''
})

const selectedAgent = ref(null)
const selectedTask = ref(null)
const economyPreviewEnabled = ref(false)
const workItemPlanEnabled = import.meta.env.VITE_JUYITING_WORK_ITEM_PLAN_ENABLED === 'true'
const economyPreviewCapability = ref(null)
const economyPreviewChecked = ref(false)
const economyPreviewBuildEnabled = isEconomyPreviewBuildEnabled(import.meta.env.VITE_ECONOMY_PREVIEW_ENABLED)
const portraitTaskDetailOpen = ref(false)
// Map-only runtime state survives HallStage destroy/remount; business selection stays above it.
const mapResumeSnapshot = ref(null)
const landscapeEntryTarget = ref(null)
let landscapeEntryTargetGeneration = 0
// Stable FE2 entrypoint: taskWorkspace.workspace, connectionState, error, subject, retry, and reload.
const taskWorkspaceEnabled = isTaskWorkspaceBuildEnabled(import.meta.env.VITE_JUYITING_TASK_WORKSPACE_ENABLED)
const taskWorkspace = taskWorkspaceEnabled ? useTaskWorkspace() : null
const taskWorkspaceBinding = taskWorkspaceEnabled
  ? useTaskWorkspaceBinding({ selectedTask, selectedAgent, taskWorkspace })
  : createDisabledTaskWorkspaceBinding(selectedAgent)
const {
  subject: taskWorkspaceSubject,
  workspace: taskWorkspaceSnapshot,
  connectionState: taskWorkspaceConnectionState,
  error: taskWorkspaceError,
  retry: retryTaskWorkspace
} = useTaskWorkspaceView(taskWorkspace)
const personaSetupResult = ref(null)
const toast = ref('')
const panelWhitelist = new Set(['agents', 'catalog', 'tasks', 'workspace', 'treasure', 'chat', 'library', 'messages', 'item', 'formalDraft', 'draft'])
const activePanel = ref('')
const renderedPanel = ref('')
const panelSessionGeneration = ref(0)
const panelClosingGeneration = ref(0)
const panelReturnPanel = ref('')
// Source panes stay mounted only for this navigation session; hidden panes are inert.
const panelFrames = ref([])
const privateDraftRef = ref(null)
const itemDraftRef = ref(null)
const formalDraftRef = ref(null)
const draftContext = ref(null)
const privateDraftGeneration = ref(0)
const formalTaskRef = ref(null)
const leaveState = ref('idle')
let pendingPanelLeave = null
let bypassPanelSave = false
const activeDraftEditor = () => ({ draft: privateDraftRef.value, item: itemDraftRef.value, formalDraft: formalDraftRef.value })[renderedPanel.value]
const cancelPanelLeave = () => {
  pendingPanelLeave = null
  leaveState.value = 'idle'
}
const retryPanelLeave = async () => {
  if (!pendingPanelLeave || leaveState.value === 'saving') return false
  const pending = pendingPanelLeave
  const generation = panelSessionGeneration.value
  leaveState.value = 'saving'
  let saved = false
  try { saved = await activeDraftEditor()?.saveBeforeLeave() } catch { /* Keep the original form and source on failure. */ }
  if (pendingPanelLeave !== pending || generation !== panelSessionGeneration.value || panelDisposed) return false
  if (!saved) { leaveState.value = 'error'; return false }
  cancelPanelLeave()
  bypassPanelSave = true
  try { pending() } finally { bypassPanelSave = false }
  return true
}
const discardPanelChangesAndLeave = () => {
  if (!pendingPanelLeave || leaveState.value === 'saving') return false
  const pending = pendingPanelLeave
  activeDraftEditor()?.discardLocalChanges?.()
  cancelPanelLeave()
  bypassPanelSave = true
  try { pending() } finally { bypassPanelSave = false }
  return true
}
const guardPanelLeave = action => {
  if (bypassPanelSave) return false
  if (pendingPanelLeave) return true
  const editor = activeDraftEditor()
  if (!editor?.needsSave && !editor?.busy) return false
  pendingPanelLeave = action
  void retryPanelLeave()
  return true
}
const overviewItemRef = ref(null)
const taskReviewRef = ref(null)
const hallReadRevision = ref(0)
const bountyPanelRef = ref(null)
const panelLocations = new Map()
const treasurePanelRef = ref(null)
const libraryPanelRef = ref(null)
// Retained file/reading detail also consumes a logical layer while its source is hidden.
const panelDepth = computed(() => panelFrames.value.length
  + Number(panelFrames.value.includes('tasks') && Boolean(bountyPanelRef.value?.canGoBack))
  + Number(panelFrames.value.includes('treasure') && Boolean(treasurePanelRef.value?.canGoBack))
  + Number(panelFrames.value.includes('library') && Boolean(libraryPanelRef.value?.canGoBack)))
const canOpenPanelDetail = computed(() => panelDepth.value < 3)
const panelChildCanReturn = computed(() => {
  if (activeDraftEditor()) return Boolean(activeDraftEditor().canGoBack)
  if (renderedPanel.value === 'tasks') return Boolean(formalTaskRef.value || bountyPanelRef.value?.canGoBack)
  if (renderedPanel.value === 'treasure') return Boolean(treasurePanelRef.value?.canGoBack)
  if (renderedPanel.value === 'library') return Boolean(libraryPanelRef.value?.canGoBack)
  return false
})
const isPanelSessionActive = computed(() => Boolean(renderedPanel.value))
const hallRefreshing = ref(false)
const experienceReady = ref(false)
const agentBubbles = ref({})
const outgoingMetadata = ref({})
const effectiveSceneMode = ref('portrait')
const voiceFeatureEnabled = import.meta.env.VITE_JUYITING_VOICE_ENABLED === 'true'
let hallVoice = null
const spokenVoiceReplyIds = new Set()
const voiceReplyCorrelation = createHallVoiceReplyCorrelation({
  spokenMessageIds: spokenVoiceReplyIds,
  onReply: message => hallVoice?.completeReply(message)
})
const { homeMode, isOverviewHome, setHomeMode } = useHallHomeMode()
const workbenchPrimaryTabs = Object.freeze([
  { panel: 'overview', label: '办事概览', icon: 'home-outline' },
  { panel: 'tasks', label: '我的事项', icon: 'format-list-checkbox' },
  { panel: 'chat', label: '厅内议事', icon: 'chat-processing-outline' },
  { panel: 'agents', label: '点将册', icon: 'account-circle-outline' },
  { panel: 'treasure', label: '百宝箱', icon: 'file-document-outline' },
  { panel: 'library', label: '典籍阁', icon: 'notebook' },
  { panel: 'messages', label: '消息通知', icon: 'bell-outline' }
])
const workbenchMobileTabs = Object.freeze(workbenchPrimaryTabs.filter(tab => ['overview', 'tasks', 'chat', 'library'].includes(tab.panel)))
const workbenchPrimaryPanelSet = new Set(workbenchPrimaryTabs.map(tab => tab.panel))
const workbenchMenuOpen = ref(false)
const workbenchCurrentPage = computed(() => isOverviewHome.value ? (activePanel.value && workbenchPrimaryPanelSet.has(renderedPanel.value) ? renderedPanel.value : 'overview') : '')
watch(homeMode, () => { workbenchMenuOpen.value = false })
watch(activePanel, () => { workbenchMenuOpen.value = false })

const {
  experienceMode,
  isMobileCoarse,
  isVirtualLandscape,
  orientationHint,
  orientationRequestPending,
  hallViewportHeight,
  requestLandscape,
  requestPortrait
} = useHallExperienceMode()
// Landscape keeps the existing full-canvas Stage HUD; the business shell belongs
// to portrait/overview. Use owned presentation mode, not keyboard-shrunk height.
const isImmersiveMap = computed(() => experienceMode.value === 'landscape-map' && homeMode.value === 'map')
const resolvedHallViewportHeight = computed(() => Number(hallViewportHeight?.value ?? hallViewportHeight) || 0)
const hallViewportStyle = computed(() => {
  const height = resolvedHallViewportHeight.value
  return height > 0 ? { '--hall-visual-height': `${height}px` } : {}
})
// This follows the live visual viewport, including a keyboard-only shrink.
const isCompactChat = computed(() => resolvedHallViewportHeight.value > 0 && resolvedHallViewportHeight.value <= 320)
const isLowHeightPanel = computed(() => resolvedHallViewportHeight.value > 0 && resolvedHallViewportHeight.value <= 500)
const { panelLayout } = useHallPanels({ experienceMode, isMobileCoarse, viewportHeight: resolvedHallViewportHeight })
const hallRootRef = ref(null)
const portraitHomeRef = ref(null)
const landscapeTargetRef = ref(null)
const hallStageRef = ref(null)
const portraitPreviewVisible = ref(false)
const documentPreviewVisible = ref(typeof document === 'undefined' || !document.hidden)
// Only the active full-page panel overlay is known to cover the preview.
// Voice/loading interaction locks remain independent from draw visibility.
const previewFullyCovered = computed(() => isOverviewHome.value || (activePanel.value === 'chat' && renderedPanel.value === 'chat'))
// Portrait observation gates only first mount. Draw policy is mode-independent:
// an active landscape ignores a stale offscreen portrait observer, but document
// hidden and the known full chat overlay still suppress draw in either mode.
const previewVisible = computed(() => portraitPreviewVisible.value && documentPreviewVisible.value && !previewFullyCovered.value)
const previewSceneState = ref('loading')
const previewDrawActivation = computed(() => resolveLiveMapPreviewActivation({
  documentHidden: !documentPreviewVisible.value,
  landscapeActive: experienceMode.value === 'landscape-map',
  overlayCovered: previewFullyCovered.value,
  portraitOffscreen: !portraitPreviewVisible.value,
  ready: previewSceneState.value === 'ready'
}))
const stageDrawVisible = computed(() => previewDrawActivation.value.shouldRender)
const previewSceneError = ref('')
const previewSceneBounds = ref({ width: 0, height: 0 })
// The Stage is created only after a real landscape entry or observed portrait visibility,
// then remains the sole scene owner until the Hall route unmounts.
const stageHasMounted = ref(false)
const stageTarget = computed(() => (experienceMode.value === 'portrait-command' || isOverviewHome.value)
  ? portraitHomeRef.value?.livePreviewTarget || null
  : landscapeTargetRef.value)
const stageMounted = computed(() => stageHasMounted.value)
const previewPresentationState = computed(() => (
  previewSceneState.value === 'ready' ? previewDrawActivation.value.state : previewSceneState.value
))
const permitStageMount = () => {
  if (!isOverviewHome.value && stageTarget.value && experienceReady.value && (experienceMode.value === 'landscape-map' || previewVisible.value)) {
    stageHasMounted.value = true
  }
}
const handlePreviewVisibility = visible => {
  portraitPreviewVisible.value = Boolean(visible)
  permitStageMount()
}
// `v-show` does not reliably produce a fresh IntersectionObserver record in
// embedded WebViews. Returning from the overview is an explicit confirmation
// that the portrait map is visible, so restore its draw gate immediately.
watch(homeMode, mode => {
  if (mode !== 'map') return
  portraitPreviewVisible.value = true
  permitStageMount()
})
const handleDocumentVisibility = () => {
  documentPreviewVisible.value = typeof document === 'undefined' || !document.hidden
}
const handlePreviewSceneState = state => {
  previewSceneState.value = state || 'loading'
  if (state !== 'error') previewSceneError.value = ''
}
const handlePreviewSceneError = error => {
  previewSceneState.value = 'error'
  previewSceneError.value = error?.message || String(error || '')
}
const handlePreviewSceneBounds = bounds => {
  previewSceneBounds.value = bounds || { width: 0, height: 0 }
}
const retryLivePreview = () => {
  // A paused presentation retains a ready scene; do not turn it back into loading.
  if (previewPresentationState.value !== 'paused') {
    previewSceneState.value = 'loading'
    previewSceneError.value = ''
  }
  void hallStageRef.value?.retryScene?.()
}
watch([experienceReady, experienceMode, previewVisible, stageTarget], permitStageMount, { immediate: true })

const panelRef = ref(null)
const panelTitleId = 'juyiting-floating-panel-title'
let panelSessionOrigin = null
let panelChatLoadTimer = null
let panelDisposed = false
let bubbleTimer = null
let bubbleInitialTimer = null
let bubbleClearTimer = null
const simulationEnabled = import.meta.env.VITE_JUYITING_SIMULATION_ENABLED === 'true'
const hallCommandQueue = useHallCommandQueue()
let hallBackendSceneState = null
const hallSceneState = useHallSceneState({
  commandQueue: hallCommandQueue,
  reportPhase: report => hallBackendSceneState?.reportPhase(report)
})
let backendSceneStarted = false

const {
  playAgentSelect,
  playError,
  playPanelOpen,
  playRefresh,
  playSend,
  playSuccess,
  playTap,
  setSoundEnabled,
  setSoundSuppressed,
  soundEnabled
} = useHallSound()

const activePanelTitle = computed(() => {
  const childTitle = activeDraftEditor()?.windowTitle || (renderedPanel.value === 'treasure' && treasurePanelRef.value?.windowTitle)
  if (childTitle) return childTitle
  if (renderedPanel.value === 'draft') return '提出需求'
  if (renderedPanel.value === 'tasks' && formalTaskRef.value) return '正式成果与验收'
  if (renderedPanel.value === 'formalDraft') return '起草正式任务'
  if (renderedPanel.value === 'messages') return '消息'
  if (renderedPanel.value === 'item') return overviewItemRef.value?.sourceType === 'DRAFT' ? '继续草稿' : '事项进展'
  if (renderedPanel.value === 'agents') return '点将册'
  if (renderedPanel.value === 'catalog') return '招贤令'
  if (renderedPanel.value === 'tasks') return '悬赏榜'
  if (renderedPanel.value === 'workspace') return '协作工作台'
  if (renderedPanel.value === 'treasure') return '百宝箱'
  if (renderedPanel.value === 'chat') return '厅内议事'
  if (renderedPanel.value === 'library') return '典籍阁'
  return ''
})

const normalizeStatus = (status = '') => status.toLowerCase()

const statusClass = (status = '') => {
  const value = normalizeStatus(status)
  if (value === 'busy') return 'is-busy'
  if (value === 'error') return 'is-error'
  if (value === 'offline') return 'is-offline'
  return 'is-idle'
}

const statusText = (status = '') => {
  const value = normalizeStatus(status)
  if (value === 'busy') return '办事'
  if (value === 'offline') return '出征'
  if (value === 'error') return '失联'
  return '候命'
}

// Use the filter metadata as the single lifecycle presentation contract. `detailAllowed`
// only controlled panel nesting; file reads still go through PersonalWorkspace's scoped API.
const taskStatusMeta = status => taskStatusFilters.find(item => item.value === normalizeStatus(status))
const taskStatusText = status => taskStatusMeta(status)?.label || '状态待核对'
const taskStateClass = status => taskStatusMeta(status)?.className || 'task-state-unknown'

const abilityText = (agent) => {
  const abilities = agent.abilities || []
  return abilities.length ? abilities.slice(0, 3).join(' / ') : '未录本领'
}


const taskAgentMatchScore = (task, agent) => {
  const requiredAbilities = task?.requiredAbilities || []
  if (!requiredAbilities.length) return 80
  const agentAbilities = new Set((agent?.abilities || []).map(ability => ability.toLowerCase()))
  const matched = requiredAbilities.filter(ability => agentAbilities.has(String(ability).toLowerCase())).length
  return Math.round((matched / requiredAbilities.length) * 100)
}

const {
  applySceneEvent,
  applySceneSnapshot,
  agentFilter,
  agents,
  bindPersona,
  canAssign,
  catalogError,
  catalogLoading,
  filteredAgents,
  hiddenAgentCount,
  loadAgents,
  loadPersonaCatalog,
  loadRosterAgents,
  loadTasks,
  loadTaskRecommendations,
  mapAgents,
  mapError,
  operableRosterAgents,
  personaCatalog,
  recommendedAgents,
  rosterError,
  rosterLoading,
  setAgentFilter,
  setTaskStatusFilter,
  taskAbilityFilter,
  taskAbilityOptions,
  taskKeyword,
  taskCountsError,
  taskCountsLoading,
  tasks,
  tasksError,
  tasksLoading,
  taskStatusCount,
  taskStatusFilter,
  unbindPersona,
  visibleAgents
} = useHallData({
  agentApi,
  log,
  normalizeStatus,
  selectedAgent,
  selectedTask,
  taskAgentMatchScore,
  sceneState: hallSceneState
})

hallBackendSceneState = useHallBackendSceneState({
  agentApi,
  onSnapshot: applySceneSnapshot,
  onEvent: applySceneEvent
})

const hallSceneDebugBridge = useHallSceneDebugBridge({
  backend: hallBackendSceneState,
  commandQueue: hallCommandQueue,
  game: juyitingGame
})

const {
  chatContext,
  conversationAgent,
  conversationTask,
  chatMentionAgentIds,
  chatMentionAgents,
  chatMode,
  chatTargetText,
  enterBountyDiscussion,
  enterPrivateConversation,
  resetToPublic,
  setMentionAgent
} = useHallChatContext({
  agents,
  mapAgents,
  portraitShortName,
  selectedAgent,
  selectedTask
})

const startBackendSceneState = async () => {
  if (backendSceneStarted) return
  backendSceneStarted = true
  try {
    await hallBackendSceneState.start()
  } catch (error) {
    backendSceneStarted = false
    log.warn('Juyiting backend scene state degraded:', error)
  }
}

const handleSimulationReady = async ({ movementRuntime, simulation } = {}) => {
  if (!simulationEnabled || !movementRuntime || !simulation?.enqueue) return
  hallSceneState.setMapRuntime(movementRuntime)
  hallCommandQueue.setSimulation(simulation)
  hallSceneDebugBridge.republish()
  await startBackendSceneState()
}

const resetSimulationLifecycle = () => {
  backendSceneStarted = false
  hallBackendSceneState?.stop()
  hallCommandQueue.setSimulation(null)
  hallSceneState.reset()
}

const handleSimulationPhaseEvents = events => {
  if (!simulationEnabled) return
  void hallSceneState.forwardPhaseEvents(events).catch(error => {
    log.warn('Juyiting phase forwarding failed:', error)
  })
}

const ensureEconomyPreviewCapability = async () => {
  if (!economyPreviewBuildEnabled || economyPreviewChecked.value) return economyPreviewEnabled.value
  economyPreviewChecked.value = true
  try {
    economyPreviewCapability.value = await loadEconomyPreviewCapability()
    economyPreviewEnabled.value = isEconomyPreviewCapability(economyPreviewCapability.value)
  } catch (error) {
    economyPreviewCapability.value = null
    economyPreviewEnabled.value = false
    log.warn('economy preview capability is unavailable:', error)
  }
  return economyPreviewEnabled.value
}

const loadPanelData = async (panel) => {
  if (panel === 'agents') return Promise.all([loadRosterAgents(), loadPersonaCatalog()])
  if (panel === 'catalog') return loadPersonaCatalog()
  if (panel === 'tasks') return loadTasks()
  return null
}

const refreshHall = async ({ silent = false } = {}) => {
  if (hallRefreshing.value) return
  hallRefreshing.value = true
  if (!silent) playRefresh()
  try {
    // The portrait entry exposes current-user operable agents immediately, so its
    // initial refresh must keep the map, roster, and catalog projections in sync.
    // Scene snapshot startup remains independent of those reads.
    await loadAgents()
    if (simulationEnabled && hallCommandQueue.ready.value && !backendSceneStarted) {
      await startBackendSceneState()
    }
    await loadPanelData(activePanel.value)
    if (!silent) showToast(mapError.value ? '厅中点将暂无法读取' : '厅中动静已点验')
  } finally {
    hallRefreshing.value = false
  }
}

const formatTime = (timestamp) => {
  if (!timestamp) return ''
  const date = new Date(Number(timestamp))
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getMonth() + 1}-${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

const agentKey = (agent) => agent?.agentId || agent?.name || agent?.personaName || ''

const {
  markAgentSpeaking,
  markDiscussionStarted,
  markLibraryCitation,
  markLibrarySearching,
  markRecommendedAgents,
  markTaskArchived,
  markTaskAssigned,
  markTaskAutoAssigned,
  markTaskCreated,
  resetSceneFeedback,
  sceneAgents,
  sceneAgentStyle,
  sceneHotspots,
  syncAfterPersonaChanged
} = useHallScene({
  mapAgents,
  normalizeStatus,
  selectedAgent,
  selectedTask,
  simulationEnabled
})

const selectTask = async (task) => {
  selectedTask.value = task
  if (task) {
    await loadTaskRecommendations(task)
    markRecommendedAgents(recommendedAgents.value)
  }
  playTap()
}

const selectAgent = (agent) => {
  if (selectedAgent.value?.agentId && selectedAgent.value.agentId === agent?.agentId) {
    taskWorkspaceBinding.clearExplicitActor()
    taskWorkspaceBinding.selectExplicitActor(null)
    playTap()
    return null
  }
  taskWorkspaceBinding.selectExplicitActor(agent)
  playAgentSelect()
  return agent || null
}

const cancelPanelChatLoad = () => {
  if (panelChatLoadTimer !== null) window.clearTimeout(panelChatLoadTimer)
  panelChatLoadTimer = null
}

const captureWorkbenchReturnTarget = panel => {
  // Menus unmount on navigation, so prefer a persistent visible root tab.
  const root = hallRootRef.value
  const tab = [...(root?.querySelectorAll?.(`[data-workbench-tab="${panel}"]`) || [])]
    .find(isSafePanelFocusTarget)
  const headerMessage = panel === 'messages'
    ? root?.querySelector?.('.hall-header-tools [aria-label="查看消息"]') : null
  const menu = root?.querySelector?.('.workbench-mobile-more')
  const origin = tab || (isSafePanelFocusTarget(headerMessage) && headerMessage)
    || (isSafePanelFocusTarget(menu) && menu) || document.activeElement
  panelSessionOrigin = Object.freeze({
    ...capturePanelReturnTarget(origin, panel), captureGeneration: panelSessionGeneration.value
  })
}

const openPanel = (panel, options = {}) => {
  if (panelDisposed || voiceInteractionLocked.value || !panelWhitelist.has(panel)) return false
  if (panel !== activePanel.value && guardPanelLeave(() => openPanel(panel, options))) return false
  const openingFromClosed = !activePanel.value
  const existingIndex = panelFrames.value.indexOf(panel)
  if (!options.root && !openingFromClosed && panel !== activePanel.value && existingIndex < 0 && panelDepth.value >= 3) {
    showToast('请先返回上一层，再打开新的办理入口')
    return false
  }
  if (!openingFromClosed && panel !== activePanel.value && !options.root) {
    panelLocations.set(activePanel.value, { focus: document.activeElement, scrollTop: panelRef.value?.scrollTop || 0 })
  }
  if (options.root) {
    formalTaskRef.value = null
    panelLocations.clear()
    if (!openingFromClosed && isOverviewHome.value) captureWorkbenchReturnTarget(panel)
  }
  panelFrames.value = openingFromClosed || options.root ? [panel]
    : existingIndex >= 0 ? panelFrames.value.slice(0, existingIndex + 1) : [...panelFrames.value, panel]
  panelReturnPanel.value = panelFrames.value.at(-2) || ''
  if (openingFromClosed) {
    formalTaskRef.value = null
    panelReturnPanel.value = ''
    if (!renderedPanel.value) {
      panelSessionOrigin = Object.freeze({
        ...capturePanelReturnTarget(options.returnFocusTarget || document.activeElement, panel),
        captureGeneration: panelSessionGeneration.value + 1
      })
    }
    panelSessionGeneration.value += 1
    panelClosingGeneration.value = 0
  }
  if (panel !== 'chat') {
    cancelPanelChatLoad()
  }
  if (panel === 'chat' && options.mode === 'public') {
    resetToPublic({ clearSelection: true })
  }
  renderedPanel.value = panel
  activePanel.value = panel
  if (!options.restore) void loadPanelData(panel)
  if (panel === 'tasks') void ensureEconomyPreviewCapability()
  const generation = panelSessionGeneration.value
  nextTick(() => {
    if (!panelDisposed && activePanel.value === panel && panelSessionGeneration.value === generation) {
      const location = options.restore ? panelLocations.get(panel) : null
      if (location && panelRef.value) panelRef.value.scrollTop = location.scrollTop
      if (location && isSafePanelFocusTarget(location.focus)) restorePanelFocus(location.focus)
      else focusHallPanel(panelRef.value)
    }
  })
  if (!options.silent) playPanelOpen()
  if (panel === 'chat' && !options.restore) {
    cancelPanelChatLoad()
    panelChatLoadTimer = window.setTimeout(() => {
      panelChatLoadTimer = null
      if (!panelDisposed && activePanel.value === 'chat' && panelSessionGeneration.value === generation) loadHallMessages()
    }, 0)
  }
  return true
}

const openWorkbenchMap = () => {
  workbenchMenuOpen.value = false
  if (activePanel.value && guardPanelLeave(openWorkbenchMap)) return false
  if (activePanel.value && !closePanel()) return false
  setHomeMode('map')
  return true
}

const openWorkbenchPage = (panel, event) => {
  // iOS tap/click may not focus a button: use the event target, not just activeElement.
  const openedFromMenu = workbenchMenuOpen.value && (
    event?.currentTarget?.closest?.('.workbench-more-menu') || document.activeElement?.closest?.('.workbench-more-menu')
  )
  const menuTrigger = openedFromMenu ? hallRootRef.value?.querySelector?.('.workbench-mobile-more') : null
  workbenchMenuOpen.value = false
  if (panel === 'overview') {
    if (activePanel.value) {
      if (guardPanelLeave(() => openWorkbenchPage('overview'))) return false
      captureWorkbenchReturnTarget('overview')
      if (!closePanel()) return false
    }
    setHomeMode('overview')
    return true
  }
  if (!workbenchPrimaryPanelSet.has(panel) || voiceInteractionLocked.value) return false
  if (activePanel.value === panel && renderedPanel.value === panel) return true
  setHomeMode('overview')
  return openPanel(panel, { root: true, ...(panel === 'chat' ? { mode: 'public' } : {}),
    ...(isSafePanelFocusTarget(menuTrigger) ? { returnFocusTarget: menuTrigger } : {}) })
}

const handleStagePanelOpen = (panel) => {
  if (panel === 'chat') {
    openPanel('chat', { mode: 'public', resetContext: true })
    return
  }
  openPanel(panel)
}

const conversationEntryLabel = computed(() => {
  const agent = selectedAgent.value
  return agent ? `与${portraitShortName(agent)}密议` : '先聊一聊'
})

const startContextConversation = () => {
  if (selectedAgent.value) return handleStartAgentConversation(selectedAgent.value)
  handleStagePanelOpen('chat')
  return true
}

const hasExactLandscapeId = value => typeof value === 'string' && value.length > 0

const setLandscapeEntryTarget = target => {
  const nextGeneration = ++landscapeEntryTargetGeneration
  if (target === null) {
    landscapeEntryTarget.value = null
    return nextGeneration
  }
  const isAgent = target?.kind === 'agent' && hasExactLandscapeId(target.agentId)
  const isHotspot = target?.kind === 'hotspot' && hasExactLandscapeId(target.hotspotId)
  const isTask = target?.kind === 'task' && hasExactLandscapeId(target.taskId) && hasExactLandscapeId(target.agentId)
  landscapeEntryTarget.value = (isAgent || isHotspot || isTask)
    ? { generation: nextGeneration, target: { ...target } }
    : null
  return nextGeneration
}

const handleMapSnapshot = snapshot => {
  mapResumeSnapshot.value = snapshot?.cameraSnapshot ? { ...snapshot } : null
}

const clearMapResumeSnapshot = mapGeneration => {
  if (mapResumeSnapshot.value?.mapGeneration === mapGeneration) mapResumeSnapshot.value = null
}

const handleLandscapeTargetConsumed = generation => {
  if (landscapeEntryTarget.value?.generation === generation) setLandscapeEntryTarget(null)
}

const portraitHotspotTargets = Object.freeze({
  agents: 'agentRoster',
  tasks: 'bountyBoard',
  discussion: 'mainSeat',
  catalog: 'personaCatalog',
  library: 'libraryShelf'
})

const stagePortraitHotspotTarget = action => {
  const hotspotId = portraitHotspotTargets[action]
  if (!hasExactLandscapeId(hotspotId) || !sceneHotspots.value.some(hotspot => hotspot?.id === hotspotId)) {
    setLandscapeEntryTarget(null)
    return false
  }
  setLandscapeEntryTarget({ kind: 'hotspot', hotspotId })
  return true
}

const handlePortraitAgentSelect = agent => {
  if (voiceInteractionLocked.value) return false
  const selected = selectAgent(agent)
  if (!selected) {
    setLandscapeEntryTarget(null)
    return true
  }
  if (hasExactLandscapeId(selected.agentId) && mapAgents.value.some(item => item?.agentId === selected.agentId)) {
    setLandscapeEntryTarget({ kind: 'agent', agentId: selected.agentId })
    return true
  }
  setLandscapeEntryTarget(null)
  return false
}

const requestPortraitLandscape = () => {
  if (voiceInteractionLocked.value) return false
  const selected = selectedAgent.value
  const task = selectedTask.value
  const assignedIds = Array.isArray(task?.assignedAgentIds) ? task.assignedAgentIds : []
  const assigneeIds = Array.isArray(task?.assignees) ? task.assignees.map(item => item?.agentId) : []
  if (hasExactLandscapeId(task?.id) && hasExactLandscapeId(selected?.agentId) &&
    (assignedIds.includes(selected.agentId) || assigneeIds.includes(selected.agentId)) &&
    mapAgents.value.some(agent => agent?.agentId === selected.agentId)) {
    setLandscapeEntryTarget({ kind: 'task', taskId: task.id, agentId: selected.agentId })
  } else if (hasExactLandscapeId(selected?.agentId) && mapAgents.value.some(agent => agent?.agentId === selected.agentId)) {
    setLandscapeEntryTarget({ kind: 'agent', agentId: selected.agentId })
  } else if (!landscapeEntryTarget.value) {
    setLandscapeEntryTarget(null)
  }
  return requestLandscape()
}

const handlePortraitQuickAction = (action) => {
  if (voiceInteractionLocked.value) return false
  if (action !== 'treasure') stagePortraitHotspotTarget(action)
  if (action === 'treasure') {
    openBabaoBox()
    return
  }
  if (action === 'onboarding') {
    emit('open-onboarding')
    return
  }
  if (action === 'discussion') {
    startContextConversation()
    return
  }
  if (['agents', 'tasks', 'catalog', 'library', 'treasure', 'messages'].includes(action)) openPanel(action)
}

const closePortraitTaskDetail = () => {
  if (voiceInteractionLocked.value) return false
  portraitTaskDetailOpen.value = false
  return true
}

const handlePortraitTaskOpen = task => {
  if (voiceInteractionLocked.value || !task?.id) return false
  const selection = selectTask(task)
  const selected = selectedAgent.value
  const assignedIds = Array.isArray(task.assignedAgentIds) ? task.assignedAgentIds : []
  const assigneeIds = Array.isArray(task.assignees) ? task.assignees.map(item => item?.agentId) : []
  if (hasExactLandscapeId(selected?.agentId) && (assignedIds.includes(selected.agentId) || assigneeIds.includes(selected.agentId)) && mapAgents.value.some(agent => agent?.agentId === selected.agentId)) {
    setLandscapeEntryTarget({ kind: 'task', taskId: task.id, agentId: selected.agentId })
  } else {
    setLandscapeEntryTarget(null)
  }
  portraitTaskDetailOpen.value = true
  return selection
}

const handlePortraitTaskBoard = () => {
  if (voiceInteractionLocked.value) return false
  closePortraitTaskDetail()
  openPanel('tasks')
}

const handlePortraitTaskDiscussion = task => {
  if (voiceInteractionLocked.value || !task?.id) return false
  closePortraitTaskDetail()
  discussTask(task)
  return true
}

watch(experienceMode, mode => {
  if (mode !== 'portrait-command') closePortraitTaskDetail()
})

const openBabaoBox = () => {
  if (voiceInteractionLocked.value) return false
  return openPanel('treasure')
}

const openOverviewItem = ref => {
  if (guardPanelLeave(() => openOverviewItem(ref))) return false
  if (!ref || !['DRAFT', 'PRIVATE_CASE', 'LEGACY_EXECUTION'].includes(ref.sourceType)) return false
  if (!openPanel('item', { restore: true })) return false
  overviewItemRef.value = { ...ref }
  return true
}

const openOverviewTask = async (task, review = null) => {
  if (guardPanelLeave(() => openOverviewTask(task, review))) return false
  if (!task?.id || !openPanel('tasks', { restore: true })) return false
  taskReviewRef.value = review ? { ...review, taskId: task.id } : null
  selectedTask.value = task
  await nextTick()
  bountyPanelRef.value?.openTask(task)
  formalTaskRef.value = review ? task : null
  return true
}

const openPrivateDraft = (context = {}) => {
  if (guardPanelLeave(() => openPrivateDraft(context))) return false
  if (!openPanel('draft', { restore: true })) return false
  const agent = operableRosterAgents.value.find(agent => agent.agentId === selectedAgent.value?.agentId)
  draftContext.value = { ...context, targetAgentId: context.targetAgentId || agent?.agentId || '' }
  privateDraftGeneration.value += 1
  return true
}
const openFormalResults = task => {
  if (!task?.id) return false
  formalTaskRef.value = task
  taskReviewRef.value = null
  return true
}
const openTaskWorkspace = () => {
  if (!taskWorkspaceEnabled || !taskWorkspaceSubject.value?.taskId || !taskWorkspaceSubject.value?.actorAgentId) return
  openPanel('workspace')
}

const requestPanelOrientation = () => {
  if (voiceInteractionLocked.value) return false
  if (orientationRequestPending.value) return requestPortrait()
  return experienceMode.value === 'landscape-map' ? requestPortrait() : requestLandscape()
}

const returnPanel = () => {
  if (panelDisposed || voiceInteractionLocked.value) return false
  // Back inside a draft/selection/preview is navigation, not leaving the draft.
  if (activeDraftEditor()?.canGoBack) return activeDraftEditor().goBack()
  if (guardPanelLeave(() => returnPanel() || closePanel())) return true
  if (renderedPanel.value === 'tasks' && formalTaskRef.value) { formalTaskRef.value = null; return true }
  if (panelChildCanReturn.value) {
    const child = renderedPanel.value === 'tasks' ? bountyPanelRef.value
      : renderedPanel.value === 'treasure' ? treasurePanelRef.value : libraryPanelRef.value
    return child.back()
  }
  if (!panelReturnPanel.value) return false
  return openPanel(panelReturnPanel.value, { silent: true, restore: true })
}

const closePanel = () => {
  if (panelDisposed || voiceInteractionLocked.value || !activePanel.value) return false
  if (guardPanelLeave(closePanel)) return false
  cancelPanelChatLoad()
  panelClosingGeneration.value = panelSessionGeneration.value
  activePanel.value = ''
  playTap()
  return true
}

const handlePanelKeydown = (event) => {
  event.stopPropagation()
  if (event.key === 'Escape' && !event.isComposing && event.keyCode !== 229) {
    event.preventDefault()
    if (!returnPanel()) closePanel()
    return
  }
  if (!(isOverviewHome.value && workbenchPrimaryPanelSet.has(renderedPanel.value))) {
    trapPanelFocus(event, panelRef.value)
  }
}

const handlePanelAfterLeave = async (element) => {
  const leavingGeneration = Number(element?.dataset?.panelGeneration)
  if (!isCurrentPanelGeneration({
    leavingGeneration,
    closingGeneration: panelClosingGeneration.value,
    sessionGeneration: panelSessionGeneration.value,
    activePanel: activePanel.value,
    disposed: panelDisposed
  })) return
  cancelPanelChatLoad()
  renderedPanel.value = ''
  panelFrames.value = []
  panelLocations.clear()
  await nextTick()
  if (!isCurrentPanelGeneration({
    leavingGeneration,
    closingGeneration: panelClosingGeneration.value,
    sessionGeneration: panelSessionGeneration.value,
    activePanel: activePanel.value,
    disposed: panelDisposed
  }) || renderedPanel.value) return
  const returnTarget = resolvePanelReturnTarget({ origin: panelSessionOrigin, root: hallRootRef.value })
  restorePanelFocus(returnTarget)
  panelClosingGeneration.value = 0
  panelReturnPanel.value = ''
  panelSessionOrigin = null
}

watch([() => apiStore.authorizationGeneration, hallIdentityScope], () => {
  cancelPanelChatLoad()
  panelSessionGeneration.value += 1
  panelClosingGeneration.value = 0
  activePanel.value = ''
  renderedPanel.value = ''
  panelFrames.value = []
  panelReturnPanel.value = ''
  panelLocations.clear()
  cancelPanelLeave()
  draftContext.value = null
  formalTaskRef.value = null
  overviewItemRef.value = null
  taskReviewRef.value = null
  panelSessionOrigin = null
  resetToPublic({ clearSelection: true })
}, { flush: 'sync' })

const closeSelectedAgentCard = () => {
  selectedAgent.value = null
  playTap()
}

const briefSelectedTask = (task = selectedTask.value, agent = selectedAgent.value) => {
  if (!task || (agent && !canStartAgentConversation(agent))) return false
  if (!openPanel('chat')) return false
  selectedTask.value = task
  if (agent) {
    enterPrivateConversation(agent, { task })
  } else {
    enterBountyDiscussion(task)
  }
  const abilities = (task.requiredAbilities || []).join(' / ') || '不拘本领'
  const target = agent ? `可请 ${portraitShortName(agent)} / ${agent.name || agent.personaName || agent.agentId} 领令。` : '请点一位合适好汉领令。'
  if (!draft.value.trim()) setDraft(`请就榜文「${task.title}」议事：榜号 ${task.id}，眼下 ${taskStatusText(task.status)}，所需本领 ${abilities}。${target}请说明险处与下一步章程。`)
  showToast('议事话头已备')
}

const discussTask = (task) => {
  if (!task || !openPanel('chat')) return false
  enterBountyDiscussion(task)
  markDiscussionStarted(task, chatContext.value?.participantAgentIds || [])
  if (!draft.value.trim()) setDraft(`请就榜文「${task.title}」议事。`)
}

const toggleHallSound = () => {
  const nextEnabled = !soundEnabled.value
  setSoundEnabled(nextEnabled)
  if (nextEnabled) {
    playTap()
    showToast('厅中声响已开')
    return
  }
  showToast('厅中声响已歇')
}

const showToast = (message) => {
  toast.value = message
  setTimeout(() => {
    if (toast.value === message) toast.value = ''
  }, 2200)
}

const fundedQuotePreview = ref(null)
let fundedQuoteResolver = null
const settleFundedQuote = (confirmed) => {
  const resolve = fundedQuoteResolver
  fundedQuoteResolver = null
  fundedQuotePreview.value = null
  resolve?.(confirmed === true)
}
const confirmFundedQuote = preview => new Promise(resolve => {
  if (!economyPreviewEnabled.value || panelDisposed || renderedPanel.value !== 'tasks' || selectedTask.value?.id !== preview.quote.taskId) {
    resolve(false)
    return
  }
  settleFundedQuote(false)
  fundedQuotePreview.value = preview
  fundedQuoteResolver = resolve
})
// Closing/switching the task panel or changing a displayed selection cancels
// only the preview. No hidden selection is ever used as the claim target.
watch([() => selectedTask.value?.id, () => selectedTask.value?.taskVersion ?? selectedTask.value?.version,
  () => selectedAgent.value?.agentId, () => renderedPanel.value, () => economyPreviewEnabled.value], () => settleFundedQuote(false), { flush: 'sync' })
onUnmounted(() => settleFundedQuote(false))

const {
  fundedClaimState,
  fundedCreateRecovery,
  refreshFundedClaim,
  resumeFundedCreate: runResumeFundedCreate,
  archiveTask: runArchiveTask,
  autoAssignTask: runAutoAssignTask,
  assignTask: runAssignTask,
  cancelFunding: runCancelFunding,
  createTask: runCreateTask,
  loadSettlement: runLoadSettlement
} = useHallTaskActions({
  agentApi,
  confirmFundedQuote,
  fundedActorScopeKey: computed(() => economyPreviewCapability.value?.principalScopeFingerprint || ''),
  resolveFundedAgent: agent => agents.value.find(item => item.agentId === agent.agentId),
  canAssign,
  log,
  playError,
  playSuccess,
  selectedAgent,
  selectedTask,
  showToast,
  tasks
})

const createTask = async (payload, acknowledge = () => {}) => {
  const created = await runCreateTask(payload)
  if (created) markTaskCreated(selectedTask.value)
  acknowledge(created)
  return created
}
const resumeFundedCreate = async () => {
  const created = await runResumeFundedCreate()
  if (created) markTaskCreated(selectedTask.value)
  return created
}

const assignTask = async (task, agent) => {
  const targetAgents = Array.isArray(agent) ? agent : [agent].filter(Boolean)
  const hasExplicitAgentId = item => typeof item?.agentId === 'string' && Boolean(item.agentId.trim())
  if (!task?.id || !targetAgents.length || targetAgents.some(item => !hasExplicitAgentId(item))) return false
  if (task.funding?.mode === 'FUNDED_SINGLE_AGENT' && !economyPreviewEnabled.value) return false
  if (task.funding?.mode !== 'FUNDED_SINGLE_AGENT') {
    if (targetAgents.some(item => !canAssign(task, item))) return false
  }

  taskWorkspaceBinding.clearExplicitActor()
  const assignmentSucceeded = await runAssignTask(task, agent)
  if (!assignmentSucceeded) return false

  const canonicalTask = tasks.value.find(item => item.id === task.id) || task
  if (task.funding?.mode !== 'FUNDED_SINGLE_AGENT' ||
    (canonicalTask.status === 'assigned' && canonicalTask.assignedAgentId === targetAgents[0].agentId)) markTaskAssigned(canonicalTask, targetAgents)
  return true
}

const autoAssignTask = async (task) => {
  if (task?.funding?.mode === 'FUNDED_SINGLE_AGENT') return false
  await runAutoAssignTask(task)
  const currentTask = selectedTask.value || task
  const assignedIds = currentTask?.assignedAgentIds || (currentTask?.assignedAgentId ? [currentTask.assignedAgentId] : [])
  const assignedAgents = assignedIds
    .map(agentId => mapAgents.value.find(agent => agent.agentId === agentId) || agents.value.find(agent => agent.agentId === agentId) || agentId)
    .filter(Boolean)
  markTaskAutoAssigned(currentTask, assignedAgents)
}

const archiveTask = async (task) => {
  await runArchiveTask(task)
  if (selectedTask.value?.status === 'archived') {
    markTaskArchived(selectedTask.value)
  }
}

const cancelFunding = async (task) => {
  const cancelled = await runCancelFunding(task)
  if (cancelled) await loadTasks()
  return cancelled
}

const loadSettlement = async (task) => runLoadSettlement(task)

const {
  cancelHallReplyTurn,
  chatConnectionStatus,
  conversationHistory,
  conversationHistoryDeletingId,
  conversationHistoryError,
  conversationHistoryHasMore,
  conversationHistoryLoading,
  conversationId,
  conversationLoadError,
  draft,
  deleteHallConversation,
  eventStreamRecovering,
  insertAgentMention,
  isAwaitingReply,
  isConversationBusy,
  isStreaming,
  loadHallConversationHistory,
  loadHallMessages,
  loadMoreHallConversationHistory,
  mentionAgent,
  messages,
  newHallConversation,
  pendingAgentName,
  replyEventSequence,
  retryHallConversation,
  sendHallMessage,
  senderText,
  selectHallConversation,
  disposeHallConversation,
  draftRevision,
  setDraft,
  stopHallEventStream,
  stopHallReplyPolling,
  stopHallReplyStreaming
} = useHallConversation({
  apiStore,
  chatContext,
  chatMode,
  chatApi,
  globalStore,
  log,
  openPanel,
  outgoingMetadata,
  portraitShortName,
  selectedAgent,
  selectedTask,
  showToast,
  onFinalReply: payload => {
    voiceReplyCorrelation.observe(payload)
  }
})

const formalTaskExecutionContext = useFormalTaskExecutionScope({
  selectedTask,
  chatContext,
  conversationId,
  identityScope: hallIdentityScope,
  taskWorkspaceEnabled,
  taskWorkspaceSubject,
  taskWorkspaceSnapshot,
  taskWorkspaceConnectionState,
  taskWorkspaceError
})

hallVoice = useHallVoiceConversation({
  apiStore,
  chatApi,
  enabled: voiceFeatureEnabled,
  getContext: () => {
    const current = chatContext.value || {}
    return {
      conversationId: conversationId.value,
      conversationScopeType: current.conversationScopeType,
      conversationScopeKey: current.conversationScopeKey,
      mode: current.mode,
      targetAgentIds: current.targetAgentIds,
      targetAgentId: current.targetAgentId,
      participantAgentIds: current.participantAgentIds,
      mentionAgentIds: chatMentionAgentIds.value,
      selectedAgentId: current.selectedAgentId ?? null,
      selectedTaskId: current.selectedTaskId ?? null,
      taskId: current.taskId ?? null,
      outgoingMetadata: outgoingMetadata.value,
      targetLabel: chatTargetText.value
    }
  },
  getDraft: () => draft.value,
  getDraftRevision: () => draftRevision.value,
  isReplyBusy: () => isStreaming.value || isAwaitingReply.value,
  onCaptureStateChange: capturing => setSoundSuppressed?.(capturing),
  onReplyTurnTerminal: ({ reason, turnId }) => {
    const closedCurrentTurn = voiceReplyCorrelation.closeIfCurrent(turnId, reason)
    if (closedCurrentTurn && reason === 'reply_timeout') cancelHallReplyTurn(reason)
  },
  onOpenReview: () => { if (!activePanel.value) openPanel('chat') },
  onSendVoice: async ({ content, contextSnapshot, draftRevision: frozenDraftRevision, turnId }) => {
    if (isStreaming.value || isAwaitingReply.value) return false
    const correlationTurnId = voiceReplyCorrelation.start({
      turnId,
      baselineSequence: replyEventSequence.value,
      messages: messages.value,
      conversationIdBeforeSend: contextSnapshot.conversationId
    })
    if (correlationTurnId !== turnId) return false
    playSend()
    try {
      const accepted = await sendHallMessage({
        content,
        contextSnapshot,
        source: 'voice',
        clearDraftRevision: frozenDraftRevision,
        onConversationResolved: id => voiceReplyCorrelation.resolveConversation(id, correlationTurnId)
      })
      if (!accepted) voiceReplyCorrelation.closeIfCurrent(correlationTurnId, 'send_failed')
      else if (conversationId.value) voiceReplyCorrelation.resolveConversation(conversationId.value, correlationTurnId)
      return accepted
    } catch (cause) {
      voiceReplyCorrelation.closeIfCurrent(correlationTurnId, 'send_exception')
      throw cause
    }
  },
  showToast
})
const voiceInteractionLocked = computed(() => hallVoice.voiceInteractionLocked)
const accountEntryDisabled = computed(() => isPanelSessionActive.value || voiceInteractionLocked.value)
const hallLeaveHasMeaningfulWork = computed(() => hasMeaningfulHallLeaveWork({
  draft: draft.value,
  isAwaitingReply: isAwaitingReply.value,
  isStreaming: isStreaming.value,
  voiceInteractionLocked: voiceInteractionLocked.value,
  voiceTurnActive: Boolean(hallVoice?.voiceTurnActive)
}))
const confirmLeavingHall = () => confirmHallLeave({ hasMeaningfulWork: hallLeaveHasMeaningfulWork.value })
let approvedHallLeave = false
let profileNavigationPending = false
const openProfile = async () => {
  if (profileNavigationPending || !confirmLeavingHall()) return false
  profileNavigationPending = true
  approvedHallLeave = true
  try {
    await router.push({ name: 'UserProfile' })
    return true
  } finally {
    approvedHallLeave = false
    profileNavigationPending = false
  }
}
onBeforeRouteLeave(() => {
  const editor = activeDraftEditor()
  if (!editor) return approvedHallLeave || confirmLeavingHall()
  const generation = panelSessionGeneration.value
  return editor.saveBeforeLeave().then(saved => Boolean(saved && generation === panelSessionGeneration.value &&
    (approvedHallLeave || confirmLeavingHall())))
})

const applyVoiceTranscript = mode => {
  const next = hallVoice.applyTranscript(mode)
  if (typeof next === 'string') { setDraft(next); hallVoice.discard() }
}
const handleSceneModeChange = mode => {
  if (voiceInteractionLocked.value) return false
  effectiveSceneMode.value = mode === 'landscape' ? 'landscape' : 'portrait'
  return true
}

const {
  citeLibraryItem: runCiteLibraryItem,
  libraryErrorMessage,
  libraryHasSearched,
  libraryKeyword,
  libraryLoading,
  libraryResults,
  librarySourceType,
  searchLibrary: runSearchLibrary
} = useHallLibrary({
  chatApi,
  draft,
  log,
  openPanel,
  outgoingMetadata,
  setDraft,
  playSuccess,
  showToast
})

const searchLibrary = async () => {
  markLibrarySearching('searching')
  await runSearchLibrary()
  markLibrarySearching(libraryErrorMessage.value ? 'error' : 'success')
}

const citeLibraryItem = (item) => {
  runCiteLibraryItem(item)
  markLibraryCitation(item)
}

const startDialogueBubbles = () => {
  stopDialogueBubbles()
  bubbleTimer = window.setInterval(showRandomAgentBubble, 5200)
  bubbleInitialTimer = window.setTimeout(showRandomAgentBubble, 1800)
}

const stopDialogueBubbles = () => {
  if (bubbleTimer) window.clearInterval(bubbleTimer)
  if (bubbleInitialTimer) window.clearTimeout(bubbleInitialTimer)
  if (bubbleClearTimer) window.clearTimeout(bubbleClearTimer)
  bubbleTimer = null
  bubbleInitialTimer = null
  bubbleClearTimer = null
}

const showRandomAgentBubble = () => {
  const pool = visibleAgents.value
  if (!pool.length || activePanel.value) return
  const agent = pool[Math.floor(Math.random() * pool.length)]
  const role = portraitRole(agent)
  const lines = roleDialogues[role.slug] || roleDialogues.default
  const text = lines[Math.floor(Math.random() * lines.length)]
  const key = agentKey(agent)
  agentBubbles.value = { [key]: text }
  markAgentSpeaking(agent, text, 'speech')
  if (bubbleClearTimer) window.clearTimeout(bubbleClearTimer)
  bubbleClearTimer = window.setTimeout(() => {
    agentBubbles.value = {}
  }, 3600)
}


const handleNewHallConversation = () => {
  if (isConversationBusy.value) return false
  voiceReplyCorrelation.close('new_conversation')
  hallVoice?.cancel()
  playPanelOpen()
  newHallConversation()
  resetSceneFeedback()
  return true
}

const handleSendHallMessage = async () => {
  voiceReplyCorrelation.close('manual_text_send')
  hallVoice?.cancel()
  playSend()
  const currentContext = chatContext.value || {}
  const targets = currentContext.targetAgentIds?.length ? currentContext.targetAgentIds : currentContext.participantAgentIds
  targets?.slice(0, 3).forEach(agentId => markAgentSpeaking(agentId, '收到传令', 'system'))
  await sendHallMessage()
}

const handleMentionAgent = (agent) => {
  if (!chatMentionAgents.value.some(item => item.agentId === agent?.agentId)) {
    showToast('只可点名自家好汉')
    return
  }
  playTap()
  setMentionAgent(agent)
  mentionAgent(agent)
  markAgentSpeaking(agent, '收到传令', 'system')
}

const handleClearChatTarget = () => {
  playTap()
  setMentionAgent(null)
  if (chatMode.value === 'public') {
    selectedAgent.value = null
  }
}

const exactAgentId = value => (
  typeof value === 'string' && value.length > 0 && value.trim() === value
    ? value
    : ''
)

const resolvePermittedConversationAgent = candidate => {
  const agentId = exactAgentId(candidate?.agentId)
  if (!agentId) return null
  return operableRosterAgents.value.find(agent => (
    agent?.agentId === agentId &&
    agent.boundToMe === true &&
    agent.canOperate === true &&
    !agent.systemAgent
  )) || null
}

const handleStartAgentConversation = (candidate) => {
  const agent = resolvePermittedConversationAgent(candidate)
  if (!agent) {
    showToast('只可与自家好汉密议')
    return false
  }
  if (!openPanel('chat')) return false
  taskWorkspaceBinding.selectExplicitActor(agent)
  playAgentSelect()
  enterPrivateConversation(agent)
  markAgentSpeaking(agent, '入席密议', 'system')
  if (!draft.value.trim()) insertAgentMention(agent, '请报眼下动静、可领何榜、还需哪路照应。')
  showToast(`正与 ${portraitShortName(agent)} 密议`)
  return true
}

const canStartAgentConversation = agent => Boolean(resolvePermittedConversationAgent(agent))

const handleBindPersona = async (persona, mode = 'local') => {
  if (mode !== 'local') {
    showToast('山寨安顿请先打开服务端租约报价，不会直接免费开通。')
    return false
  }
  try {
    personaSetupResult.value = await bindPersona(persona, mode)
    syncAfterPersonaChanged()
    playSuccess()
    showToast(`${portraitShortName(persona)} 自家接应文书已备`)
  } catch (error) {
    log.warn('bind persona failed:', error)
    playError()
    showToast(error.message || '请贤未成')
  }
}

const handleUnbindPersona = async (persona) => {
  try {
    const unbound = await unbindPersona(persona)
    if (!unbound) {
      showToast('该好汉未在当前名册中，未执行除名')
      return false
    }
    if (selectedAgent.value?.personaCode === persona.personaCode) selectedAgent.value = null
    if (personaSetupResult.value?.agent?.personaCode === persona.personaCode) personaSetupResult.value = null
    syncAfterPersonaChanged()
    playSuccess()
    showToast(`${portraitShortName(persona)} 已除名下山`)
  } catch (error) {
    log.warn('unbind persona failed:', error)
    playError()
    showToast(error.message || '除名未成')
  }
}

onMounted(async () => {
  globalStore.setTitle('聚义厅')
  globalStore.setShowBack(false)
  globalStore.setShowAppBar(false)
  globalStore.setShowMore(false)
  await nextTick()
  experienceReady.value = true
  document.addEventListener?.('visibilitychange', handleDocumentVisibility)
  handleDocumentVisibility()
  // token() initiates the one OAuth redirect when identity is absent. Do not mount
  // the live hall workflow while that redirect is pending: its protected loaders
  // would otherwise race the redirect and turn authentication into a fetch error.
  if (!await apiStore.token()) return
  // A valid restored bearer token can survive while the in-memory profile was
  // cleared. Hydrate it before identity-scoped drafts/capabilities are opened.
  if (!String(globalStore.getUserId || globalStore.getOpenid || '').trim()) {
    try { await apiStore.getUserInfo() } catch (error) { log.warn('hall identity hydration failed:', error) }
  }
  permitStageMount()
  await refreshHall({ silent: true })
  startDialogueBubbles()
})

onUnmounted(() => {
  document.removeEventListener?.('visibilitychange', handleDocumentVisibility)
  panelDisposed = true
  panelSessionGeneration.value += 1
  panelClosingGeneration.value = 0
  panelReturnPanel.value = ''
  cancelPanelChatLoad()
  const originalElement = panelSessionOrigin?.originalElement
  if (isSafePanelFocusTarget(originalElement) && !hallRootRef.value?.contains(originalElement)) restorePanelFocus(originalElement)
  panelSessionOrigin = null
  activePanel.value = ''
  renderedPanel.value = ''
  taskWorkspaceBinding.dispose()
  voiceReplyCorrelation.close('unmount')
  hallVoice?.dispose()
  disposeHallConversation()
  hallBackendSceneState?.dispose()
  stopHallEventStream()
  stopHallReplyStreaming()
  stopHallReplyPolling()
  stopDialogueBubbles()
  resetSimulationLifecycle()
  hallSceneDebugBridge.stop()
  globalStore.setShowAppBar(true)
})
</script>

<style scoped>
.juyi-page {
  --bottom-action-bar-height: 68px;
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  padding: 0;
  overflow: hidden;
  background: #211812;
  color: #2f261c;
}

.hall-live-landscape-target {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.hall-live-landscape-target :deep(.hall-stage),
:deep(.portrait-live-preview-target > .hall-stage) {
  width: 100%;
  height: 100%;
  min-height: 0;
}

.hall-stage {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  background: #211812;
}

.stage-header {
  position: absolute;
  top: 18px;
  left: 18px;
  right: 18px;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid rgba(255, 240, 202, 0.22);
  border-radius: 8px;
  background: rgba(35, 24, 16, 0.72);
  color: #fff4d4;
  backdrop-filter: blur(8px);
}

.eyebrow {
  font-size: 12px;
  color: #d7b875;
}

h1 {
  margin: 2px 0 0;
  font-size: 28px;
  line-height: 1.1;
  letter-spacing: 0;
}

.stage-actions,
.quick-bar {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

button {
  border: 0;
  cursor: pointer;
  font: inherit;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.icon-action,
.quick-action,
.panel-title button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 36px;
  border-radius: 8px;
  background: #6d3f1f;
  color: #fff8e8;
}

.icon-action {
  width: 38px;
  background: rgba(255, 244, 212, 0.16);
  color: #fff4d4;
}

.hall-board {
  position: relative;
  flex: 1;
  min-height: 0;
  margin: 0;
  overflow: hidden;
  border-radius: 0;
  cursor: grab;
  touch-action: none;
  background:
    radial-gradient(circle at 50% 48%, rgba(255, 238, 180, 0.16), transparent 32%),
    linear-gradient(135deg, #17231d, #1b271f 50%, #0e1411);
}

.hall-board.is-dragging {
  cursor: grabbing;
}

.hall-board::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 4;
  pointer-events: none;
  box-shadow: inset 0 0 90px rgba(0, 0, 0, 0.58);
}

.map-world {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 162%;
  height: 148%;
  transform: translate3d(calc(-50% + var(--map-offset-x, 0px)), calc(-50% + var(--map-offset-y, 0px)), 0);
  transform-origin: center;
  transition: transform 0.28s ease;
  background:
    linear-gradient(90deg, rgba(99, 61, 31, 0.24) 1px, transparent 1px) 0 0 / 72px 72px,
    linear-gradient(0deg, rgba(99, 61, 31, 0.22) 1px, transparent 1px) 0 0 / 72px 72px,
    repeating-linear-gradient(90deg, rgba(169, 114, 58, 0.12) 0 18px, rgba(89, 54, 28, 0.12) 18px 36px),
    radial-gradient(ellipse at 52% 54%, rgba(229, 177, 92, 0.34), transparent 28%),
    linear-gradient(145deg, #8a6032 0%, #5b3923 38%, #6f4a2a 68%, #3a291f 100%);
  will-change: transform;
}

.map-world::before,
.map-world::after {
  content: '';
  position: absolute;
  pointer-events: none;
}

.map-world::before {
  inset: 8% 10%;
  border: 8px solid rgba(64, 35, 18, 0.62);
  border-radius: 8px;
  background:
    linear-gradient(90deg, rgba(64, 35, 18, 0.46) 2px, transparent 2px) 0 0 / 25% 100%,
    linear-gradient(0deg, rgba(64, 35, 18, 0.44) 2px, transparent 2px) 0 0 / 100% 34%,
    rgba(255, 238, 194, 0.08);
}

.map-world::after {
  left: 15%;
  right: 15%;
  top: 46%;
  height: 18px;
  border-radius: 999px;
  background: rgba(238, 190, 111, 0.48);
  box-shadow:
    0 -116px 0 rgba(238, 190, 111, 0.24),
    0 116px 0 rgba(238, 190, 111, 0.2);
}

.map-region,
.map-road {
  position: absolute;
  pointer-events: none;
}

.map-region {
  z-index: 0;
  opacity: 0.88;
}

.region-water {
  left: 13%;
  bottom: 14%;
  width: 22%;
  height: 22%;
  border-radius: 8px;
  background:
    linear-gradient(90deg, rgba(255, 239, 188, 0.18) 1px, transparent 1px) 0 0 / 18px 18px,
    linear-gradient(135deg, rgba(87, 51, 27, 0.58), rgba(48, 31, 22, 0.5));
}

.region-forest {
  right: 13%;
  top: 14%;
  width: 24%;
  height: 24%;
  border-radius: 8px;
  background:
    radial-gradient(circle at 28% 36%, rgba(244, 200, 76, 0.24), transparent 16%),
    linear-gradient(135deg, rgba(35, 72, 62, 0.64), rgba(28, 52, 44, 0.56));
}

.region-village {
  left: 13%;
  top: 14%;
  width: 24%;
  height: 24%;
  border-radius: 8px;
  background:
    repeating-linear-gradient(45deg, rgba(255, 239, 188, 0.16) 0 10px, transparent 10px 20px),
    linear-gradient(135deg, rgba(124, 31, 27, 0.46), rgba(92, 45, 99, 0.42));
}

.map-road {
  z-index: 1;
  height: 16px;
  border-radius: 999px;
  background: rgba(239, 195, 115, 0.56);
  box-shadow: 0 0 0 5px rgba(83, 55, 29, 0.1);
}

.road-main {
  left: 20%;
  top: 50%;
  width: 62%;
  transform: rotate(-13deg);
}

.road-branch {
  left: 45%;
  top: 42%;
  width: 32%;
  transform: rotate(42deg);
}

.hall-room {
  position: absolute;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-width: 0;
  min-height: 0;
  padding: 10px;
  border: 2px solid rgba(64, 35, 18, 0.68);
  border-radius: 8px;
  background:
    linear-gradient(90deg, rgba(255, 244, 212, 0.14) 1px, transparent 1px) 0 0 / 20px 20px,
    linear-gradient(145deg, rgba(255, 237, 190, 0.72), rgba(188, 132, 67, 0.64));
  color: #3c2716;
  text-align: center;
  box-shadow:
    inset 0 0 0 1px rgba(255, 250, 232, 0.22),
    0 12px 26px rgba(0, 0, 0, 0.18);
}

button.hall-room {
  cursor: pointer;
}

.hall-room:hover {
  border-color: rgba(244, 200, 76, 0.84);
  box-shadow:
    inset 0 0 0 1px rgba(255, 250, 232, 0.3),
    0 0 0 3px rgba(244, 200, 76, 0.18),
    0 14px 28px rgba(0, 0, 0, 0.2);
}

.hall-room strong,
.hall-room small {
  overflow: hidden;
  max-width: 100%;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hall-room strong {
  font-size: 16px;
  font-weight: 800;
}

.hall-room small {
  color: rgba(60, 39, 22, 0.78);
  font-size: 12px;
}

.room-main {
  left: 37%;
  top: 35%;
  width: 26%;
  height: 32%;
  background:
    radial-gradient(circle at 50% 52%, rgba(244, 200, 76, 0.28), transparent 44%),
    linear-gradient(145deg, rgba(255, 239, 188, 0.82), rgba(192, 138, 70, 0.74));
}

.room-agents {
  left: 14%;
  top: 36%;
  width: 19%;
  height: 24%;
}

.room-tasks {
  right: 14%;
  top: 36%;
  width: 19%;
  height: 24%;
}

.room-back {
  left: 40%;
  bottom: 13%;
  width: 20%;
  height: 16%;
  background:
    linear-gradient(145deg, rgba(235, 218, 184, 0.74), rgba(112, 76, 47, 0.56));
}

.beam {
  position: absolute;
  left: 0;
  right: 0;
  height: 18px;
  background: #4a2716;
}

.beam-top {
  top: 0;
}

.banner {
  position: absolute;
  top: 86px;
  left: 50%;
  width: 116px;
  padding: 10px 0;
  transform: translateX(-50%);
  border-radius: 0 0 8px 8px;
  background: #b93622;
  color: #fff1c1;
  text-align: center;
  font-weight: 700;
}

.task-sprite {
  position: absolute;
  z-index: 2;
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr);
  grid-template-rows: auto auto;
  align-items: center;
  column-gap: 7px;
  width: clamp(132px, 15vw, 176px);
  min-height: 56px;
  padding: 8px 10px;
  transform: translate(-50%, -50%) rotate(var(--sprite-tilt, -4deg));
  border: 1px solid rgba(87, 50, 24, 0.34);
  border-radius: 8px 8px 16px 8px;
  background:
    linear-gradient(90deg, rgba(123, 71, 33, 0.12) 1px, transparent 1px) 12px 0 / 18px 100%,
    linear-gradient(155deg, rgba(255, 248, 224, 0.96), rgba(225, 175, 89, 0.94));
  color: #3f2815;
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.26),
    0 12px 24px rgba(0, 0, 0, 0.23);
  animation-timing-function: cubic-bezier(0.45, 0.02, 0.3, 1);
  animation-iteration-count: infinite;
}

.task-sprite::after {
  content: "";
  position: absolute;
  right: -7px;
  bottom: -6px;
  width: 32px;
  height: 28px;
  border-radius: 58% 42% 48% 52%;
  background: rgba(129, 35, 27, 0.16);
  transform: rotate(-14deg);
}

.task-sprite-icon {
  grid-row: 1 / 3;
  display: inline-grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: #7c1f1b;
  color: #fff4d4;
}

.task-sprite-title,
.task-sprite-status {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-sprite-title {
  font-weight: 700;
  font-size: 13px;
}

.task-sprite-status {
  color: #7a5630;
  font-size: 11px;
}

.task-sprite.is-running {
  background:
    linear-gradient(90deg, rgba(35, 72, 62, 0.12) 1px, transparent 1px) 12px 0 / 18px 100%,
    linear-gradient(155deg, rgba(237, 250, 240, 0.96), rgba(139, 185, 147, 0.94));
}

.task-sprite.is-completed {
  opacity: 0.76;
}

.task-sprite.is-failed .task-sprite-icon {
  background: #b3261e;
}

.agent-name,
.agent-status {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-status {
  font-size: 12px;
}

.is-idle {
  color: #2e7d32;
}

.is-busy {
  color: #9a5b00;
}

.is-error {
  color: #b3261e;
}

.is-offline {
  color: #777;
}

.empty-hall,
.empty-list {
  color: #856d4a;
  text-align: center;
  padding: 18px;
}

.hall-overflow {
  position: absolute;
  right: 18px;
  bottom: 118px;
  z-index: 5;
  min-height: 34px;
  padding: 0 12px;
  border: 1px solid rgba(255, 244, 212, 0.2);
  border-radius: 999px;
  background: rgba(35, 24, 16, 0.72);
  color: #fff4d4;
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.18);
  backdrop-filter: blur(8px);
}

.quick-bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 8;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
  max-width: 100%;
  padding: 10px max(18px, env(safe-area-inset-right)) max(10px, env(safe-area-inset-bottom)) max(18px, env(safe-area-inset-left));
  box-sizing: border-box;
  border: 1px solid rgba(255, 240, 202, 0.18);
  border-right: 0;
  border-bottom: 0;
  border-left: 0;
  border-radius: 0;
  background: rgba(35, 24, 16, 0.72);
  backdrop-filter: blur(8px);
}

.dock-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  color: #fff4d4;
}

.dock-summary span {
  display: inline-flex;
  align-items: center;
  min-height: 38px;
  padding: 0 10px;
  border: 1px solid rgba(255, 244, 212, 0.14);
  border-radius: 8px;
  background: rgba(255, 244, 212, 0.08);
  color: #d7b875;
  white-space: nowrap;
}

.dock-summary strong {
  margin-right: 4px;
  color: #fff8e8;
  font-size: 18px;
}

.dock-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.quick-action {
  flex: 0 0 auto;
  min-width: 86px;
  gap: 6px;
  background: rgba(35, 72, 62, 0.92);
}

.quick-action.primary {
  background: #b93622;
  color: #fff8e8;
}

.scene-hotspot {
  position: absolute;
  z-index: 3;
  display: none;
  align-items: center;
  gap: 6px;
  min-height: 36px;
  padding: 0 10px;
  border: 1px solid rgba(255, 240, 202, 0.3);
  border-radius: 8px;
  background: rgba(255, 250, 240, 0.9);
  color: #4a3423;
  box-shadow: 0 8px 18px rgba(0, 0, 0, 0.22);
}

.hotspot-agents {
  left: 8%;
  top: 58%;
}

.hotspot-tasks {
  left: 50%;
  bottom: 25%;
  transform: translateX(-50%);
}

.panel-overlay {
  position: absolute;
  inset: 0;
  top: 0;
  bottom: auto;
  height: min(100%, var(--hall-visual-height, 100%));
  max-height: 100%;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 72px 20px 92px;
  box-sizing: border-box;
  background: transparent;
  isolation: isolate;
  contain: layout paint;
  transform: translate3d(0, 0, 0);
  backface-visibility: hidden;
}

.panel-overlay::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 0;
  background: rgba(18, 13, 10, 0.42);
  opacity: 1;
  transform: translate3d(0, 0, 0);
  backface-visibility: hidden;
  pointer-events: none;
  contain: layout paint;
}

.panel-overlay.is-chat-overlay {
  top: 0;
  bottom: auto;
  height: min(100%, var(--hall-visual-height, 100%));
  max-height: 100%;
}

/* A handling session is one active, near-full work window. Landscape does
 * not degrade it into a right-side half drawer. */
.panel-overlay.is-full-window {
  align-items: center;
  justify-content: center;
  padding: 8px 12px;
}

.panel-overlay.is-full-window .floating-panel.layout-full-window {
  /* The overlay owns the only outer gutter; do not subtract it again here. */
  width: min(1180px, 100%);
  max-width: 100%;
  height: 100%;
  max-height: 100%;
  border-radius: 10px;
}

.panel-overlay.is-compact-chat-overlay .panel-title {
  padding: 6px 10px;
}

.panel-overlay.is-compact-chat-overlay :deep(.discussion-brief) {
  display: none;
}

.panel-overlay.is-compact-chat-overlay :deep(.hall-messages) {
  padding: 4px 8px;
}

.floating-panel {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  width: min(860px, 100%);
  max-width: 100%;
  min-height: 0;
  max-height: 100%;
  box-sizing: border-box;
  border: 1px solid rgba(71, 44, 23, 0.2);
  border-radius: 8px;
  background: #fffaf0;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.34);
  overflow: hidden;
  opacity: 1;
  transform: translate3d(0, 0, 0);
  transform-origin: center bottom;
  backface-visibility: hidden;
  contain: layout paint;
  will-change: transform, opacity;
  isolation: isolate;
}

.floating-panel.panel-treasure:not(.layout-full-window) {
  width: min(1040px, calc(100% - 40px));
}

.floating-panel.layout-center-modal {
  width: min(860px, calc(100% - 40px));
  max-height: calc(100% - 48px);
}



.panel-title {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
  padding: 14px 16px;
  box-sizing: border-box;
  border-bottom: 1px solid rgba(71, 44, 23, 0.12);
  background: #fffaf0;
}

.panel-title {
  font-weight: 700;
}

.panel-title > span {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.panel-title button {
  padding: 0 12px;
  background: #efe0c6;
  color: #4a3423;
}

.panel-return,
.panel-orientation {
  flex: 0 0 auto;
  white-space: nowrap;
}

.panel-close {
  flex: 0 0 36px;
  width: 36px;
  min-width: 36px;
  padding: 0;
}

.toast {
  position: fixed;
  left: 50%;
  bottom: 24px;
  z-index: 1200;
  transform: translateX(-50%);
  padding: 10px 14px;
  border-radius: 8px;
  background: rgba(42, 31, 22, 0.92);
  color: #fff;
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translate(-50%, 8px);
}

.agent-card-enter-active,
.agent-card-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.agent-card-enter-from,
.agent-card-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

.panel-enter-active,
.panel-leave-active {
  transition: none;
}

.panel-enter-active::before,
.panel-leave-active::before {
  transition: opacity 0.16s ease-out;
  will-change: opacity;
}

.panel-enter-active .floating-panel,
.panel-leave-active .floating-panel {
  transition:
    transform 0.18s cubic-bezier(0.2, 0, 0, 1),
    opacity 0.14s ease-out;
  will-change: transform, opacity;
}

.panel-enter-from::before,
.panel-leave-to::before {
  opacity: 0;
}

.panel-enter-from .floating-panel {
  transform: translate3d(0, 10px, 0);
}

.panel-leave-to .floating-panel {
  opacity: 0;
  transform: translate3d(0, 10px, 0);
}

.juyi-page.is-panel-open :deep(.hall-board),
.juyi-page.is-panel-open :deep(.map-world),
.juyi-page.is-panel-open :deep(.agent-token),
.juyi-page.is-panel-open :deep(.agent-token *) {
  animation-play-state: paused !important;
}

.juyi-page.is-panel-open :deep(.map-world) {
  transition: none;
}

.juyi-page.is-virtual-landscape {
  position: fixed;
  top: 0;
  left: 0;
  z-index: 30;
  width: 100vh;
  height: 100vw;
  width: 100dvh;
  height: 100dvw;
  min-height: 0;
  transform: rotate(90deg) translateY(-100%);
  transform-origin: top left;
}

@media (prefers-reduced-motion: reduce) {
  .panel-enter-active,
  .panel-leave-active,
  .panel-enter-active::before,
  .panel-leave-active::before,
  .panel-enter-active .floating-panel,
  .panel-leave-active .floating-panel {
    transition: none;
  }
}

@keyframes agentWalkRoute {
  0% {
    left: var(--p0x);
    top: var(--p0y);
  }
  12% {
    left: var(--p1x);
    top: var(--p1y);
  }
  25% {
    left: var(--p2x);
    top: var(--p2y);
  }
  38% {
    left: var(--p3x);
    top: var(--p3y);
  }
  52% {
    left: var(--p4x);
    top: var(--p4y);
  }
  66% {
    left: var(--p5x);
    top: var(--p5y);
  }
  82% {
    left: var(--p6x);
    top: var(--p6y);
  }
  94% {
    left: var(--p7x);
    top: var(--p7y);
  }
  100% {
    left: var(--p0x);
    top: var(--p0y);
  }
}

@keyframes taskOrbitA {
  0% {
    transform: translate(-50%, -50%) rotate(var(--sprite-tilt, -4deg)) scale(0.98);
  }
  23% {
    transform: translate(calc(-50% + var(--orbit-x)), calc(-50% - var(--orbit-y))) rotate(7deg) scale(1.02);
  }
  61% {
    transform: translate(calc(-50% + var(--wander-x)), calc(-50% + var(--orbit-y))) rotate(-9deg) scale(0.96);
  }
  100% {
    transform: translate(-50%, -50%) rotate(var(--sprite-tilt, -4deg)) scale(0.98);
  }
}

@keyframes taskOrbitB {
  0% {
    transform: translate(-50%, -50%) rotate(var(--sprite-tilt, 4deg));
  }
  34% {
    transform: translate(calc(-50% + var(--orbit-x-left)), calc(-50% + var(--wander-y))) rotate(-12deg);
  }
  72% {
    transform: translate(calc(-50% + var(--orbit-x-mid)), calc(-50% + var(--orbit-y-high))) rotate(10deg);
  }
  100% {
    transform: translate(-50%, -50%) rotate(var(--sprite-tilt, 4deg));
  }
}

@keyframes taskOrbitC {
  0% {
    transform: translate(-50%, -50%) rotate(var(--sprite-tilt, 2deg)) scale(1);
  }
  19% {
    transform: translate(calc(-50% + var(--wander-x)), calc(-50% + var(--orbit-y-up-soft))) rotate(11deg) scale(0.97);
  }
  48% {
    transform: translate(calc(-50% + var(--orbit-x-left-soft)), calc(-50% + var(--orbit-y-down-soft))) rotate(-8deg) scale(1.03);
  }
  83% {
    transform: translate(calc(-50% + var(--orbit-x-right-soft)), calc(-50% + var(--wander-y))) rotate(5deg) scale(0.99);
  }
  100% {
    transform: translate(-50%, -50%) rotate(var(--sprite-tilt, 2deg)) scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .task-sprite {
    animation: none;
  }
}

@media (max-width: 640px) {
  .juyi-page {
    --bottom-action-bar-height: 108px;
    background: #211812;
  }

  .stage-header {
    top: 8px;
    left: 8px;
    right: 8px;
    padding: 12px;
    align-items: flex-start;
  }

  h1 {
    font-size: 24px;
  }

  .stage-actions {
    justify-content: flex-end;
    flex-wrap: nowrap;
    max-width: none;
    gap: 6px;
  }

  .icon-action {
    width: 34px;
    min-height: 34px;
  }

  .banner {
    top: 92px;
  }

  .scene-hotspot {
    min-height: 32px;
    padding: 0 8px;
    font-size: 12px;
  }

  .hotspot-agents {
    left: 5%;
    top: 63%;
  }

  .quick-bar {
    grid-template-columns: 1fr;
    gap: 8px;
    padding: 8px max(8px, env(safe-area-inset-right)) max(8px, env(safe-area-inset-bottom)) max(8px, env(safe-area-inset-left));
  }

  .dock-summary {
    overflow-x: auto;
    flex-wrap: nowrap;
  }

  .dock-summary span {
    min-height: 34px;
    padding: 0 8px;
    font-size: 12px;
  }

  .dock-summary strong {
    font-size: 16px;
  }

  .dock-actions {
    justify-content: flex-start;
    overflow-x: auto;
  }

  .quick-action {
    flex: 0 0 auto;
    min-width: 78px;
  }

  .map-world {
    width: 164%;
    height: 146%;
  }

  .room-main {
    left: 35%;
    top: 36%;
    width: 30%;
    height: 31%;
  }

  .room-agents {
    left: 15%;
    top: 38%;
    width: 18%;
    height: 22%;
  }

  .room-tasks {
    right: 15%;
    top: 38%;
    width: 18%;
    height: 22%;
  }

  .room-back {
    left: 39%;
    bottom: 13%;
    width: 22%;
    height: 15%;
  }

  .hall-room {
    padding: 7px;
  }

  .hall-room strong {
    font-size: 13px;
  }

  .hall-room small {
    font-size: 10px;
  }

  .panel-overlay {
    align-items: flex-end;
    padding: 0;
  }

  .agent-card-enter-from,
  .agent-card-leave-to {
    transform: translateY(8px);
  }

  .floating-panel.layout-full-window {
    width: calc(100% - 12px);
    max-width: calc(100% - 12px);
    height: calc(100% - 8px);
    max-height: calc(100% - 8px);
    border-radius: 8px;
  }

  .panel-title {
    gap: 6px;
    padding: 8px 10px;
  }

  .panel-title button {
    min-height: 34px;
    padding: 0 9px;
  }


}
/* Use logical visual height as well as pointer-independent full-window sizing.
 * These rules also apply to a virtual landscape or keyboard-shortened viewport. */
.panel-overlay.is-low-height .panel-title {
  gap: 6px;
  padding: 6px 10px;
}
.panel-overlay.is-low-height .panel-title button {
  min-height: 34px;
  padding: 0 9px;
}
.panel-overlay.is-full-window :deep(.hall-draft-editor) {
  flex: 1;
  min-height: 0;
  max-height: none;
}
.floating-panel > :deep(.hall-overview),
.floating-panel > :deep(.formal-delivery-list) {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.panel-save-warning {
  flex: 0 0 auto;
  padding: 8px 12px;
  color: #7c1f1b;
  background: #fff3d8;
}
.panel-save-warning p {
  margin: 0 0 6px;
}
/* The accepted prototype supplies the page architecture; the live Stage remains intact. */
.hall-app-header,.hall-mode-toolbar,.hall-map-actions { display:flex; align-items:center; gap:16px; flex:0 0 auto; padding:12px 24px; color:#f0dfbd; background:#302015; border-bottom:1px solid #62492c; }
.hall-app-header { justify-content:space-between; }
.hall-app-header button,.hall-mode-toolbar button,.hall-map-actions button { font:inherit; color:inherit; cursor:pointer; min-height:44px; padding:8px 14px; border:1px solid #765a36; border-radius:4px; background:transparent; white-space:nowrap; }
.hall-app-header button:focus-visible,.hall-mode-toolbar button:focus-visible,.hall-map-actions button:focus-visible { outline:3px solid #e6bc69; outline-offset:2px; }
.hall-app-header .hall-brand { display:flex; gap:12px; align-items:center; padding:0; border:0; font-size:22px; text-align:left; }
.hall-brand small { display:block; font-size:12px; color:#c4a978; margin-top:4px; }
.hall-seal { display:grid; place-items:center; background:#8f402c; border:1px solid #b6774d; width:44px; height:44px; }
.hall-main-nav,.hall-header-tools,.hall-scene-tools { display:flex; align-items:center; gap:8px; }
.hall-main-nav button { border-color:transparent; }
.hall-main-nav button[aria-current=page] { border-bottom-color:#e4bf73; border-radius:0; }
.hall-mode-toolbar { padding:6px 24px; gap:12px; background:#261a10; }
.hall-mode-switch { display:flex; flex:0 0 auto; }
.hall-mode-switch button { border-radius:0; }
.hall-mode-switch button[aria-pressed=true] { background:#71512f; }
.hall-mode-hint { flex:1; font-size:13px; color:#bea77c; }
.hall-mode-toolbar .hall-scene-tools { margin-left:auto; gap:6px; }
.hall-mode-toolbar button { min-height:36px; padding:6px 10px; font-size:14px; }
.hall-map-actions { border-top:1px solid #62492c; border-bottom:0; padding-bottom:max(12px,env(safe-area-inset-bottom)); }
.hall-map-actions span { color:#c4a978; font-size:14px; }
.hall-map-actions .hall-primary { background:#8f402c; border-color:#b4774e; color:#fff8eb; }
.hall-map-actions .hall-continue { margin-left:auto; }
.panel-overlay:not(.is-full-window) { padding:32px 24px; }
.floating-panel.layout-center-modal,.floating-panel.panel-treasure:not(.layout-full-window) { width:min(1040px,100%); height:min(780px,100%); max-height:100%; }
.panel-title { background:#f3e8d0; padding:14px 22px; min-height:64px; font-weight:500; }
.panel-title > span { white-space:normal; font-size:20px; }
.panel-title .panel-close { order:4; border:0; background:transparent; }
.panel-title .panel-return { order:0; }
.panel-title .panel-orientation { margin-left:auto; font-size:14px; border:1px solid #c8ad84; background:transparent; }
.panel-title > span { order:1; }
.panel-title .panel-orientation { order:2; }
@media (max-width:1000px) {
 .hall-mode-hint,.hall-sound-action,.hall-help-action,.hall-brand small { display:none; }
 .hall-app-header,.hall-map-actions { padding:8px 12px; gap:8px; }
 .hall-main-nav,.hall-header-tools { gap:2px; }
 .hall-app-header button { padding:6px 10px; }
 .hall-mode-toolbar { padding:5px 12px; }
}
@media (max-width:600px) {
 .hall-app-header { flex-wrap:wrap; }
 .hall-app-header .hall-brand { font-size:19px; }
 .hall-seal { height:32px; width:32px; }
 .hall-main-nav { order:3; width:100%; justify-content:space-between; }
 .hall-main-nav button { flex:1; padding:6px; }
 .hall-mode-toolbar { flex-wrap:wrap; gap:4px; }
 .hall-mode-toolbar .hall-scene-tools { flex-wrap:wrap; }
 .hall-mode-toolbar button { padding:6px; }
 .hall-map-actions span { display:none; }
 .hall-map-actions button { padding:8px; font-size:14px; }
 .panel-overlay.is-full-window { padding:0; }
 .panel-overlay.is-full-window .floating-panel { border-radius:0; }
}
@media (max-height:500px) and (min-width:601px) {
 .hall-app-header { padding:4px 12px; }
 .hall-app-header .hall-brand { font-size:18px; }
 .hall-seal { width:30px; height:30px; }
 .hall-app-header button { min-height:34px; padding:5px 10px; }
 .hall-mode-toolbar { padding:3px 12px; }
 .hall-mode-toolbar button { min-height:32px; padding:4px 8px; }
 .hall-map-actions { padding:4px 12px; }
 .hall-map-actions button { min-height:34px; padding:5px 10px; }
 .hall-map-actions span { font-size:12px; }
 .panel-title { min-height:44px; padding:6px 12px; }
 .panel-title > span { font-size:17px; }
}
.floating-panel > :deep(.hall-draft-editor) { flex:1; min-height:0; overflow:auto; align-content:start; padding:24px 30px; box-sizing:border-box; overscroll-behavior:contain; }
@media(max-width:600px) { .floating-panel > :deep(.hall-draft-editor) { padding:20px 16px; } }
@media(max-height:500px) { .floating-panel > :deep(.hall-draft-editor) { padding:14px 20px; } }
/* Lightweight workbench: keep all authoritative panels and the single live Stage. */
.juyi-page.home-overview {
  --work-paper: #fffefa;
  --work-ground: #f5f4f0;
  --work-line: #e3e5dc;
  --work-ink: #242e2b;
  --work-muted: #68716b;
  --work-brand: #923f30;
  display: grid;
  grid-template-columns: 216px minmax(0, 1fr);
  grid-template-rows: 76px minmax(0, 1fr);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif;
  font-size: 15px;
  line-height: 1.65;
  background: var(--work-ground);
  color: var(--work-ink);
}
.home-overview > .hall-workbench-sidebar {
  grid-column: 1; grid-row: 1 / -1;
  display: flex; flex-direction: column; min-height: 0; padding: 28px 15px 16px;
  background: var(--work-paper); border-right: 1px solid var(--work-line); overflow-y: auto;
}
.home-overview .workbench-brand {
  display: flex; align-items: center; gap: 10px; width: 100%; padding: 0 5px;
  min-height: 54px; text-align: left; border: 0; background: transparent;
  color: var(--work-ink); font: 500 23px/1.2 "Noto Serif CJK SC", "Songti SC", STSong, serif;
  cursor: pointer;
}
.home-overview .workbench-brand small, .home-overview .workbench-map-entry small {
  display: block; margin-top: 4px; color: var(--work-muted); font: 400 11px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif;
}
.home-overview .workbench-seal {
  display: grid; place-items: center; width: 38px; height: 38px; flex: none;
  border-radius: 8px; background: var(--work-brand); color: var(--work-paper); font-size: 21px;
}
.home-overview .workbench-nav-caption { margin: 30px 10px 10px; font-size: 11px; letter-spacing: .06em; color: var(--work-muted); }
.home-overview .workbench-side-nav { display: flex; flex-direction: column; gap: 3px; }
.home-overview .workbench-side-nav button, .home-overview .workbench-map-entry {
  display: flex; align-items: center; justify-content: flex-start; gap: 12px; width: 100%;
  min-height: 44px; padding: 9px 12px; border: 0; border-radius: 7px;
  background: transparent; color: var(--work-muted); text-align: left; cursor: pointer; font-family: inherit; font-size: 14px; font-weight: 500; line-height: 1.45;
}
.home-overview .workbench-side-nav button:hover, .home-overview .workbench-map-entry:hover { background: #f0f1ea; color: var(--work-ink); }
.home-overview .workbench-side-nav button[aria-current="page"] { background: #f6eee8; color: var(--work-brand); }
.home-overview .workbench-side-nav button .var-icon, .home-overview .workbench-map-entry .var-icon { flex: none; font-size: 19px; }
.home-overview .workbench-sidebar-bottom { margin-top: auto; padding-top: 20px; }
.home-overview .workbench-map-entry { min-height: 66px; margin-bottom: 14px; border: 1px solid var(--work-line); background: var(--work-ground); color: var(--work-ink); }
.home-overview .workbench-map-entry span { flex: 1; }
.home-overview .workbench-side-utility { border-top: 1px solid var(--work-line); padding-top: 12px; }
.home-overview > .hall-app-header {
  grid-column: 2; grid-row: 1; min-width: 0; padding: 12px 36px;
  background: var(--work-paper); color: var(--work-ink); border-bottom: 1px solid var(--work-line);
}
.home-overview .hall-app-header .hall-brand { font-size: 17px; color: var(--work-ink); }
.home-overview .hall-app-header .hall-seal, .home-overview .hall-app-header .hall-brand small, .home-overview .hall-app-header .hall-main-nav, .home-overview > .hall-mode-toolbar { display: none; }
.home-overview .hall-app-header button { min-height: 40px; padding: 8px 12px; border-radius: 7px; color: var(--work-muted); border-color: var(--work-line); }
.home-overview .hall-app-header .workbench-create-action { background: var(--work-brand); color: var(--work-paper); border-color: var(--work-brand); }
.home-overview .hall-app-header .workbench-create-action:hover { background: #793326; }
.home-overview .workbench-mobile-more, .home-overview .workbench-mobile-nav { display: none; }
/* The absolute containing block is .juyi-page; percentage width also accounts for classic viewport scrollbars. */
.home-overview .workbench-more-menu { position: absolute; top: 64px; right: 15px; z-index: 32; box-sizing: border-box; width: min(330px, calc(100% - 30px)); max-height: calc(100% - 64px - 62px - env(safe-area-inset-bottom)); overflow-y: auto; overscroll-behavior: contain; padding: 12px; background: var(--work-paper); border: 1px solid var(--work-line); border-radius: 10px; box-shadow: 0 18px 38px #242e2b29; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
.home-overview .workbench-more-menu button { white-space: normal; text-align: left; justify-content: flex-start; }
.juyi-page.home-overview :deep(.portrait-work-summary) { width: min(1320px, 100%); }
.juyi-page.home-overview :deep(.hall-overview:not(.is-messages)) { background: var(--work-ground); color: var(--work-ink); }
.juyi-page.home-overview > :deep(.hall-portrait-home.is-unified-shell) {
  grid-column: 2; grid-row: 2; min-height: 0; height: 100%; background: var(--work-ground); color: var(--work-ink);
}
.home-overview .panel-overlay.is-workbench-panel {
  inset: 76px 0 0 216px; top: 76px; bottom: 0; height: auto; max-height: none;
  padding: 16px 24px; background: var(--work-ground); z-index: 20;
}
.home-overview .panel-overlay.is-workbench-panel::before { background: transparent; }
.home-overview .panel-overlay.is-workbench-panel > .floating-panel {
  flex: 1; width: min(1320px, 100%); max-width: 1320px; height: 100%; max-height: 100%; min-height: 0;
  border: 1px solid var(--work-line); border-radius: 12px; background: var(--work-paper); box-shadow: none;
}
.home-overview .panel-overlay.is-workbench-panel .panel-title { min-height: 56px; padding: 10px 20px; background: var(--work-paper); color: var(--work-ink); }
.home-overview .panel-overlay.is-workbench-panel .panel-title > span { font-size: 20px; }
.home-overview .panel-overlay.is-workbench-panel.is-chat-overlay :deep(.hall-messages) { flex: 1 1 auto; min-height: 0; padding: 16px 20px; }
.home-overview .panel-overlay.is-workbench-panel.is-chat-overlay :deep(.hall-chat-composer) { padding: 10px 20px 12px; }
.home-overview .panel-overlay.is-workbench-panel.is-chat-overlay :deep(.chat-panel) { height: 100%; }
.home-overview button:focus-visible, .home-overview .workbench-more-menu button:focus-visible { outline: 3px solid #923f3080; outline-offset: 3px; }
@media (max-width: 1200px) {
  .juyi-page.home-overview { grid-template-columns: 192px minmax(0, 1fr); }
  .home-overview > .hall-workbench-sidebar { padding-right: 10px; padding-left: 10px; }
  .home-overview .panel-overlay.is-workbench-panel { left: 192px; }
  .home-overview > .hall-app-header { padding-right: 26px; padding-left: 26px; }
}
@media (max-width: 760px) {
  .juyi-page.home-overview { grid-template-columns: minmax(0,1fr); grid-template-rows: 64px minmax(0,1fr); }
  .home-overview > .hall-workbench-sidebar { display: none; }
  .home-overview > .hall-app-header { grid-column: 1; grid-row: 1; padding: 10px 16px; }
  .home-overview .hall-app-header .hall-header-tools { gap: 5px; }
  .home-overview .hall-app-header .hall-header-tools > button:first-child, .home-overview .hall-app-header .workbench-create-action { display: none; }
  .home-overview .hall-app-header .workbench-mobile-more { display: inline-flex; }
  .juyi-page.home-overview > :deep(.hall-portrait-home.is-unified-shell) { grid-column: 1; grid-row: 2; padding-bottom: calc(62px + env(safe-area-inset-bottom)); }
  .home-overview .workbench-mobile-nav {
    position: absolute; z-index: 30; bottom: 0; left: 0; right: 0;
    display: flex; align-items: stretch; box-sizing: border-box; height: calc(62px + env(safe-area-inset-bottom));
    padding: 5px 12px max(5px, env(safe-area-inset-bottom));
    border-top: 1px solid var(--work-line); background: var(--work-paper);
  }
  .home-overview .workbench-mobile-nav button {
    flex: 1 1 25%; min-width: 0; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 4px;
    border: 0; border-radius: 7px; padding: 5px; min-height: 50px; background: transparent;
    color: var(--work-muted); font-size: 11px; cursor: pointer; white-space: nowrap;
  }
  .home-overview .workbench-mobile-nav button[aria-current="page"] { color: var(--work-brand); background: #f6eee8; }
  .home-overview .workbench-mobile-nav .var-icon { font-size: 21px; }
  .home-overview .panel-overlay.is-workbench-panel {
    inset: 64px 0 calc(62px + env(safe-area-inset-bottom)) 0; top: 64px; bottom: calc(62px + env(safe-area-inset-bottom));
    height: auto; max-height: none; padding: 0;
  }
  .home-overview .panel-overlay.is-workbench-panel > .floating-panel { width: 100%; max-width: none; height: 100%; border: 0; border-radius: 0; }
  .home-overview .panel-overlay.is-workbench-panel .panel-title { min-height: 44px; padding: 6px 16px; }
  .home-overview .panel-overlay.is-workbench-panel.is-chat-overlay :deep(.hall-chat-composer) { padding: 8px 16px 10px; }
  .home-overview .panel-overlay.is-workbench-panel.is-chat-overlay :deep(.hall-messages) { padding: 10px 16px; }
}
@media (max-height: 560px) {
  .juyi-page.home-overview { grid-template-rows: 58px minmax(0, 1fr); }
  .home-overview > .hall-app-header { padding-top: 5px; padding-bottom: 5px; }
  .home-overview .workbench-more-menu { top: 58px; max-height: calc(100% - 58px - 62px - env(safe-area-inset-bottom)); }
  .home-overview .panel-overlay.is-workbench-panel { top: 58px; }
  .home-overview .panel-overlay.is-workbench-panel.is-chat-overlay :deep(.discussion-brief) { display: none; }
  .home-overview .panel-overlay.is-workbench-panel { padding-top: 0; padding-bottom: 0; }
  .home-overview .panel-overlay.is-workbench-panel .panel-title { min-height: 40px; padding-top: 4px; padding-bottom: 4px; }
  .home-overview .panel-overlay.is-workbench-panel.is-chat-overlay :deep(.hall-chat-composer) { padding-top: 6px; padding-bottom: 6px; }
}

/* At 200%-equivalent narrow reflow, keep each action reachable rather than
   letting min-content widths shift the workbench outside the viewport. */
@media (max-width: 240px) {
  .juyi-page.home-overview { grid-template-columns: minmax(0, 1fr); }
  .home-overview > .hall-app-header { box-sizing: border-box; width: 100%; min-width: 0; flex-wrap: nowrap; padding: 5px 8px; }
  .home-overview .hall-app-header .hall-header-tools > button:not(.workbench-mobile-more) { display: none; }
  .home-overview .hall-app-header .hall-brand { flex: 0 1 auto; min-width: 0; }
  .home-overview .workbench-mobile-nav button:not(:last-child) span { display: none; }
  .home-overview .workbench-mobile-nav button { padding: 3px; font-size: 10px; }
  .home-overview .panel-overlay.is-workbench-panel .panel-title > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .home-overview .panel-overlay.is-workbench-panel.is-chat-overlay :deep(.hall-chat-composer) { padding-top: 2px; padding-bottom: 2px; }
  .home-overview .panel-overlay.is-workbench-panel.is-chat-overlay :deep(.composer-textarea) { max-height: 56px; }
  .home-overview .panel-overlay.is-workbench-panel.is-chat-overlay :deep(.panel-toolbar) { overflow-x: auto; overscroll-behavior-x: contain; }
  .home-overview .panel-overlay.is-workbench-panel.is-chat-overlay :deep(.panel-toolbar .context-summary),
  .home-overview .panel-overlay.is-workbench-panel.is-chat-overlay :deep(.panel-toolbar .toolbar-actions) { flex: 0 0 auto; }
}
@media (max-width: 180px) {
  .home-overview .panel-overlay.is-workbench-panel .panel-title { min-height: 36px; padding: 0 8px; }
  .home-overview .panel-overlay.is-workbench-panel .panel-title > span { display: none; }
  .home-overview .panel-overlay.is-workbench-panel.is-chat-overlay :deep(.panel-toolbar) { padding: 2px 6px; }
  .home-overview .panel-overlay.is-workbench-panel.is-chat-overlay :deep(.hall-messages) { padding: 4px 8px; }
  .home-overview .panel-overlay.is-workbench-panel.is-chat-overlay :deep(.composer-meta span:last-child) { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
}
/* When the entire chat is taller than an extremely short viewport, scroll the
   work window itself so the composer remains reachable above the fixed dock. */
@media (max-height: 260px) and (max-width: 760px) {
  .home-overview .panel-overlay.is-workbench-panel.is-chat-overlay > .floating-panel { overflow-y: auto; overscroll-behavior: contain; }
  .home-overview .panel-overlay.is-workbench-panel.is-chat-overlay :deep(.chat-panel) { flex: 0 0 auto; height: auto; min-height: min-content; }
  .home-overview .panel-overlay.is-workbench-panel.is-chat-overlay :deep(.hall-messages) { flex: 0 0 auto; min-height: 80px; max-height: 40vh; }
}

</style>
