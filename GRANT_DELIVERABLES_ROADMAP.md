# Stellar-Compatible LayerZero DVN Grant Deliverables Roadmap

## Purpose

This document defines the implementation and delivery plan for extending a LayerZero V2 DVN service to Stellar testnet and mainnet. It translates the grant requirements into concrete work packages, acceptance criteria, evidence, dependencies, and launch gates.

Eligibility and applicant qualification are outside the scope of this roadmap. The plan assumes that the project will use an appropriate production verification mechanism and focuses on completing the Stellar technical, security, operational, pathway, documentation, and maintenance deliverables.

## Target outcome

The completed service will provide:

- a LayerZero-compatible Soroban DVN contract on Stellar testnet and mainnet;
- autonomous off-chain verification of messages originating from and destined for Stellar;
- bidirectional support between Stellar and Ethereum, Arbitrum, Base, Optimism, Polygon, Avalanche, Solana, and BNB Chain;
- production key custody, redundant infrastructure, durable processing, monitoring, and incident response;
- an audited and reproducible mainnet contract release;
- official LayerZero DVN provider-directory listings for supported Stellar pathways;
- public OApp integration documentation and operational telemetry; and
- at least 24 months of maintained operation.

## Current baseline

The repository currently demonstrates:

- bidirectional LayerZero messaging between Stellar testnet and Sepolia;
- a deployed Stellar testnet DVN at `CC76R4VVTLV72V55BCW4A35EZPYOY4CVQTTMVXPYGUFX74LDQDZ7GQC3`;
- Stellar Endpoint V2 and ULN302 integration;
- the official-style Soroban Abstract Account authorization flow using `hash_call_data` and `execute_transaction`;
- canonical packet extraction, header parsing, payload hashing, route validation, verification, commit, and execution;
- ordered nonce recovery;
- public transaction evidence;
- an EVM and Stellar message OApp demonstration; and
- published contract, reference, application, and documentation repositories.

The current implementation remains a testnet prototype. Important limitations include request-triggered relay processing, online application keys, process-local job state, a single demonstrated remote pathway, no public operational dashboard, no independent audit, no mainnet deployment, and unresolved byte-for-byte provenance for the existing deployed DVN WASM.

## Delivery principles

All deliverables must follow these rules:

1. **Canonical source data:** verification must start from confirmed source-chain `PacketSent` events, never browser-supplied packet bytes.
2. **Assignment awareness:** a worker must verify that its DVN was assigned and paid before serving a job.
3. **Configuration awareness:** confirmation and destination requirements must be read from the active LayerZero configuration.
4. **Idempotency:** observation, signing, submission, and reconciliation must tolerate retries and restarts without conflicting verification.
5. **Reproducibility:** every deployed contract must map to an immutable source commit and byte-identical build artifact.
6. **Separation of roles:** verification, submission, execution, administration, upgrades, and treasury must have distinct security boundaries.
7. **Evidence before claims:** a pathway is supported only after its contract addresses, configurations, transactions, monitoring, and recovery tests are published.
8. **Testnet before mainnet:** no mainnet activation occurs before testnet acceptance, audit remediation, production operations testing, and a guarded canary.

## Workstream A: canonical Soroban DVN contract

### A1. Freeze the LayerZero-compatible interface

Use the official-compatible Stellar DVN implementation as the LayerZero-facing baseline. Preserve the expected interfaces and call semantics for:

- `get_fee`;
- `assign_job`;
- `hash_call_data`;
- `execute_transaction`;
- `__check_auth`;
- Worker configuration;
- signer and threshold management;
- fee-library and price-feed configuration;
- allowlist and denylist behavior;
- pause and administration controls;
- destination configuration; and
- ReceiveULN302 `verify` invocation.

The independent `layerzero-stellar/contracts/sdvn` design must not be represented as the deployed contract unless it is redesigned for exact protocol compatibility, audited, deployed, and independently evidenced.

**Acceptance criteria**

- Contract ABI/spec matches the deployed Stellar LayerZero MessageLib expectations.
- SendULN302 can call `get_fee` and `assign_job` successfully.
- Signed `execute_transaction` calls can authorize ReceiveULN302 verification without reentrancy.
- All interfaces are covered by integration tests against the pinned protocol contracts.

