/** @type {readonly string[]} */
const FEATURE_KEYS = Object.freeze([
  'wallet',
  'ledger',
  'catalog',
  'installationStatus',
  'hostingPlan',
  'hostingLease',
]);

/** @type {readonly string[]} */
const ACTION_KEYS = Object.freeze([
  'estimate',
  'issue',
  'purchase',
  'settle',
  'refund',
  'install',
  'hostingActivate',
  'hostingRenew',
]);

const MUTATION_ACTIONS = new Set([
  'issue',
  'purchase',
  'settle',
  'refund',
  'install',
  'hostingActivate',
  'hostingRenew',
]);

const CONTRACT_VERSION = 'economy-readonly-v1';
const MODE = 'READ_ONLY_PREVIEW';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, expectedKeys) {
  const keys = Object.keys(value);
  return keys.length === expectedKeys.length
    && keys.every((key) => expectedKeys.includes(key));
}

function allBooleanProperties(value, keys) {
  return keys.every((key) => typeof value[key] === 'boolean');
}

function frozenCopy(capabilities) {
  return Object.freeze({
    contractVersion: capabilities.contractVersion,
    mode: capabilities.mode,
    enabled: capabilities.enabled,
    principalScopeFingerprint: capabilities.principalScopeFingerprint,
    features: Object.freeze(Object.fromEntries(
      FEATURE_KEYS.map((key) => [key, capabilities.features[key]]),
    )),
    actions: Object.freeze(Object.fromEntries(
      ACTION_KEYS.map((key) => [key, capabilities.actions[key]]),
    )),
  });
}

function unavailable(reason) {
  return Object.freeze({ available: false, reason, capabilities: null });
}

/**
 * Strictly validates the fixed `economy-readonly-v1` capability contract.
 *
 * The returned capabilities are a deeply frozen, detached copy. Invalid,
 * stale, or mutation-capable inputs are contained as an unavailable result so
 * callers can preserve compatibility with an older application instead of
 * throwing while rendering.
 *
 * @param {unknown} capabilities Untrusted response data from capabilities API.
 * @returns {{available: boolean, reason: string|null, capabilities: object|null}}
 */
function assessReadOnlyPreviewCapabilities(capabilities) {
  if (!isRecord(capabilities)) return unavailable('CAPABILITIES_MALFORMED');

  const rootKeys = [
    'contractVersion', 'mode', 'enabled', 'principalScopeFingerprint', 'features', 'actions',
  ];
  if (!hasExactKeys(capabilities, rootKeys)) return unavailable('CAPABILITIES_MALFORMED');
  if (capabilities.contractVersion !== CONTRACT_VERSION) {
    return unavailable('CAPABILITIES_UNSUPPORTED_CONTRACT');
  }
  if (capabilities.mode !== MODE) return unavailable('CAPABILITIES_UNSUPPORTED_MODE');
  if (typeof capabilities.enabled !== 'boolean') return unavailable('CAPABILITIES_MALFORMED');
  if (typeof capabilities.principalScopeFingerprint !== 'string'
      || capabilities.principalScopeFingerprint.length === 0) {
    return unavailable('CAPABILITIES_MALFORMED');
  }
  if (!isRecord(capabilities.features)
      || !hasExactKeys(capabilities.features, FEATURE_KEYS)
      || !allBooleanProperties(capabilities.features, FEATURE_KEYS)) {
    return unavailable('CAPABILITIES_MALFORMED');
  }
  if (!isRecord(capabilities.actions)
      || !hasExactKeys(capabilities.actions, ACTION_KEYS)
      || !allBooleanProperties(capabilities.actions, ACTION_KEYS)) {
    return unavailable('CAPABILITIES_MALFORMED');
  }
  if (MUTATION_ACTIONS.size !== 0
      && [...MUTATION_ACTIONS].some((action) => capabilities.actions[action] !== false)) {
    return unavailable('CAPABILITIES_MUTATION_FORBIDDEN');
  }
  if (!capabilities.enabled
      && (capabilities.actions.estimate || FEATURE_KEYS.some((key) => capabilities.features[key]))) {
    return unavailable('CAPABILITIES_DISABLED_BUT_OPEN');
  }

  const copy = frozenCopy(capabilities);
  return Object.freeze({
    available: copy.enabled,
    reason: copy.enabled ? null : 'PREVIEW_DISABLED',
    capabilities: copy,
  });
}

