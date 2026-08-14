import type { DeployFunction } from 'hardhat-deploy/types'

const deploy: DeployFunction = async ({ deployments, getNamedAccounts }) => {
  const { deployer } = await getNamedAccounts()
  if (!deployer) throw new Error('EVM_PRIVATE_KEY is required')

  // Official LayerZero EndpointV2 on Ethereum Sepolia.
  const endpoint = '0x6EDCE65403992e310A62460808c4b910D972f10f'
  await deployments.deploy('StellarMessageOApp', {
    from: deployer,
    args: [endpoint, deployer],
    log: true,
    waitConfirmations: 2,
  })
}

deploy.tags = ['StellarMessageOApp']
export default deploy