### A2. Address representation

Implement and test conversions between LayerZero `bytes32` identifiers and Stellar addresses.

Required cases:

- EVM 20-byte address left-padding;
- Stellar contract StrKey decoding;
- Stellar account versus contract addresses;
- invalid checksum and invalid-length rejection;
- Soroban, Solidity, and TypeScript round trips; and
- fixed cross-environment packet fixtures.

**Evidence**

- Unit tests in Rust and TypeScript.
- Fixed vectors generated from EVM `abi.encodePacked`.
- A short address-format specification in the integration guide.

### A3. TTL-safe storage

Define and implement a storage-lifetime policy for:

- instance state;
- signer and threshold configuration;
- Worker and destination configuration;
- replay records;
- upgrade state; and
- temporary processing data.

**Acceptance criteria**

- Critical state cannot silently expire under the documented maintenance policy.
- TTL-extension operations remain safe after low traffic and long inactivity.
- Replay records live at least as long as the maximum accepted authorization lifetime.
- TTL behavior is tested with advanced ledger sequences.
- Monitoring exposes TTL headroom and failed maintenance operations.

### A4. Soroban resource profiling

Profile normal and worst-case flows against current network limits.

Measure:

- CPU instructions;
- memory;
- footprint keys;
- disk reads and bytes;
- disk writes and bytes;
- transaction size;
- event and return-value size;
- signer quorum sizes; and
- batch sizes.

**Acceptance criteria**

- Published test results for minimum, expected, and maximum supported quorum.
- A documented maximum safe batch size.
- Transactions remain below defined safety margins, not merely below hard network limits.
- CI fails when resource use exceeds the approved budget.

### A5. Reproducible build and deployment

Create a deterministic build pipeline containing:

- exact Rust and Stellar CLI versions;
- pinned dependencies and `Cargo.lock`;
- containerized build environment;
- optimization tooling and versions;
- source-path remapping;
- release tag;
- artifact checksums; and
- an automated on-chain comparison.

**Acceptance criteria**

- Two clean environments produce identical WASM.
- Uploaded WASM hash exactly equals the published release artifact hash.
- Contract ID, deployment transactions, constructor arguments, and configuration transactions are included in a signed manifest.
- CI verifies the release artifact before deployment.

The existing `CC76...GQC3` deployment may remain historical evidence, but a new reproducible testnet deployment should be used if its original build cannot be reconstructed exactly.

## Workstream B: autonomous off-chain verifier

### B1. Service decomposition

Replace the demonstration relay with production-shaped services:

- source-chain observers;
- job-assignment indexer;
- finality evaluator;
- verification/proof workers;
- quorum or proof coordinator;
- destination submitters;
- reconciliation worker;
- fee and treasury monitor; and
- public API and telemetry service.

Browser applications may display and query jobs but must not be required to trigger verification.

### B2. Durable job model

Implement a persistent state machine:

```text
Observed
  -> Assigned
  -> AwaitingFinality
  -> VerificationReady
  -> QuorumReached
  -> Submitted
  -> DestinationConfirmed
  -> Reconciled
```

Each job should record:

- source chain and EID;
- source block/ledger and transaction;
- event index or cursor;
- packet header;
- GUID and payload hash;
- sender and receiver;
- nonce;
- destination chain and MessageLib;
- required confirmations;
- assignment and fee evidence;
- signer/proof status;
- submission transaction;
- retry history; and
- terminal reconciliation state.

**Acceptance criteria**

- Transactional state updates.
- Unique constraints prevent duplicate canonical jobs.
- At-least-once processing is safe.
- Workers use leases or another concurrency-safe claim mechanism.
- Restarts recover all unfinished work.
- Dead-letter and manual replay procedures exist.
- Database backup, restore, and schema migrations are tested.

### B3. Stellar observer

Implement a continuous Stellar observer that:

- scans Endpoint V2 events from a durable cursor;
- decodes `packet_sent` events;
- reconstructs canonical packet fields;
- detects ledger gaps and RPC inconsistencies;
- applies Stellar finality policy;
- backfills history after downtime; and
- reconciles observations across redundant RPC providers.

### B4. Remote-chain observers

Implement adapters for:

