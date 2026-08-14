# Stellar ↔ Sepolia message OApps

This harness contains new bidirectional LayerZero V2 OApps that carry an arbitrary UTF-8 message rather than a counter command.

```text
source wallet -> source OApp -> Endpoint / PacketSent
              -> custom DVN verification -> ULN302 commit
              -> destination Endpoint -> destination OApp stores message
```

The DVN remains payload-agnostic. Both OApps enforce a 1–256 byte payload boundary and expose the last message, source metadata, GUID, and received-message count.

## Deployed testnet contracts

| Network | Contract | Address |
| --- | --- | --- |
| Stellar testnet | Message OApp | `CCJZEMQQ263PRQZ4ZHDELD62DOQKJQEOXF267TOE45PVWQRXCIMDR6WX` |
| Sepolia | Message OApp | `0x4e5cEda4702B5568618F238E735f02F0b149c90F` |

The Stellar contract was deployed at ledger `4,141,874`. Both peers are set, both sides use ULN302, the Stellar OApp requires custom DVN `CC76...GQC3` for send and receive, and the Sepolia OApp requires verifier `0xAC57...8B2B` for receive.

## Successful live validation

Sepolia → Stellar:

- Message: `Deployed message OApp: Sepolia to Stellar`
- Source: `0x121216aa26c15f93038c43c97a7ce7184ed1b5cec459f3ebe350fa6d3ac90fdf`
- GUID: `0xc74c7ffa12d36f42e46aa8bad5f64488b8e56a5c8f5e2c3e009e515827504af5`
- DVN verification: `0b86036239c1d014c98797929bd221b17413d080e2dd9714167919ff0bdcc983`
- ULN commit: `156a9e096092081019fcf07651f77f6e847059f2ec9a788a2d7ba8c7562b16f0`
- Destination execution: `f5bf67aab46b94be6b72281859b08553526594eb136f0ed1139f0dd6241fa06f`

Stellar → Sepolia:

- Message: `Deployed message OApp: Stellar to Sepolia`
- Source: `320d674ca60f2271b9ed9ba6369474cbccba2df5d097ec90992b48149ab3501f`
- GUID: `0x7e1f2002f61cb1c8f52ca828fb2f8733596a9f35cef55416644a5cedd510650a`
- DVN verification: `0xe95af3796a028e34320471edec12c293dd2fc067cf7c7f7b04952033a9c76cea`
- ULN commit: `0x3867824b338132a821a78438c70dfd8ddd1f48d5eaea4f0f3e43cf81320ed3b9`
- Destination execution: `0xec4dc8ac814e5c9cd41d291bfb0fc8deb498e73bb45e59ba18817e0cf9bc94ba`

## Contracts

- `contracts/StellarMessageOApp.sol`: Sepolia message sender/receiver.
- `contracts/stellar-message`: Soroban message sender/receiver.
- `contracts/StellarCounterSender.sol`: retained historical source; it is not used by the new deployment.

## Build

```bash
pnpm install
pnpm compile:evm
pnpm compile:stellar-message
```

The Stellar WASM is emitted below `contracts/stellar-message/target/wasm32v1-none/release/`.

## Deployment sequence

1. Deploy `StellarMessageOApp` on Sepolia with `pnpm deploy:sepolia`.
2. Upload and deploy the Stellar message WASM. Its constructor arguments are owner, official Stellar Endpoint V2, and delegate.
3. Set the Sepolia peer to the 32-byte Stellar contract ID with `SEPOLIA_MESSAGE_OAPP` and `STELLAR_MESSAGE_CONTRACT_ID` followed by `pnpm configure:sepolia-peer`.
4. Set the Stellar peer for EID 40161 to the Sepolia OApp address left-padded to 32 bytes.
5. Configure the Sepolia OApp ReceiveULN302 path to require the test verifier using `SEPOLIA_MESSAGE_OAPP=0x... pnpm configure:sepolia-receive-dvn`.
6. Configure the Stellar OApp send/receive libraries and required custom DVN exactly as in the proven counter pathway.
7. Put both new addresses and the Stellar deployment ledger into `../stellar-dvn-app/apps/relay/.env`.

Never commit deployment, relay, or verifier keys.

## Direct Sepolia send

```bash
SEPOLIA_MESSAGE_OAPP=0x... MESSAGE='Hello Stellar' pnpm send:sepolia-message
```

The full web application is the preferred end-to-end driver because it validates that the destination-stored message equals the canonical packet payload.

## Previous testnet evidence

The successful counter-based testnet evidence and complete prior app/harness are preserved in `../backups/stellar-message-prechange-20260814`.
