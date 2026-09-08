/**
 * Setup real Hedera testnet accounts for ShelfSign x402 + HCS.
 * Expects keys already funded via portal faucet (hollow → complete).
 *
 * Usage:
 *   HEDERA_OPERATOR_KEY=0x… HEDERA_OPERATOR_EVM=0x… \
 *   HEDERA_AGENT_KEY=0x… HEDERA_AGENT_EVM=0x… \
 *   npx tsx scripts/setup-hedera-onchain.ts
 */
import "dotenv/config";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  AccountId,
  Client,
  Hbar,
  PrivateKey,
  TopicCreateTransaction,
  TransferTransaction,
  AccountBalanceQuery,
} from "@hashgraph/sdk";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

function parseKey(raw: string): PrivateKey {
  return raw.startsWith("0x")
    ? PrivateKey.fromStringECDSA(raw)
    : PrivateKey.fromString(raw);
}

async function resolveAccountId(evmOrId: string): Promise<string> {
  if (evmOrId.startsWith("0.0.")) return evmOrId;
  const url = `https://testnet.mirrornode.hedera.com/api/v1/accounts/${evmOrId}`;
  for (let i = 0; i < 20; i++) {
    const res = await fetch(url);
    if (res.ok) {
      const body = (await res.json()) as { account?: string };
      if (body.account) return body.account;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Could not resolve account for ${evmOrId}`);
}

async function completeHollowAccount(
  accountId: string,
  key: PrivateKey,
): Promise<void> {
  const client = Client.forTestnet();
  client.setOperator(AccountId.fromString(accountId), key);
  try {
    // Self-transfer 1 tinybar completes the hollow account (sets key).
    const tx = await new TransferTransaction()
      .addHbarTransfer(accountId, Hbar.fromTinybars(-1))
      .addHbarTransfer(accountId, Hbar.fromTinybars(1))
      .execute(client);
    await tx.getReceipt(client);
    console.log(`Completed hollow account ${accountId}`);
  } finally {
    client.close();
  }
}

function upsertEnv(vars: Record<string, string>) {
  const envPath = resolve(process.cwd(), ".env");
  let text = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  for (const [key, value] of Object.entries(vars)) {
    const re = new RegExp(`^${key}=.*$`, "m");
    if (re.test(text)) text = text.replace(re, `${key}=${value}`);
    else text += `\n${key}=${value}\n`;
  }
  writeFileSync(envPath, text);
  console.log(`Updated ${envPath}`);
}

async function main() {
  const opKey = parseKey(requireEnv("HEDERA_OPERATOR_KEY"));
  const agentKey = parseKey(requireEnv("HEDERA_AGENT_KEY"));
  const opEvm = requireEnv("HEDERA_OPERATOR_EVM");
  const agentEvm = requireEnv("HEDERA_AGENT_EVM");

  const operatorId = await resolveAccountId(
    process.env.HEDERA_OPERATOR_ID || opEvm,
  );
  const agentId = await resolveAccountId(process.env.HEDERA_AGENT_ID || agentEvm);

  console.log({ operatorId, agentId });

  await completeHollowAccount(operatorId, opKey);
  await completeHollowAccount(agentId, agentKey);

  const client = Client.forTestnet();
  client.setOperator(AccountId.fromString(operatorId), opKey);
  try {
    const bal = await new AccountBalanceQuery()
      .setAccountId(operatorId)
      .execute(client);
    console.log(`Operator balance: ${bal.hbars.toString()}`);

    // Top up agent from operator if agent is empty / low
    const agentBal = await new AccountBalanceQuery()
      .setAccountId(agentId)
      .execute(client);
    console.log(`Agent balance: ${agentBal.hbars.toString()}`);
    if (agentBal.hbars.toTinybars().toNumber() < 50_000_000) {
      const fund = await new TransferTransaction()
        .addHbarTransfer(operatorId, new Hbar(-5))
        .addHbarTransfer(agentId, new Hbar(5))
        .execute(client);
      await fund.getReceipt(client);
      console.log("Funded agent with 5 HBAR from operator");
    }

    let topicId = process.env.HEDERA_HCS_TOPIC_ID;
    if (!topicId) {
      const topicTx = await new TopicCreateTransaction()
        .setTopicMemo("ShelfSign attestations + x402 receipts")
        .execute(client);
      const receipt = await topicTx.getReceipt(client);
      topicId = receipt.topicId!.toString();
      console.log(`Created HCS topic ${topicId}`);
    }

    upsertEnv({
      HEDERA_NETWORK: "testnet",
      HEDERA_OPERATOR_ID: operatorId,
      HEDERA_OPERATOR_KEY: process.env.HEDERA_OPERATOR_KEY!,
      HEDERA_HCS_TOPIC_ID: topicId!,
      HEDERA_AGENT_ID: agentId,
      HEDERA_AGENT_KEY: process.env.HEDERA_AGENT_KEY!,
      X402_PAY_TO: operatorId,
      X402_ASSET: process.env.X402_ASSET?.trim() || "0.0.0",
      X402_FACILITATOR_URL: "https://api.testnet.blocky402.com",
      X402_PRICE_PER_QUERY_USDC: "0.01",
    });

    console.log("\nOn-chain setup complete.");
    console.log(`  Operator (payTo / HCS): ${operatorId}`);
    console.log(`  Agent (payer):          ${agentId}`);
    console.log(`  HCS topic:              ${topicId}`);
    console.log(
      `  HashScan topic: https://hashscan.io/testnet/topic/${topicId}`,
    );
  } finally {
    client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
