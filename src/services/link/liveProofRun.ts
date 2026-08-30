import { runRingAuthLiveProof } from './liveProofAuth';
import { runAttachmentLiveProof } from './liveProofAttachments';
import { runBackupLiveProof } from './liveProofBackup';
import { runContactsLiveProof } from './liveProofContacts';
import { runGroupLiveProof } from './liveProofGroups';
import { runLinkLiveProof } from './liveProof';
import { runPaymentHandoffLiveProof, type PaymentLiveProofDeps } from './liveProofPayments';
import { runLinkServiceLiveProof } from './liveProofProduct';
import type {
  AuthLiveProofDeps,
  LiveProofReport,
  NamedLiveProofConfig,
  ProductLiveProofDeps,
} from './liveProofShared';

export type { LiveProofReport, NamedLiveProofConfig, NamedLiveProofRow } from './liveProofShared';
export {
  parseLiveProofTokenList,
  parseLiveProofTokens,
  parseNamedLiveProofRows,
  redactLiveProofForLog,
} from './liveProofShared';
export { runLinkLiveProof } from './liveProof';
export { runRingAuthLiveProof } from './liveProofAuth';
export { runAttachmentLiveProof } from './liveProofAttachments';
export { runBackupLiveProof } from './liveProofBackup';
export { runContactsLiveProof } from './liveProofContacts';
export { runGroupLiveProof } from './liveProofGroups';
export { runPaymentHandoffLiveProof } from './liveProofPayments';
export { runLinkServiceLiveProof } from './liveProofProduct';

export type NamedLiveProofDeps = ProductLiveProofDeps & PaymentLiveProofDeps & AuthLiveProofDeps;

/**
 * Dispatch named P0–P6 (and optional native diagnostic) rows. Each row is
 * a separate report so a native dummy-proof close cannot paint P4 green.
 */
export async function runNamedLiveProofs(
  config: NamedLiveProofConfig,
  deps: NamedLiveProofDeps = {},
): Promise<{ ok: boolean; rows: Array<{ row: string; report: LiveProofReport }> }> {
  const rows: Array<{ row: string; report: LiveProofReport }> = [];
  const twoParty = {
    homeserverPubky: config.homeserverPubky,
    signupTokenA: config.signupTokenA,
    signupTokenB: config.signupTokenB,
  };
  const threeParty = {
    ...twoParty,
    signupTokenC: config.signupTokenC ?? '',
  };

  for (const row of config.rows) {
    if (row === 'native') {
      rows.push({ row, report: await runLinkLiveProof(twoParty, deps) });
      continue;
    }
    if (row === 'p0') {
      rows.push({ row, report: await runLinkServiceLiveProof(twoParty, deps) });
      continue;
    }
    if (row === 'p1') {
      rows.push({ row, report: await runContactsLiveProof(threeParty, deps) });
      continue;
    }
    if (row === 'p2') {
      rows.push({ row, report: await runGroupLiveProof(threeParty, deps) });
      continue;
    }
    if (row === 'p3') {
      rows.push({ row, report: await runAttachmentLiveProof(twoParty, deps) });
      continue;
    }
    if (row === 'p4') {
      rows.push({ row, report: await runPaymentHandoffLiveProof(twoParty, deps) });
      continue;
    }
    if (row === 'p5') {
      rows.push({ row, report: await runBackupLiveProof(twoParty, deps) });
      continue;
    }
    if (row === 'p6') {
      rows.push({ row, report: await runRingAuthLiveProof({}, deps) });
      continue;
    }
  }

  return { ok: rows.every(entry => entry.report.ok), rows };
}