function validResponseBinding(binding) {
  return isRecord(binding)
    && typeof binding.scopeFingerprint === 'string'
    && binding.scopeFingerprint.length > 0
    && (binding.agentId === null
      || (typeof binding.agentId === 'string' && binding.agentId.length > 0))
    && Number.isSafeInteger(binding.requestGeneration)
    && binding.requestGeneration >= 0
    && Number.isSafeInteger(binding.authGeneration)
    && binding.authGeneration >= 0;
}

/**
 * Evaluates whether an asynchronous response still belongs to the current
 * authenticated preview context. `agentId` may be explicitly `null` for a
 * card with no Agent selection; omitted and empty IDs remain invalid.
 * `authGeneration` is intentionally compared
 * even when scope returns to the same value: this rejects an A -> B -> A
 * late response from the earlier A session.
 *
 * @param {unknown} current Current scope, agent and generation binding.
 * @param {unknown} responseBinding Binding captured when the request started.
 * @returns {{accepted: boolean, reason: string|null}}
 */
function evaluateReadOnlyPreviewResponse(current, responseBinding) {
  if (!validResponseBinding(current) || !validResponseBinding(responseBinding)) {
    return Object.freeze({ accepted: false, reason: 'RESPONSE_BINDING_MALFORMED' });
  }
  if (current.authGeneration !== responseBinding.authGeneration) {
    return Object.freeze({ accepted: false, reason: 'RESPONSE_AUTH_GENERATION_STALE' });
  }
  if (current.scopeFingerprint !== responseBinding.scopeFingerprint) {
    return Object.freeze({ accepted: false, reason: 'RESPONSE_SCOPE_STALE' });
  }
  if (current.agentId !== responseBinding.agentId) {
    return Object.freeze({ accepted: false, reason: 'RESPONSE_AGENT_STALE' });
  }
  if (current.requestGeneration !== responseBinding.requestGeneration) {
    return Object.freeze({ accepted: false, reason: 'RESPONSE_REQUEST_STALE' });
  }
  return Object.freeze({ accepted: true, reason: null });
}

/**
 * Enforces the browser-side action boundary for this preview contract.
 * Mutation actions and unknown action names are denied regardless of any
 * server payload. Only a valid, enabled capability with `estimate: true` may
 * permit the estimate RPC.
 *
 * @param {unknown} capabilities Untrusted capabilities response.
 * @param {unknown} action Requested API action name.
 * @returns {{allowed: boolean, reason: string|null}}
 */
function evaluateReadOnlyPreviewAction(capabilities, action) {
  if (typeof action !== 'string' || !ACTION_KEYS.includes(action)) {
    return Object.freeze({ allowed: false, reason: 'ACTION_UNKNOWN' });
  }
  if (MUTATION_ACTIONS.has(action)) {
    return Object.freeze({ allowed: false, reason: 'ACTION_READ_ONLY' });
  }

  const assessment = assessReadOnlyPreviewCapabilities(capabilities);
  if (!assessment.available) {
    return Object.freeze({ allowed: false, reason: assessment.reason });
  }
  if (!assessment.capabilities.actions.estimate) {
    return Object.freeze({ allowed: false, reason: 'ACTION_NOT_ENABLED' });
  }
  return Object.freeze({ allowed: true, reason: null });
}

export {
  assessReadOnlyPreviewCapabilities,
  evaluateReadOnlyPreviewResponse,
  evaluateReadOnlyPreviewAction,
};
