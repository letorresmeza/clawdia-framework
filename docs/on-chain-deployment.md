# On-Chain Deployment Guide

This guide covers the Phase 2 Base deployment flow for escrow settlement and the agent staking registry.

## Prerequisites

- Node.js 20+
- `pnpm install`
- Base RPC URL
- A funded deployer wallet
- USDC address for the target network

## Environment

Set the following environment variables before deploying:

```bash
export DEPLOYER_PRIVATE_KEY=0x...
export BASE_SEPOLIA_RPC=https://sepolia.base.org
export USDC_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e
export DISPUTE_TIMEOUT_HOURS=24
export MIN_STAKE_USDC=10
export UNSTAKE_COOLDOWN_HOURS=24
```

For Base mainnet, set:

```bash
export BASE_MAINNET_RPC=https://mainnet.base.org
export USDC_ADDRESS=<base-mainnet-usdc>
```

Update `contracts/hardhat.config.ts` with your preferred Base mainnet RPC if you want a named `baseMainnet` network entry.

## Deploy

Compile and test first:

```bash
pnpm --filter @clawdia/contracts compile
pnpm --filter @clawdia/contracts test
```

Deploy to Base Sepolia:

```bash
pnpm --filter @clawdia/contracts deploy:baseSepolia
```

The deploy script writes a deployment file to `contracts/deployments/<network>.json` with:

- `escrowFactory`
- `agentRegistry`
- `usdc`
- `minimumStakeUnits`
- `unstakeCooldownSeconds`

## CLI Wallet Setup

Create a local wallet for funding and provider payouts:

```bash
clawdia wallet create operator --default
clawdia wallet list
```

Import an existing deployer or treasury wallet:

```bash
clawdia wallet import treasury --private-key 0x...
```

## Recommended Mainnet Checklist

Before switching to Base mainnet:

- Verify the final USDC token address from Circle/Base documentation
- Fund the deployer wallet with ETH for gas
- Set a production dispute timeout and minimum stake
- Transfer `EscrowFactory` and `AgentRegistry` ownership to your operator multisig
- Register provider payout wallets before routing production settlement
- Enable NATS JetStream in `clawdia.yaml`

## JetStream Config

Use durable delivery in `clawdia.yaml`:

```yaml
nats:
  url: nats://localhost:4222
  jetstream:
    enabled: true
    streamName: CLAWDIA
    subjectPattern: ">"
    consumerPrefix: clawdia
    ackWaitMs: 30000
    maxDeliver: 5
```