- Ethereum;
- Arbitrum;
- Base;
- Optimism;
- Polygon;
- Avalanche;
- Solana; and
- BNB Chain.

Each adapter must define event decoding, finality, reorg handling, historical backfill, RPC failover, and canonical transaction identification.

### B5. Assignment, payment, and configuration checks

Before verification, the worker must:

1. Confirm the DVN appears in the job/fee assignment.
2. Confirm the required payment or fee allocation.
3. Resolve the destination Receive MessageLib.
4. Read the current ULN configuration.
5. Enforce the configured confirmation requirement.
6. Check whether verification is already recorded.
7. Recheck verification after submission.

**Acceptance criteria**

- Unassigned jobs are never signed.
- Underconfirmed jobs remain pending.
- Configuration changes during processing are handled deterministically.
- Duplicate processing terminates safely after the idempotency check.

### B6. Finality and reorg policy

Publish a per-chain policy covering:

- minimum confirmations or commitment level;
- finality assumptions;
- temporary and permanent forks;
- chain halts;
- RPC disagreement;
- orphaned events;
- pending-job reevaluation; and
- emergency suspension.

Tests must simulate shallow and deep reorgs, delayed finality, chain stalls, and conflicting RPC responses.

### B7. Verification mechanism integration

Integrate the intended production verification mechanism without weakening it for Stellar.

For a multisignature mechanism, deliver:

- independently deployed signer nodes;
- threshold greater than one for production;
- signer discovery and health monitoring;
- duplicate-signer protection;
- rotation and revocation;
- version and policy agreement; and
- auditable signing decisions.

For ZK, TEE, light-client, or native-bridge mechanisms, publish the corresponding proof-generation, verification, trust, upgrade, and failure model.

### B8. Destination submission

When Stellar is the destination, the service must:

- construct the exact Soroban call tree;
- compute `hash_call_data`;
- collect valid verifier approvals;
- construct the custom-account authorization entry;
- simulate with completed authorization;
- submit `execute_transaction`;
- call ReceiveULN302 `verify`; and
- confirm the verification state.

When another chain is the destination, the service must invoke the provider's corresponding DVN contract and confirm that the destination MessageLib recorded the attestation.

### B9. Fee and treasury operations

Implement:

- fee quotation validation;
- destination gas and token price inputs;
- configured fee margins;
- XLM and remote-chain balance monitoring;
- low-balance alerts;
- bounded automated replenishment;
- fee withdrawal and accounting;
- per-pathway cost and revenue reporting; and
- emergency spend limits.

## Workstream C: pathway coverage

### Required launch matrix

Support both directions for:

| Pathway | Testnet | Mainnet |
| --- | --- | --- |
| Stellar <-> Ethereum | Required | Required |
| Stellar <-> Arbitrum | Required | Required |
| Stellar <-> Base | Required | Required |
| Stellar <-> Optimism | Required | Required |
| Stellar <-> Polygon | Required | Required |
| Stellar <-> Avalanche | Required | Required |
| Stellar <-> Solana | Required | Required |
| Stellar <-> BNB Chain | Required | Required |

### Per-pathway definition of done

Every advertised pathway requires:

- DVN contract addresses on both networks;
- source and destination EIDs;
- Endpoint and MessageLib addresses;
- send and receive configuration;
- Executor configuration;
- fee configuration;
- finality and confirmation policy;
- bidirectional source transactions;
- DVN verification transactions;
- ULN commit evidence;
- destination execution evidence;
- LayerZero Scan evidence;
- skipped-nonce and recovery test;
- monitoring labels and alerts;
- named operational owner; and
- a rollback or disable procedure.

Pathways must not rely on unresolved defaults or Dead DVNs. Send and receive configurations must be read back from chain and compared with the intended manifest.

## Workstream D: testing and quality assurance

### D1. Contract tests

- LayerZero interface conformance.
- Worker configuration and ACL behavior.
- Fee calculation and overflow behavior.
- Signer set and quorum validation.
- Invalid, duplicate, and malformed signatures.
- High-`s` and recovery-ID handling.
- Authorization expiration and replay prevention.
- VID and invocation-scope enforcement.
- Pause, administration, and upgrade controls.
- TTL extension and expiry.
- Packet and address conversion.
- ReceiveULN302 call correctness and atomic rollback.

