#!/usr/bin/env node
// MintCheck agent: vets a crypto mint project from verifiable evidence,
// scores it with a transparent rubric, and anchors the verdict in the
// NEAR testnet VerdictRegistry so any other agent can check the record
// before transacting.
//
// Modes:
//   node agent/mintcheck.js --sample samples/pokechain.json
//   node agent/mintcheck.js --name "Pokechain" --contract 0x4EF9... --cap 15555 --x PokechainTrade
//
// Anchoring needs the agent's NEAR testnet credentials (near-cli default
// location). Without them the verdict is printed and anchoring is
// skipped, so the demo still runs fully offline.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Account } = require('@near-js/accounts');
const { JsonRpcProvider } = require('@near-js/providers');
const { KeyPairSigner } = require('@near-js/signers');

const REGISTRY = process.env.NEAR_REGISTRY || 'registry.mintcheck-agent.testnet';
const AGENT_ACCOUNT = process.env.NEAR_AGENT_ACCOUNT || 'mintcheck-agent.testnet';
const BSC_RPC = 'https://bsc-rpc.publicnode.com';

// ---------- evidence gathering (live mode) ----------

async function rpc(method, params) {
  const res = await fetch(BSC_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`${method}: ${data.error.message}`);
  return data.result;
}

async function ethCall(to, data) {
  return rpc('eth_call', [{ to, data }, 'latest']);
}

function hexToBigInt(hex) {
  if (!hex || hex === '0x') return null;
  try { return BigInt(hex); } catch { return null; }
}

async function gatherLive({ name, contract, cap, x }) {
  const ev = {
    name,
    chain: 'bsc',
    contract,
    x: x || null,
    cap: cap ? Number(cap) : null,
    gathered_at: new Date().toISOString(),
    source: 'live BSC RPC reads',
  };
  const code = await rpc('eth_getCode', [contract, 'latest']);
  ev.has_code = code && code !== '0x';
  // totalSupply() = 0x18160ddd, totalMinted() differs per contract; try both.
  ev.supply = null;
  for (const [fn, sel] of [['totalSupply', '0x18160ddd'], ['totalMinted', '0x7464fc3d']]) {
    try {
      const v = hexToBigInt(await ethCall(contract, sel));
      if (v !== null && v > 0n) { ev.supply = Number(v); ev.supply_fn = fn; break; }
    } catch { /* selector unsupported on this contract */ }
  }
  if (ev.cap && ev.supply !== null) {
    ev.pct_minted = Math.round((ev.supply / ev.cap) * 1000) / 10;
  }
  return ev;
}

// ---------- the rubric (transparent, every point explained) ----------

function scoreEvidence(ev) {
  const findings = [];
  let score = 0;
  const add = (points, rule, detail) => { score += points; findings.push({ points, rule, detail }); };

  if (ev.has_code === false) add(60, 'no-contract-code', 'address holds no contract code on-chain');
  if (ev.has_code === true) add(0, 'contract-code-ok', 'contract code present on-chain');

  if (ev.supply === null || ev.supply === undefined) {
    add(15, 'supply-unverifiable', 'supply could not be read from the contract (no working totalSupply/totalMinted)');
  } else if (ev.pct_minted !== null && ev.pct_minted !== undefined) {
    if (ev.pct_minted >= 99) add(35, 'supply-exhausted', `${ev.pct_minted}% of the cap is already minted while the mint is presented as open`);
    else if (ev.pct_minted >= 90) add(15, 'supply-nearly-gone', `${ev.pct_minted}% of the cap is already minted`);
    else add(0, 'supply-ok', `${ev.pct_minted}% of the cap minted (${ev.supply}/${ev.cap})`);
  }

  if (ev.free_first_mint === true) add(0, 'free-verified', 'the free tier was exercised successfully at zero value');
  if (ev.free_first_mint === false) add(20, 'free-not-free', 'the advertised free mint is not actually free');
  if (ev.paid_tiers_hidden === true) add(20, 'hidden-paid-tiers', 'paid tiers exist behind the free headline and are not disclosed up front');

  if (!ev.x) add(15, 'no-official-x', 'no official X account could be found for the project');
  else add(0, 'official-x-ok', `official X present (@${ev.x})`);

  score = Math.max(0, Math.min(100, score));
  const verdict = score <= 35 ? 'MINT' : score >= 65 ? 'SKIP' : 'DYOR';
  return { score, verdict, findings };
}

// ---------- NEAR anchoring ----------

async function anchor(evidence, score, verdict, evidenceHash) {
  const credPath = `${homedir()}/.near-credentials/testnet/${AGENT_ACCOUNT}.json`;
  const cred = JSON.parse(readFileSync(credPath, 'utf8'));
  const signer = KeyPairSigner.fromSecretKey(cred.private_key);
  const provider = new JsonRpcProvider({ url: 'https://rpc.testnet.near.org' });
  const account = new Account(AGENT_ACCOUNT, provider, signer);
  const result = await account.callFunctionRaw({
    contractId: REGISTRY,
    methodName: 'record_verdict',
    args: {
      project_id: evidence.contract || evidence.name,
      score,
      verdict,
      evidence_hash: evidenceHash,
    },
    gas: BigInt('30000000000000'),
  });
  const txHash = result?.transaction?.hash;
  const check = await account.viewFunction({
    contractId: REGISTRY,
    methodName: 'get_verdict',
    args: { project_id: evidence.contract || evidence.name },
  });
  return { txHash, check };
}

// ---------- main ----------

async function main() {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
  };

  let evidence;
  if (get('--sample')) {
    evidence = JSON.parse(readFileSync(get('--sample'), 'utf8'));
  } else if (get('--contract')) {
    evidence = await gatherLive({
      name: get('--name') || 'unknown',
      contract: get('--contract'),
      cap: get('--cap'),
      x: get('--x'),
    });
  } else {
    console.error('usage: mintcheck.js --sample <file> | --name <n> --contract <addr> [--cap <n>] [--x <handle>]');
    process.exit(2);
  }

  const { score, verdict, findings } = scoreEvidence(evidence);
  const evidenceHash = createHash('sha256')
    .update(JSON.stringify(evidence, Object.keys(evidence).sort()))
    .digest('hex');

  console.log(`== MintCheck: ${evidence.name} ==`);
  console.log(`evidence: ${JSON.stringify(evidence)}`);
  for (const f of findings) console.log(`  [${f.points >= 0 ? '+' : ''}${f.points}] ${f.rule}: ${f.detail}`);
  console.log(`risk score: ${score}/100 -> verdict: ${verdict}`);
  console.log(`evidence hash (sha256): ${evidenceHash}`);

  const credPath = `${homedir()}/.near-credentials/testnet/${AGENT_ACCOUNT}.json`;
  if (!existsSync(credPath)) {
    console.log('anchoring skipped: no agent credentials found (only the live demo environment holds the agent key; the verdict above is the full offline result)');
    return;
  }
  try {
    const { txHash, check } = await anchor(evidence, score, verdict, evidenceHash);
    console.log(`anchored on NEAR testnet: tx ${txHash}`);
    console.log(`explorer: https://testnet.nearblocks.io/txns/${txHash}`);
    console.log(`registry read-back: ${JSON.stringify(check)}`);
  } catch (e) {
    console.log(`anchoring not completed: ${e.message} (verdict above is still valid off-chain)`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
