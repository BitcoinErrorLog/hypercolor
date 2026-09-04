/** Stable testID Maestro waits on before takeScreenshot (any catalog mount). */
export const VRT_SCENE_READY_ID = 'vrtSceneReady';

/** Exact catalog-id marker. Maestro must assertVisible this before takeScreenshot. */
export function vrtSceneMarkerId(catalogId: string): string {
  return `vrt-scene:${catalogId}`;
}

const SCENE_READY_TEST_IDS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'stack.composer.sheet': ['composerAction-photo'],
  'stack.payment.compose-idle': ['text:Request payment'],
  'stack.payment.compose-amount': ['paymentComposeError'],
  'stack.payment.compose-reference': ['paymentComposeError'],
  'stack.payment.compose-busy': ['text:Request payment'],
  'stack.payment.review': ['paymentReviewContinue'],
  'overlay.attach.alert': ['composerAction-photo'],
  'overlay.wallet.alert': ['paymentReviewContinue'],
  'overlay.sign-out.alert': ['signOutCancel'],
  'tabs.profile.sign-out': ['signOutCancel'],
  'tabs.channels.create-private': ['channelsCreateSheet'],
  'tabs.channels.create-public': ['channelsCreateSheet'],
  'tabs.channels.join-empty': ['text:Join a public topic'],
  'tabs.channels.join-invalid': ['text:Join a public topic'],
  'tabs.channels.join-busy': ['text:Join a public topic'],
  'tabs.settings.telemetry-on': ['text:Telemetry'],
  'tabs.settings.backup-busy': ['text:Encrypted backup'],
  'tabs.settings.recovery-shown': ['settingsRecoveryCopy'],
  'tabs.settings.restore-ok': ['text:Restore complete. History is local.'],
  'tabs.settings.restore-err': ['text:That recovery code did not work.'],
  'tabs.settings.enable-row': ['settingsEnableMessaging'],
  'tabs.settings.liveproof-idle': ['text:Live proof idle'],
  'tabs.settings.liveproof-running': ['text:Live proof running'],
  'tabs.settings.liveproof-ok': ['text:Live proof ok'],
  'tabs.settings.liveproof-fail': ['text:Live proof failed'],
  'tabs.settings.recovery-gate': ['settingsRecoveryConfirm'],
});

export function vrtSceneReadyTestIds(catalogId: string): readonly string[] {
  return [vrtSceneMarkerId(catalogId), ...(SCENE_READY_TEST_IDS[catalogId] ?? [])];
}