### D2. Worker tests

- Event parsing and canonical packet reconstruction.
- Assignment and payment filtering.
- Finality transitions.
- Reorg recovery.
- RPC failover and disagreement.
- Duplicate delivery and idempotency.
- Database restart and replay.
- Partial quorum and signer outage.
- Transaction replacement and submission failure.
- Treasury depletion.
- Configuration changes while jobs are pending.

### D3. End-to-end tests

- Both directions on every required testnet pathway.
- Exact payload preservation.
- Ordered and out-of-order nonces.
- Missing predecessor recovery.
- Maximum supported payload and batch sizes.
- Contract pause and resume.
- Signer rotation.
- Contract upgrade and rollback.
- Multiple simultaneous pathways.
- Sustained load and backlog recovery.

### D4. Reliability tests

- Node termination during every job state.
- Database failover.
- Region outage.
- Primary RPC outage.
- Conflicting RPC responses.
- Signer quorum loss.
- Destination-chain congestion.
- Chain halt and recovery.
- Backup restoration and disaster recovery.

## Workstream E: production security

### E1. Key custody

- Use HSM, KMS, MPC, or an isolated signer service.
- Separate testnet and mainnet keys.
- Separate verifier, submitter, administrator, upgrader, and treasury keys.
- Prevent public API processes from reading raw verifier keys.
- Record signing decisions in tamper-evident audit logs.
- Test rotation, revocation, loss, and compromise procedures.

### E2. Governance and role separation

Define separate roles for:

- deployer;
- owner/governance;
- upgrader;
- DVN administrator;
- verifier signer;
- destination submitter;
- treasury;
- Executor; and
- emergency guardian.

Mainnet ownership should use multisig governance and an appropriate upgrade delay.

### E3. Threat model

Document threats involving:

- forged or omitted source events;
- malicious or compromised signers;
- quorum capture;
- RPC manipulation;
- reorgs and inconsistent finality;
- signature replay;
- authorization-scope errors;
- contract upgrades;
- TTL eviction;
- fee manipulation;
- treasury exhaustion;
- queue corruption;
- operator collusion; and
- denial of service.

### E4. Independent audit

Audit scope must cover:

- Soroban DVN contract;
- Abstract Account authentication;
- signature/proof verification;
- Worker and fee configuration;
- TTL behavior;
- address and packet encoding;
- ReceiveULN302 integration;
- upgrade mechanism;
- deployment scripts;
- Stellar observer;
- finality and reorg handling;
- verifier/signing service;
- destination submitters;
- durable queue and reconciliation; and
- key-management integration.

**Mainnet gate**

- Frozen audit commit.
- Published final report.
- All critical and high findings remediated.
- Auditor verification of remediation.
- Accepted residual risks documented.
- Final audited source produces the exact mainnet WASM.

## Workstream F: operations and reliability

### F1. Infrastructure

Deploy at least two verifier nodes with:

- separate failure domains;
- redundant RPC providers;
- RPC disagreement detection;
- infrastructure as code;
- immutable versioned deployments;
- automated health checks;
- zero-downtime upgrades;
- centralized structured logs;
- encrypted backups; and
- tested disaster recovery.

### F2. Service objectives

Publish service objectives for:

- monthly uptime;
- observation latency;
- attestation latency p50, p95, and p99;
- maximum pending-job age;
- incident acknowledgement;
- recovery time objective;
- recovery point objective; and
- scheduled maintenance notice.

### F3. Runbooks

Required runbooks include:

- RPC outage;
- source-chain reorg;
- chain halt;
- signer outage and quorum loss;
- key compromise;
- suspected incorrect attestation;
- contract pause;
- treasury depletion;
- database corruption;
- queue backlog;
- duplicate submission;
- Stellar TTL emergency;
- contract upgrade and rollback;
- pathway disablement; and
- incident disclosure and postmortem.

## Workstream G: public telemetry

Publish a dashboard and machine-readable metrics endpoint containing:

