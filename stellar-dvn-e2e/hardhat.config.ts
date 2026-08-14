import 'dotenv/config'
import 'hardhat-deploy'
import '@nomicfoundation/hardhat-ethers'

import type { HardhatUserConfig } from 'hardhat/config'

const privateKey = process.env.EVM_PRIVATE_KEY

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.22',
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  networks: {
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com',
      accounts: privateKey ? [privateKey] : [],
    },
  },
  namedAccounts: { deployer: { default: 0 } },
}

export default config
