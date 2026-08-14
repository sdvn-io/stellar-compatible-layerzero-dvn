# Stellar ↔ Sepolia LayerZero Message Demo

A wallet-driven, bidirectional LayerZero V2 testnet application for sending a short UTF-8 message between Stellar and Sepolia through the custom Stellar-compatible DVN.

## Web deployments

| Host | Workspace app | Purpose |
| --- | --- | --- |
| `sdvn.io` | `apps/landing` | Public SDVN landing page |
| `oapp.sdvn.io` | `apps/web` | Wallet-connected message OApp |
| `docs.sdvn.io` | Repository-root Mintlify site | Architecture, deployment registry, operations, and explorer evidence |

Every landing-page link to the OApp or documentation opens the corresponding host in a new browser tab.

### Vercel projects

Create two Vercel projects from this repository and set their Root Directories independently:

| Domain | Vercel Root Directory | Configuration |
| --- | --- | --- |
| `sdvn.io` | `stellar-dvn-app/apps/landing` | `apps/landing/vercel.json` |
| `oapp.sdvn.io` | `stellar-dvn-app/apps/web` | `apps/web/vercel.json` |

Both configurations provide the Vite SPA fallback, immutable caching for hashed assets, and baseline browser security headers. In the OApp Vercel project, set `VITE_RELAY_API_URL` to the public relay base URL including `/api`, for example `https://relay.example.com/api`. The development default remains the local Vite `/api` proxy.

Deploy `docs.sdvn.io` through Mintlify with the repository root as the docs directory. It uses `docs.json` and does not require a Vercel route.

## What the demo proves

The source wallet signs the OApp send, the relay derives the canonical LayerZero packet, the configured DVN verifies it, ULN302 commits it, and the destination OApp stores the exact packet payload. The relay fails unless both the received-message count increases by exactly one and the stored destination message matches the canonical packet.

Messages must contain 1–256 UTF-8 bytes. Numbers can be entered as text without losing their exact representation.

## Live testnet deployment

| Network | Message OApp |
| --- | --- |
| Stellar testnet | `CCJZEMQQ263PRQZ4ZHDELD62DOQKJQEOXF267TOE45PVWQRXCIMDR6WX` |
| Sepolia | `0x4e5cEda4702B5568618F238E735f02F0b149c90F` |

Both directions completed live DVN verification, ULN302 commit, execution, and exact destination-message validation. Transaction evidence is recorded in `../stellar-dvn-e2e/README.md`.

The Sepolia → Stellar relay serializes deliveries per process and scans canonical Sepolia `PacketSent` logs for missing nonces. If an earlier source packet was not delivered, it verifies, commits, and executes that packet before delivering the requested packet.

## New OApps required

The previous deployed contracts are counter OApps and cannot accept arbitrary messages. Deploy the contracts in `../stellar-dvn-e2e` first, configure their peers and ULN/DVN pathways, then set:

```dotenv
STELLAR_MESSAGE_OAPP=C...
SEPOLIA_MESSAGE_OAPP=0x...
STELLAR_SCAN_START_LEDGER=...
```

The Endpoint, ULN302, DVN, verifier, and relay identities remain the existing testnet infrastructure. Only the OApps and peer-specific security configuration are new.

## Run locally

Requirements: Node 22+, pnpm, Freighter on Stellar testnet, MetaMask on Sepolia, test XLM, and Sepolia ETH.

```bash
pnpm install
cp apps/relay/.env.example apps/relay/.env
pnpm dev
```

Open `http://localhost:5173`, choose a direction, enter a message, connect the source wallet, and approve. The result shows the exact value stored at the destination plus links for the source transaction, DVN verification, ULN commit, destination execution, and LayerZero Scan.

The web app selects MetaMask explicitly through EIP-6963, so another injected wallet cannot silently replace it.

## Validation

```bash
pnpm typecheck
pnpm build
```

For separate static deployments, build `@stellar-dvn/landing` or `@stellar-dvn/web` and publish that app's `dist/` directory:

```bash
pnpm --filter @stellar-dvn/landing build
pnpm --filter @stellar-dvn/web build
```

## Security boundary

This remains a single-signer testnet validation relay. The user wallet owns and pays the source transaction, while relay keys perform test-path verification and destination execution. Production requires durable queues, confirmation policy, replay persistence, rate limits, authenticated operations, monitoring, HSM-backed keys, and the production verification quorum.

The complete pre-message counter version is preserved at `../backups/stellar-message-prechange-20260814`.