- packets observed;
- assigned jobs;
- jobs awaiting finality;
- successful verifications;
- failed and retried verifications;
- error rate;
- end-to-end latency p50, p95, and p99;
- queue depth;
- oldest pending job;
- per-pathway observation and attestation lag;
- signer-node health and current quorum;
- RPC health and disagreement;
- submitter balances;
- contract pause state;
- TTL headroom;
- deployed software version; and
- supported pathway status.

Also publish a status page, incident history, and links to representative LayerZero Scan transactions.

## Workstream H: documentation and integration

### H1. OApp integration guide

Document:

- provider and verification-mechanism overview;
- trust assumptions;
- testnet and mainnet contract addresses;
- supported EIDs and pathways;
- fees and confirmation requirements;
- required and optional DVN configuration;
- sorted-address requirements;
- send and receive configuration;
- Executor configuration;
- Stellar `bytes32` conversions;
- CLI, Soroban, and EVM examples;
- configuration inspection;
- testnet walkthrough;
- monitoring links;
- troubleshooting;
- migration and removal; and
- operational and incident contacts.

Provide a runnable reference OApp configured to use the DVN.

### H2. Evidence registry

For every release and pathway, publish:

- source commit and release tag;
- build environment;
- WASM or bytecode hash;
- deployment and configuration manifests;
- explorer transactions;
- test reports;
- resource profiles;
- audit status;
- monitoring links; and
- current operational owner.

### H3. Official LayerZero listing

Coordinate provider metadata with LayerZero Labs and verify that:

- the provider appears in the official DVN directory;
- Stellar testnet and mainnet addresses are correct;
- remote-chain DVN addresses are correct;
- all advertised EIDs and pathways are present;
- LayerZero tooling resolves the provider; and
- a clean OApp can quote, configure, send, verify, commit, and execute using the published metadata.

Listing is complete only when it is live in the official provider directory, not when a request has merely been submitted.

## Workstream I: mainnet deployment and rollout

### I1. Mainnet readiness gate

Mainnet deployment requires:

- all required testnet pathways passing;
- reproducible contract artifacts;
- completed audit and remediation;
- production key custody;
- at least two operational nodes;
- tested failover and disaster recovery;
- public monitoring and on-call alerting;
- funded submitter and treasury accounts;
- approved governance and upgrade controls; and
- signed launch and rollback plans.

### I2. Mainnet deployment evidence

Publish:

- Stellar mainnet contract ID;
- source commit and release tag;
- exact on-chain WASM hash;
- upload and creation transactions;
- constructor parameters;
- signer set and threshold;
- VID;
- administrators and upgrader;
- ReceiveULN302 and supported MessageLibs;
- fee library and price feed;
- destination and TTL configurations; and
- remote-chain DVN addresses.

### I3. Guarded activation

Use staged activation:

1. Internal canary.
2. Allowlisted OApps.
3. Low-volume public beta.
4. Limited-value production.
5. Full advertised production.

Each stage must have measurable promotion, pause, rollback, and incident criteria.

## Workstream J: maintenance and sustainability

Publish a 24-month operating plan covering:

- responsible legal or operating entity;
- engineering and on-call staffing;
- infrastructure and RPC budget;
- signer and key-custody costs;
- audit and security budget;
- treasury and replenishment policy;
- fee revenue and post-grant funding;
- software and dependency updates;
- Stellar protocol upgrades;
- LayerZero MessageLib upgrades;
- SLA reporting;
- pathway expansion;
- vulnerability disclosure;
- long-term ownership; and
- orderly migration or decommissioning.

## Milestone roadmap

### Milestone 1: protocol baseline and reproducibility

**Deliverables**

- Canonical official-compatible DVN source selected.
- Interface-conformance tests complete.
- Address and packet fixtures complete.
- TTL policy implemented and tested.
- Resource budgets published.
- Deterministic build pipeline operational.
- New reproducible Stellar testnet contract deployed.

**Exit gate**

- Clean rebuild hash equals the deployed testnet WASM hash.

### Milestone 2: production-shaped testnet worker

**Deliverables**

- Autonomous Stellar and remote-chain observers.
- Assignment/payment filtering.
- Per-chain finality policy.
- Durable job database and reconciliation.
- Verification mechanism integrated.
- Stellar and remote destination submitters.
- At least two independently deployed worker nodes.

**Exit gate**

- Jobs complete without browser initiation and survive process, node, and RPC failures.

