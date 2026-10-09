/** The shared slot has one controlled recovery lane as soon as a frozen core-consent intent exists. */
export const pointAndStartRecoveryLane = intentState => intentState?.state === 'PRESENT' && intentState.record?.providerConsent
  ? 'CONTROLLED' : intentState?.state === 'PRESENT' ? 'ORDINARY' : 'NONE'
