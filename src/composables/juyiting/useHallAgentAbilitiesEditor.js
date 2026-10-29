import { ref, watch } from 'vue'

const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i])
export const normalizeAbilityDraft = draft => {
  const seen = new Set()
  return draft.split(/\r?\n/).map(line => line.trim()).filter(line => {
    if (!line || seen.has(line.toLowerCase())) return false
    seen.add(line.toLowerCase())
    return true
  })
}

/** Edits a user's introduction, never runtime readiness. No automatic write retry. */
export const useHallAgentAbilitiesEditor = ({ api, profile, getAgent, identityKey, enabled }) => {
  const editing = ref(false)
  const draft = ref('')
  const busy = ref(false)
  const message = ref('')
  const needsCheck = ref(false)
  let epoch = 0
  let controller = null
  let expected = []
  let intended = null
  let uncertain = false
  const key = () => JSON.stringify([identityKey(), enabled(), getAgent()?.agentId, getAgent()?.boundToMe, getAgent()?.systemAgent])
  const allowed = () => Boolean(identityKey()) && enabled() && getAgent()?.boundToMe === true && getAgent()?.systemAgent !== true
  const currentAbilities = () => profile.projection.value?.agentId === getAgent()?.agentId ? profile.projection.value.abilities : null
  const reset = () => {
    epoch++; controller?.abort(); controller = null
    editing.value = false; busy.value = false; draft.value = ''; message.value = ''; needsCheck.value = false
    expected = []; intended = null; uncertain = false
  }
  const begin = () => {
    if (!allowed() || !currentAbilities() || profile.loading.value || profile.error.value) return
    reset(); expected = [...currentAbilities()]; draft.value = expected.join('\n'); editing.value = true
  }
  const reconcile = async (isCurrent, checkIntent) => {
    const read = await profile.refresh()
    if (!isCurrent()) return
    const latest = currentAbilities()
    if (!read || !latest) {
      needsCheck.value = true
      message.value = '最新本领读取失败；草稿已保留，请核对保存结果。'
      return
    }
    if (checkIntent && intended && same(latest, intended) && same(normalizeAbilityDraft(draft.value), intended)) {
      editing.value = false; needsCheck.value = false; message.value = '本领已保存。'
      return
    }
    expected = [...latest]; uncertain = false; intended = null; needsCheck.value = false
    message.value = '已读取最新本领，草稿未覆盖；请核对后再次保存，或取消编辑。'
  }
  const checkLatest = async () => {
    if (busy.value || !editing.value || !allowed()) return
    const generation = epoch; const scope = key()
    const current = () => generation === epoch && scope === key()
    busy.value = true
    try { await reconcile(current, uncertain) } catch {
      if (current()) { needsCheck.value = true; message.value = '最新本领读取失败；草稿已保留。' }
    } finally { if (current()) busy.value = false }
  }
  const save = async () => {
    if (busy.value || needsCheck.value || !editing.value || !allowed()) return
    const abilities = normalizeAbilityDraft(draft.value)
    if (abilities.length > 128 || abilities.some(value => value.length > 100 || /[\u0000-\u001f\u007f-\u009f]/u.test(value))) {
      message.value = '最多128项，每项最多100个字符，不能包含控制字符。'
      return
    }
    const generation = epoch; const scope = key(); const agentId = getAgent().agentId
    const own = new AbortController(); controller = own
    const current = () => generation === epoch && scope === key() && !own.signal.aborted
    busy.value = true; message.value = ''; intended = abilities
    try {
      const saved = await api.put(`/${encodeURIComponent(agentId)}/abilities`, { expectedAbilities: expected, abilities },
        { autoLoading: false, needAuth: true, signal: own.signal })
      if (!current()) return
      if (saved?.agentId !== agentId || !same(saved.abilities, abilities)) throw new Error('Unconfirmed abilities response')
      uncertain = true
      await reconcile(current, true)
    } catch (error) {
      if (!current()) return
      if (error?.code === 'BAD_REQUEST' || error?.status === 400) {
        intended = null; message.value = '本领格式不正确，请修改后保存。'
      } else {
        uncertain = error?.code !== 'AGENT_ABILITIES_CONFLICT' && error?.status !== 409
        needsCheck.value = true
        message.value = uncertain ? '保存结果待确认；草稿已保留，请先核对结果，不会自动重试。' : '本领已被其他操作修改；草稿已保留，请先读取最新记录。'
      }
    } finally { if (current()) { busy.value = false; controller = null } }
  }
  const stop = watch(key, reset, { flush: 'sync' })
  return { editing, draft, busy, message, needsCheck, begin, save, checkLatest, cancel: reset,
    dispose: () => { reset(); stop() } }
}
