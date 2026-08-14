import assert from "node:assert/strict";
import { ethers } from "hardhat";

async function expectRevert(action: Promise<unknown>, reason: string) {
  try {
    await action;
    assert.fail(`expected ${reason} revert`);
  } catch (error) {
    assert.match(String(error), new RegExp(reason));
  }
}

describe("StellarMessageOApp", () => {
  async function deployHarness() {
    const endpointFactory = await ethers.getContractFactory("MockEndpoint");
    const endpoint = await endpointFactory.deploy();
    const factory = await ethers.getContractFactory("StellarMessageOAppHarness");
    return factory.deploy(await endpoint.getAddress());
  }

  it("stores the exact received message and origin metadata", async () => {
    const oapp = await deployHarness();
    const sender = ethers.zeroPadValue("0x1234", 32);
    const guid = ethers.keccak256(ethers.toUtf8Bytes("guid"));

    await oapp.exposedReceive({ srcEid: 40600, sender, nonce: 7 }, guid, ethers.toUtf8Bytes("invoice-2048"), "0x");

    assert.equal(await oapp.lastMessage(), "invoice-2048");
    assert.equal(await oapp.lastSourceEid(), 40600n);
    assert.equal(await oapp.lastSender(), sender);
    assert.equal(await oapp.lastGuid(), guid);
    assert.equal(await oapp.receivedMessageCount(), 1n);
  });

  it("rejects empty and oversized destination messages", async () => {
    const oapp = await deployHarness();
    const origin = { srcEid: 40600, sender: ethers.ZeroHash, nonce: 1 };

    await expectRevert(oapp.exposedReceive(origin, ethers.ZeroHash, "0x", "0x"), "EmptyMessage");
    await expectRevert(oapp.exposedReceive(origin, ethers.ZeroHash, new Uint8Array(257), "0x"), "MessageTooLong");
  });
});
