// MintCheck VerdictRegistry — NEAR testnet contract (near-sdk-js).
//
// A public registry where one authorized agent account anchors its
// due-diligence verdicts about crypto mint projects. Anyone can read a
// verdict and the hash of the evidence pack behind it, so other agents
// can check a project's record before they transact with it.
//
// State: verdicts maps project_id -> { score, verdict, evidence_hash,
// recorder, timestamp_ns }. owner is set once by init() at deploy time
// and is the only account allowed to record verdicts.

import { NearBindgen, near, call, view } from 'near-sdk-js';

@NearBindgen({})
export class VerdictRegistry {
  constructor() {
    this.owner = '';
    this.verdicts = {};
  }

  // Called exactly once, right after deployment, by the contract account.
  @call({})
  init({ owner }) {
    if (this.owner !== '') {
      throw new Error('already initialized');
    }
    if (near.predecessorAccountId() !== near.currentAccountId()) {
      throw new Error('init must be called by the contract account itself');
    }
    this.owner = owner;
    near.log(`VerdictRegistry initialized; owner=${owner}`);
  }

  // Record (or overwrite, with a fresh timestamp) one verdict.
  // score is risk 0-100; verdict is MINT, SKIP or DYOR.
  @call({})
  record_verdict({ project_id, score, verdict, evidence_hash }) {
    if (near.predecessorAccountId() !== this.owner) {
      throw new Error('only the registry owner (the MintCheck agent) can record verdicts');
    }
    if (typeof score !== 'number' || score < 0 || score > 100) {
      throw new Error('score must be a number between 0 and 100');
    }
    if (!['MINT', 'SKIP', 'DYOR'].includes(verdict)) {
      throw new Error('verdict must be MINT, SKIP or DYOR');
    }
    const record = {
      score,
      verdict,
      evidence_hash,
      recorder: near.predecessorAccountId(),
      timestamp_ns: near.blockTimestamp().toString(),
    };
    this.verdicts[project_id] = record;
    near.log(`verdict recorded for ${project_id}: ${verdict} risk=${score}`);
    return record;
  }

  @view({})
  get_verdict({ project_id }) {
    return this.verdicts[project_id] ?? null;
  }

  @view({})
  verdict_count() {
    return Object.keys(this.verdicts).length;
  }

  @view({})
  get_owner() {
    return this.owner;
  }
}
