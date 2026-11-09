# MintCheck — a scam-detection agent for the agent economy

AI agents are starting to hold wallets and spend on their own. The first
question an agent should ask before it mints, buys, or pays a counterparty
is the one a careful human asks: **is this project what it claims to be?**

MintCheck answers that question from evidence anyone can re-check, scores
it with a rubric anyone can read, and **publishes the verdict on NEAR** —
in a public registry contract that other agents can query before they
transact. Trust, but verify, with the receipt on-chain.

Built solo at **NEAR HACKATHON** (Nov 1–14, 2026) for the **AI Security &
Defense** and **Agent Economy** tracks.

## Try it (2 minutes, offline-safe)

```bash
npm install
npm run demo
```

You will see the agent vet a real project (Pokechain, a BSC mint) from a
bundled evidence pack: every rubric rule that fired, the risk score
(0/100), the verdict (MINT / SKIP / DYOR), and the SHA-256 hash of the
evidence pack. Anchoring is skipped with a clear message unless the
agent's own NEAR testnet credentials are present — the verdict is the
full result either way.

A second bundled pack shows the other end of the scale:

```bash
node agent/mintcheck.js --sample samples/suspicious.json
```

a synthetic project with no official X, a "free" mint that is not free,
hidden paid tiers, and an unverifiable supply: risk 70/100, verdict SKIP.

## Vet a live project

```bash
node agent/mintcheck.js --name "Pokechain" \
  --contract 0x4EF929aF00cB93993c3D01834C4DA79200d31e32 \
  --cap 15555 --x PokechainTrade
```

The agent reads the contract over a public BSC RPC (code presence,
`totalSupply()` / `totalMinted()` where the contract exposes them),
recomputes the minted share of the cap itself, and scores what it found.
What it cannot verify, it says so — an unreadable supply adds risk points
instead of being silently assumed fine.

## How NEAR fits

- The agent owns a NEAR testnet account (`mintcheck-agent.testnet`,
  faucet-funded — the whole project cost 0 USD).
- Its verdicts are written by `record_verdict` into the **VerdictRegistry**
  contract at `registry.mintcheck-agent.testnet`. Only the agent account
  can write; **anyone can read** (`get_verdict`, `verdict_count`).
- Each record stores the risk score, the verdict, the recorder, a block
  timestamp, and the **SHA-256 hash of the exact evidence pack** behind
  it — so a verdict can be audited against its evidence later, and a
  second agent can check a project's record before spending a single
  token. That is the agent-economy primitive this project demonstrates:
  a shared, tamper-evident reputation layer for project risk.

Real verdicts already anchored (NEAR testnet):

- Pokechain, live evidence: MINT, risk 15 —
  [tx 9PQBavuTFStgtUAr5GKUiqSMumx8yuinqAFCMEFJAENX](https://testnet.nearblocks.io/txns/9PQBavuTFStgtUAr5GKUiqSMumx8yuinqAFCMEFJAENX)
- Pokechain, verified-mint evidence pack: MINT, risk 0 —
  [tx 8Seg45Z3vsaowqy2HsPQnzghejo2vd5ucsiwr8EZQ2Ve](https://testnet.nearblocks.io/txns/8Seg45Z3vsaowqy2HsPQnzghejo2vd5ucsiwr8EZQ2Ve)
- Synthetic red-flag example: SKIP, risk 70 —
  [tx BgFxPphQRfGzG5Uxz1xQ2LRNuoy53pfKhzoJmGmuS83B](https://testnet.nearblocks.io/txns/BgFxPphQRfGzG5Uxz1xQ2LRNuoy53pfKhzoJmGmuS83B)

Check the registry yourself:

```bash
npx near-cli view registry.mintcheck-agent.testnet verdict_count '{}'
npx near-cli view registry.mintcheck-agent.testnet get_verdict '{"project_id":"0x4EF929aF00cB93993c3D01834C4DA79200d31e32"}'
```

## The rubric (transparent on purpose)

Risk points are added only for evidence-backed findings, each printed
with its reason: no contract code at the address (+60), supply exhausted
while the mint is presented as open (+35), advertised free mint that is
not free (+20), paid tiers hidden behind the free headline (+20), supply
that cannot be read from the contract (+15), no official X account found
(+15). Verdicts: score ≤ 35 → MINT, 36–64 → DYOR, ≥ 65 → SKIP. The full
logic is `scoreEvidence()` in `agent/mintcheck.js` — no model, no black
box; an LLM summary layer can sit on top later without changing the
evidence or the score.

## Layout

- `agent/mintcheck.js` — evidence gathering (live RPC or bundled packs),
  the rubric, evidence hashing, and NEAR anchoring.
- `contract/src/contract.js` — the VerdictRegistry contract
  (near-sdk-js). Build with `npm run build-contract` (the contract is a
  standalone package under `contract/`).
- `samples/` — evidence packs used by the demo.
- Deployed contract: `registry.mintcheck-agent.testnet`
  ([explorer](https://testnet.nearblocks.io/address/registry.mintcheck-agent.testnet)).

## Notes and limits

- Testnet only, by design: testnet projects are eligible in every track,
  and the agent's key never touches mainnet funds.
- The JS contract runtime is heavy (~530 KB of storage on testnet); a
  Rust rewrite would cut deployment storage roughly threefold.
- Live-mode supply reads depend on the target contract exposing a
  standard view; when it does not, the rubric reports that honestly
  instead of guessing.

## License

MIT — see `LICENSE`.