### Milestone 3: required testnet pathway matrix

**Deliverables**

- Bidirectional testnet support for all eight required ecosystems.
- Per-pathway fee and confirmation configuration.
- Explorer and LayerZero Scan evidence.
- Failure and nonce-recovery tests.
- Machine-readable deployment manifest.

**Exit gate**

- Every pathway satisfies the per-pathway definition of done.

### Milestone 4: operations and public telemetry

**Deliverables**

- Public dashboard, metrics endpoint, and status page.
- Alerts and on-call coverage.
- Treasury automation and balance controls.
- Operational SLAs.
- Incident, recovery, upgrade, and rollback runbooks.
- Load, soak, failover, and disaster-recovery reports.

**Exit gate**

- Testnet operates continuously for an agreed observation window while meeting published service objectives.

### Milestone 5: security audit

**Deliverables**

- Frozen audit commit and threat model.
- Independent contract and infrastructure audit.
- Remediation commits.
- Final audit report and auditor confirmation.
- Reproducible audited release artifact.

**Exit gate**

- No unresolved critical or high-severity findings.

### Milestone 6: guarded mainnet launch

**Deliverables**

- Audited Stellar mainnet DVN deployment.
- Production remote-chain deployment/configuration.
- HSM/KMS/MPC-backed key custody.
- Mainnet canary pathways.
- Public mainnet telemetry.
- Rollback and emergency controls verified.

**Exit gate**

- Bidirectional canaries complete and reconcile on every required mainnet pathway.

### Milestone 7: official provider listing

**Deliverables**

- LayerZero provider metadata submitted and reviewed.
- Testnet and mainnet addresses published.
- Supported pathway matrix published.
- OApp integration guide and runnable sample released.
- Official DVN provider-directory listing live.

**Exit gate**

- A fresh OApp can select the listed provider through LayerZero tooling and complete messages on every advertised pathway.

### Milestone 8: maintained production operation

**Deliverables**

- Monthly service and pathway reports.
- Public incident reporting.
- Security and dependency maintenance.
- Pathway expansion as supported deployments grow.
- At least 24 months of maintained Stellar service.

## Deliverable evidence checklist

The final grant evidence package should contain:

- [ ] Stellar testnet DVN contract and exact source/WASM proof.
- [ ] Production-shaped testnet verifier running on at least two nodes.
- [ ] Eight bidirectional testnet pathways.
- [ ] Public testnet telemetry and reliability report.
- [ ] Complete contract and worker test suites.
- [ ] Soroban resource and TTL report.
- [ ] Threat model and independent audit.
- [ ] Remediation report and final audited release.
- [ ] Stellar mainnet DVN contract and exact source/WASM proof.
- [ ] Eight bidirectional mainnet pathways.
- [ ] Production key custody and role separation.
- [ ] Public mainnet telemetry, status page, and SLAs.
- [ ] Operational and incident-response runbooks.
- [ ] Official LayerZero DVN provider listing.
- [ ] OApp integration guide and runnable example.
- [ ] Deployment, configuration, and transaction evidence registry.
- [ ] Signed 24-month maintenance and sustainability plan.

## Immediate implementation backlog

1. Freeze the official-compatible Stellar DVN baseline.
2. Build a deterministic artifact pipeline and redeploy testnet from a tagged release.
3. Design the durable worker database and job state machine.
4. Extract the current relay's packet parsing into tested chain-adapter libraries.
5. Implement autonomous Stellar observation and backfill.
6. Implement assignment/payment and configuration-aware processing.
7. Integrate the intended production verification mechanism and key custody.
8. Implement idempotent Stellar and remote destination submitters.
9. Deploy two testnet worker nodes with redundant RPC providers.
10. Publish the first operational dashboard.
11. Complete one production-shaped reference pathway end to end.
12. Expand through the required eight-pathway testnet matrix.
13. Complete resource, load, chaos, upgrade, and disaster-recovery testing.
14. Freeze the audit scope and commission the audit.
15. Remediate findings and publish the audited release.
16. Deploy and canary Stellar mainnet.
17. Activate all required mainnet pathways.
18. Complete LayerZero metadata integration and official listing.
19. Begin the 24-month reporting and maintenance program.

