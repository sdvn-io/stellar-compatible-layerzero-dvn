# Stellar-Compatible LayerZero DVN

A working public-testnet implementation of bidirectional LayerZero V2 messaging between Stellar testnet and Sepolia. The project demonstrates a Stellar-compatible DVN verification path, ULN302 verification and commitment, ordered Endpoint execution, arbitrary UTF-8 message delivery, and explorer-verifiable evidence for every stage.

> **Status:** integration prototype on public testnets. This repository is not yet a production DVN service, audited bridge, or production validator quorum.

## Live project

| Service | URL | Purpose |
| --- | --- | --- |
| Project | [sdvn.io](https://sdvn.io) | Public overview |
| Message OApp | [oapp.sdvn.io](https://oapp.sdvn.io) | Wallet-connected Stellar/Sepolia demo |
| Documentation | [docs.sdvn.io](https://docs.sdvn.io) | Architecture, operations, deployments, and evidence |
| Relay API | `https://api.sdvn.io/api` | Testnet delivery orchestration |

## What is implemented

- Bidirectional arbitrary-message delivery between Stellar testnet and Sepolia
- Stellar testnet custom/provider DVN connected to Stellar ULN302
- Soroban and Solidity message OApps with a 1–256 UTF-8 byte payload limit
- MetaMask source authorization on Sepolia and Freighter authorization on Stellar
- Canonical LayerZero packet parsing and route validation
- DVN verification, ULN302 commitment, and destination execution
- Endpoint peer validation and ordered nonce enforcement
- Automatic recovery of authentic missing predecessor packets
- Public explorer links for send, verify, commit, and execute transactions
- A browser application, public landing page, relay API, deployment scripts, and Mintlify documentation

## Technical architecture

LayerZero separates message transport into four security-relevant stages:

```text
                                OFF-CHAIN VERIFICATION
                         ┌──────────────────────────────┐
                         │ Observe canonical PacketSent │
                         │ Apply confirmation policy    │
                         │ Derive header + payload hash │
                         │ Authorize DVN attestation    │
                         └──────────────┬───────────────┘
                                        │
                                        ▼
Source OApp ──► Endpoint V2 ──► Send ULN302
                                        │ cross-chain packet
                                        ▼
                                  Destination DVN
                                        │ verify
                                        ▼
                                  Receive ULN302
                                        │ commit
                                        ▼
                               Destination Endpoint V2
                                        │ ordered execution
                                        ▼
                                Destination Message OApp
```

The DVN attests to packet validity. ULN302 records the verification and determines when the configured security requirements are satisfied. Destination execution remains a separate step and cannot skip the Endpoint's peer, payload-hash, and nonce rules.

### Components

| Component | Responsibility |
| --- | --- |
| Message OApps | Quote and send message bytes, validate inbound delivery, and store message/source metadata |
| Endpoint V2 | Emit outbound packets, maintain pathway nonces, validate committed payloads, and dispatch inbound messages |
| Send ULN302 | Apply the source OApp's outbound security configuration |
| DVN path | Verify the canonical packet header and payload hash and attest to the destination ULN |
| Receive ULN302 | Store DVN verification state and commit a payload after its configured requirements are met |
| Executor | Pay for and initiate destination execution after verification is committed |
| Demo relay | Observe public-testnet packets and orchestrate verification, commitment, execution, and nonce recovery |

### Packet identity

The relay parses the LayerZero packet into:

- packet version
- nonce
- source endpoint ID
- 32-byte source sender
- destination endpoint ID
- 32-byte destination receiver
- GUID
- application message
- payload hash (`keccak256(guid || message)` for the encoded packet layout used here)

It retrieves the packet from the confirmed source transaction instead of trusting packet bytes supplied by the browser. The expected route and receiver are checked before any destination transaction is submitted.

### Address representation

LayerZero peers use fixed 32-byte identifiers:

- An EVM address is left-padded from 20 bytes to 32 bytes.
- A Stellar contract StrKey is decoded to its 32-byte contract ID.
- Each OApp stores the remote peer in the representation expected by its Endpoint.

Current network identifiers:

| Network | LayerZero EID |
| --- | ---: |
| Sepolia | `40161` |
| Stellar testnet | `40600` |

### Sepolia to Stellar

1. MetaMask authorizes `sendMessage` on the Sepolia OApp.
2. Sepolia Endpoint V2 emits `PacketSent`.
3. The relay retrieves the successful receipt, extracts the canonical packet, and validates its route.
4. Missing earlier pathway nonces are discovered from historical Endpoint logs.
5. The Stellar custom DVN authorizes a verification call through Soroban custom-account authorization.
6. Stellar ULN302 commits the verified header and payload hash.
7. The authenticated packet is executed through the Stellar receive path.
8. The Soroban OApp stores the bytes, GUID, source EID, sender, and updated receive count.

### Stellar to Sepolia

1. Freighter authorizes `send_message` on the Soroban OApp.
2. Stellar Endpoint V2 emits `packet_sent`.
3. The relay reads the canonical event from Stellar RPC and validates the route.
4. Missing earlier nonces are recovered from Stellar Endpoint event history.
5. The configured Sepolia test verifier submits `verify` to Receive ULN302.
6. ULN302 `commitVerification` commits the packet.
7. Sepolia Endpoint V2 executes `lzReceive` on the Solidity OApp.
8. The OApp stores the decoded string and its LayerZero origin metadata.

### Ordering and recovery

Delivery is ordered for each `(source EID, source sender, destination receiver)` pathway. Verification may happen out of order, but nonce `N + 1` cannot execute before nonce `N`.

The demo relay scans source-chain history for missing predecessors and processes their authentic packets through verify, commit, and execute before retrying the requested packet. It does not bypass Endpoint state or synthesize destination messages.

### Trust boundary

The source wallet authorizes and pays for the source OApp transaction. The demo relay holds testnet keys used for verification and destination execution. Destination OApps accept delivery only through their configured LayerZero Endpoint and remote peer.

The deployed Sepolia receive path uses a single verifier EOA, and relay state is process-local. The current deployment therefore demonstrates protocol integration, not independent production-grade decentralization.

## Current deployments

### Project contracts

| Network | Component | Address |
| --- | --- | --- |
| Stellar testnet | Message OApp | [`CCJZEMQQ263PRQZ4ZHDELD62DOQKJQEOXF267TOE45PVWQRXCIMDR6WX`](https://stellar.expert/explorer/testnet/contract/CCJZEMQQ263PRQZ4ZHDELD62DOQKJQEOXF267TOE45PVWQRXCIMDR6WX) |
| Stellar testnet | Custom/provider DVN | [`CC76R4VVTLV72V55BCW4A35EZPYOY4CVQTTMVXPYGUFX74LDQDZ7GQC3`](https://stellar.expert/explorer/testnet/contract/CC76R4VVTLV72V55BCW4A35EZPYOY4CVQTTMVXPYGUFX74LDQDZ7GQC3) |
| Sepolia | Message OApp | [`0x4e5cEda4702B5568618F238E735f02F0b149c90F`](https://sepolia.etherscan.io/address/0x4e5cEda4702B5568618F238E735f02F0b149c90F) |
| Sepolia | Test verifier EOA | [`0xAC57cbcd88f4BF925F7BA506bc0eF168F2D68B2B`](https://sepolia.etherscan.io/address/0xAC57cbcd88f4BF925F7BA506bc0eF168F2D68B2B) |

The complete infrastructure inventory and transaction evidence are maintained in:

- [`stellar-dvn-e2e/config/networks.json`](stellar-dvn-e2e/config/networks.json)
- [`documentation/contracts/deployments.mdx`](documentation/contracts/deployments.mdx)
- [`documentation/evidence/deployments.mdx`](documentation/evidence/deployments.mdx)
- [`documentation/evidence/e2e.mdx`](documentation/evidence/e2e.mdx)

## Repository layout

```text
.
├── docs.json                         # Mintlify configuration (repository-root deployment)
├── documentation/                    # Architecture, operations, and explorer evidence
├── stellar-dvn-app/
│   ├── apps/landing/                 # sdvn.io
│   ├── apps/web/                     # oapp.sdvn.io
│   └── apps/relay/                   # Testnet relay/API
├── stellar-dvn-e2e/
│   ├── config/networks.json          # Deployment manifest
│   ├── contracts/StellarMessageOApp.sol
│   ├── contracts/stellar-message/    # Soroban message OApp
│   ├── deploy/                       # EVM deployment
│   ├── scripts/                      # Path configuration and relay utilities
│   └── test/                         # Solidity OApp tests
└── official-layerzero-devtools/      # Pinned upstream Git reference/worktree
```

The deployed custom Stellar DVN is exercised by this repository, but its complete Soroban implementation and audit-oriented test suite must be published or linked as a reproducible dependency before the repository can independently substantiate all DVN contract security claims.

## Run the demo locally

### Requirements

- Node.js 22+
- `pnpm` 11.20.0
- MetaMask configured for Sepolia
- Freighter configured for Stellar testnet
- Sepolia ETH and testnet XLM

### Configure and start

```bash
cd stellar-dvn-app
cp apps/relay/.env.example apps/relay/.env
cp apps/web/.env.example apps/web/.env
```

Fill in the relay's testnet RPC URLs, deployed OApps, scan boundaries, and test-only relay keys. Then run:

```bash
pnpm install
pnpm dev
```

Local services:

| Service | URL |
| --- | --- |
| OApp | `http://localhost:5173` |
| Landing page | `http://localhost:5174` |
| Relay API | `http://localhost:8787` |

Never use production keys in the demo relay or commit `.env` files.

### Validate

```bash
cd stellar-dvn-app
pnpm typecheck
pnpm build

cd ../stellar-dvn-e2e
pnpm test:evm
```

Contract development additionally requires Rust, the Stellar CLI, and the appropriate `wasm32v1-none` target.

## Mintlify deployment

The Mintlify project must use **Repository root** as its docs directory. The default branch contains `docs.json` at the root, and its navigation entries point to pages under `documentation/`.

Do not configure `/documentation` as the Mintlify docs directory unless `docs.json` is also deliberately moved there and every navigation path is made relative to that directory.

## Security properties demonstrated

- Canonical source packet retrieval
- Endpoint and pathway validation
- Remote-peer validation in both OApps
- Packet header and payload-hash verification
- Ordered nonce enforcement
- Exact message preservation
- Replay-aware DVN authorization flow
- Authenticated predecessor recovery
- Public transaction evidence across both networks

These properties are demonstrated on public testnets. They are not a substitute for an audit, a production verifier quorum, or operational SLAs.

## What remains for production

### 1. Establish the production DVN operator

The target grant requires an existing LayerZero V2 DVN already operating on a mainnet pathway. The Stellar work must be integrated into that operator's established verification mechanism and operational infrastructure. If this project is not owned by such an operator, it requires a formal partnership with one.

### 2. Publish a reproducible DVN contract package

- Include or pin the complete Stellar DVN source and supporting crates
- Add deterministic WASM builds and deployed-code hash verification
- Document the exact LayerZero Stellar DVN interface
- Test `__check_auth`, signer thresholds, duplicate signers, high-`s` rejection, replay protection, signer epochs, upgrades, and authorization scope
- Publish resource measurements for reads, writes, instructions, memory, and maximum safe batch size
- Prove TTL extension behavior for instance, persistent, and temporary storage

### 3. Replace the demo relay with production verifier infrastructure

- Autonomous source-chain event watchers instead of browser-triggered jobs
- Durable queues, event cursors, and transactional checkpoints
- Idempotent attestation and restart-safe reconciliation
- Chain-specific finality and reorg policies
- Redundant RPC providers with disagreement detection
- At least two independently deployed verifier nodes
- Distributed coordination that prevents duplicate or conflicting work
- HSM, KMS, or MPC-backed signing rather than raw online environment keys
- Fee estimation, balance monitoring, and automated treasury replenishment

### 4. Add operational security and reliability

- Separate deployer, upgrader, verifier, executor, and treasury roles
- Timelocked upgrades and tested signer rotation
- Rate limits, authentication, bounded retries, and abuse protection
- Cross-region failover and disaster recovery
- Incident response, key-compromise, rollback, and migration runbooks
- Defined uptime, latency, and response-time SLAs
- A minimum 24-month maintenance and post-grant sustainability plan

### 5. Publish telemetry

At minimum, expose a public dashboard with:

- verifications served
- success/error rate
- end-to-end latency p50 and p95
- per-pathway observation and attestation lag
- queue depth and oldest pending packet
- RPC and signer/quorum health
- relayer balances and failed transactions
- Stellar storage TTL headroom

### 6. Complete pathway coverage

Test, deploy, configure, and monitor bidirectional Stellar pathways for:

- Ethereum
- Arbitrum
- Base
- Optimism
- Polygon
- Avalanche
- Solana
- BNB Chain

Each pathway needs deployment manifests, finality policy, integration tests, fee management, public evidence, and an identified operational owner.

### 7. Audit and mainnet launch

- Freeze an audit commit and publish a threat model
- Commission an independent Soroban DVN contract audit
- Remediate findings and publish the final report
- Verify that mainnet WASM matches the audited artifact
- Complete load, chaos, failover, key-rotation, upgrade, and disaster-recovery exercises
- Deploy a guarded Stellar mainnet canary
- Coordinate pathway configuration with LayerZero Labs
- Obtain listing in the official LayerZero DVN provider directory
- Publish an OApp integration guide for adding the DVN to a Stellar Security Stack

## Current versus target state

| Area | Current | Production target |
| --- | --- | --- |
| Networks | Stellar testnet ↔ Sepolia | Stellar mainnet plus required LayerZero mainnet pathways |
| Verifier | Single test verifier/relay identity | Existing production DVN mechanism with independent nodes/quorum |
| Observation | Request-triggered source lookup and historical scans | Continuous, durable, redundant watchers |
| State | In-memory jobs and process-local serialization | Replicated durable queue/database and distributed coordination |
| Keys | Online testnet environment secrets | HSM/KMS/MPC-backed keys with rotation and separation of duties |
| RPC | Configured single endpoints | Redundant independently operated providers |
| Monitoring | UI transaction progress and explorer evidence | Public metrics, SLOs, alerts, and incident reporting |
| Security | Public-testnet validation | Independent audit, remediation, and audited-artifact verification |
| Operations | Demo service | 24-month SLA-backed production operation |

## Documentation

Start with the [documentation home](documentation/index.mdx), then review:

- [Architecture overview](documentation/architecture/overview.mdx)
- [Message lifecycle](documentation/architecture/message-lifecycle.mdx)
- [Contract deployments](documentation/contracts/deployments.mdx)
- [Cross-chain configuration](documentation/operations/configuration.mdx)
- [End-to-end evidence](documentation/evidence/e2e.mdx)
- [Security and production readiness](documentation/security.mdx)

## License

The application workspace is licensed under the terms in [`stellar-dvn-app/LICENSE`](stellar-dvn-app/LICENSE). Review upstream and contract dependency licenses separately before production distribution.
