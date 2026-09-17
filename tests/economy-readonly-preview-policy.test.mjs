import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessReadOnlyPreviewCapabilities,
  evaluateReadOnlyPreviewResponse,
  evaluateReadOnlyPreviewAction,
} from '../src/utils/economyReadOnlyPreviewPolicy.js';

function validCapabilities(overrides = {}) {
  return {
    contractVersion: 'economy-readonly-v1',
    mode: 'READ_ONLY_PREVIEW',
    enabled: true,
    principalScopeFingerprint: 'opaque-A',
    features: {
      wallet: true,
      ledger: true,
      catalog: true,
      installationStatus: true,
      hostingPlan: true,
      hostingLease: true,
    },
    actions: {
      estimate: true,
      issue: false,
      purchase: false,
      settle: false,
      refund: false,
      install: false,
      hostingActivate: false,
      hostingRenew: false,
    },
    ...overrides,
  };
}

function binding(overrides = {}) {
  return {
    scopeFingerprint: 'scope-A',
    agentId: 'agent-1',
    requestGeneration: 7,
    authGeneration: 11,
    ...overrides,
  };
}

test('accepts a complete enabled fixed contract and permits estimate only', () => {
  const capabilities = validCapabilities();
  const result = assessReadOnlyPreviewCapabilities(capabilities);

  assert.equal(result.available, true);
  assert.equal(result.reason, null);
  assert.equal(result.capabilities.actions.estimate, true);
  assert.deepEqual(evaluateReadOnlyPreviewAction(capabilities, 'estimate'), {
    allowed: true,
    reason: null,
  });
});

test('accepts a complete disabled contract but does not open features or estimate', () => {
  const disabled = validCapabilities({
    enabled: false,
    features: {
      wallet: false, ledger: false, catalog: false, installationStatus: false, hostingPlan: false, hostingLease: false,
    },
    actions: {
      estimate: false, issue: false, purchase: false, settle: false, refund: false, install: false, hostingActivate: false, hostingRenew: false,
    },
  });

  const result = assessReadOnlyPreviewCapabilities(disabled);
  assert.equal(result.available, false);
  assert.equal(result.reason, 'PREVIEW_DISABLED');
  assert.equal(result.capabilities.features.wallet, false);
  assert.deepEqual(evaluateReadOnlyPreviewAction(disabled, 'estimate'), {
    allowed: false,
    reason: 'PREVIEW_DISABLED',
  });
  assert.equal(assessReadOnlyPreviewCapabilities(validCapabilities({ enabled: false })).reason,
    'CAPABILITIES_DISABLED_BUT_OPEN');
});

test('contains missing, wrong-type, and unknown contract payloads as unavailable', () => {
  assert.equal(assessReadOnlyPreviewCapabilities(null).reason, 'CAPABILITIES_MALFORMED');
  assert.equal(assessReadOnlyPreviewCapabilities(validCapabilities({ enabled: 'true' })).reason,
    'CAPABILITIES_MALFORMED');
  assert.equal(assessReadOnlyPreviewCapabilities(validCapabilities({
    principalScopeFingerprint: '',
  })).reason, 'CAPABILITIES_MALFORMED');
  assert.equal(assessReadOnlyPreviewCapabilities(validCapabilities({
    features: { wallet: true },
  })).reason, 'CAPABILITIES_MALFORMED');
  assert.equal(assessReadOnlyPreviewCapabilities(validCapabilities({
    contractVersion: 'economy-readonly-v0',
  })).reason, 'CAPABILITIES_UNSUPPORTED_CONTRACT');
});

test('rejects every forged mutation capability and never permits its action', () => {
  for (const action of ['issue', 'purchase', 'settle', 'refund', 'install', 'hostingActivate', 'hostingRenew']) {
    const capabilities = validCapabilities({
      actions: { ...validCapabilities().actions, [action]: true },
    });
    assert.equal(assessReadOnlyPreviewCapabilities(capabilities).reason,
      'CAPABILITIES_MUTATION_FORBIDDEN', action);
    assert.deepEqual(evaluateReadOnlyPreviewAction(validCapabilities(), action), {
      allowed: false,
      reason: 'ACTION_READ_ONLY',
    }, action);
  }
});

test('rejects unknown actions and output cannot mutate or retain input references', () => {
  const capabilities = validCapabilities();
  const result = assessReadOnlyPreviewCapabilities(capabilities);

  assert.deepEqual(evaluateReadOnlyPreviewAction(capabilities, 'chargeEverything'), {
    allowed: false,
    reason: 'ACTION_UNKNOWN',
  });
  assert.notEqual(result.capabilities, capabilities);
  assert.notEqual(result.capabilities.features, capabilities.features);
  assert.notEqual(result.capabilities.actions, capabilities.actions);
  assert.equal(Object.isFrozen(result.capabilities), true);
  assert.equal(Object.isFrozen(result.capabilities.features), true);
  assert.equal(Object.isFrozen(result.capabilities.actions), true);
  assert.throws(() => { result.capabilities.features.wallet = false; }, TypeError);
  capabilities.features.wallet = false;
  assert.equal(result.capabilities.features.wallet, true);
});

test('response acceptance permits an explicit null agent but rejects Agent switches and undefined', () => {
  const noAgent = binding({ agentId: null });
  assert.deepEqual(evaluateReadOnlyPreviewResponse(noAgent, binding({ agentId: null })), {
    accepted: true,
    reason: null,
  });
  assert.equal(evaluateReadOnlyPreviewResponse(noAgent, binding({ agentId: 'agent-1' })).reason,
    'RESPONSE_AGENT_STALE');
  assert.equal(evaluateReadOnlyPreviewResponse(binding({ agentId: 'agent-1' }), noAgent).reason,
    'RESPONSE_AGENT_STALE');
  assert.equal(evaluateReadOnlyPreviewResponse(noAgent, binding({ agentId: undefined })).reason,
    'RESPONSE_BINDING_MALFORMED');
});

test('response acceptance compares scope, agent, request, auth generation, and rejects ABA', () => {
  const current = binding();
  assert.deepEqual(evaluateReadOnlyPreviewResponse(current, binding()), { accepted: true, reason: null });
  assert.equal(evaluateReadOnlyPreviewResponse(current, binding({ scopeFingerprint: 'scope-B' })).reason,
    'RESPONSE_SCOPE_STALE');
  assert.equal(evaluateReadOnlyPreviewResponse(current, binding({ agentId: 'agent-2' })).reason,
    'RESPONSE_AGENT_STALE');
  assert.equal(evaluateReadOnlyPreviewResponse(current, binding({ requestGeneration: 8 })).reason,
    'RESPONSE_REQUEST_STALE');

  const beforeSwitch = binding({ scopeFingerprint: 'scope-A', authGeneration: 11 });
  const afterAtoBtoA = binding({ scopeFingerprint: 'scope-A', authGeneration: 13 });
  assert.equal(evaluateReadOnlyPreviewResponse(afterAtoBtoA, beforeSwitch).reason,
    'RESPONSE_AUTH_GENERATION_STALE');
  assert.equal(evaluateReadOnlyPreviewResponse(current, { ...binding(), authGeneration: -1 }).reason,
    'RESPONSE_BINDING_MALFORMED');
});
