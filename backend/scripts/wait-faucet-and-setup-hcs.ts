/**
 * Wait for Hedera portal faucet funding, complete hollow accounts,
 * create an HCS topic, and write real IDs into backend/.env (+ frontend payer).
 *
 * 1) Generate / reuse ECDSA keys
 * 2) Fund the printed EVM addresses at https://portal.hedera.com (testnet faucet)
 * 3) Run: npx tsx scripts/wait-faucet-and-setup-hcs.ts
 */
import "dotenv/config";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  AccountBalanceQuery,
  AccountId,
  Client,
  Hbar,
  PrivateKey,
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
  TransferTransaction,
} from "@hashgraph/sdk";

const KEYS_PATH = "/tmp/shelfsign-hedera-keys.json";
const MIRROR = "https://testnet.mirrornode.hedera.com";

function upsertEnv(vars: Record<string, string>, envPath: string) {
  let text = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  for (const [key, value] of Object.entries(vars)) {
    const re = new RegExp(`^${key}=.*$`, "m");
    if (re.test(text)) text = text.replace(re, `${key}=${value}`);
    else text += `\n${key}=${value}\n`;
  }
  writeFileSync(envPath, text);
}

function parseKey(raw: string): PrivateKey {
  return raw.startsWith("0x")
    ? PrivateKey.fromStringECDSA(raw)
    : PrivateKey.fromString(raw);
}

async function resolveAccountId(evmOrId: string): Promise<string | null> {
  if (evmOrId.startsWith("0.0.")) return evmOrId;
  const url = `${MIRROR}/api/v1/accounts/${evmOrId}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const body = (await res.json()) as { account?: string };
    return body.account ?? null;
  } catch {
    return null;
  }
}

async function completeHollow(accountId: string, key: PrivateKey) {
  const client = Client.forTestnet();
  client.setOperator(AccountId.fromString(accountId), key);
  try {
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

async function main() {
  if (!existsSync(KEYS_PATH)) {
    throw new Error(`Missing ${KEYS_PATH} — generate keys first`);
  }
  const keys = JSON.parse(readFileSync(KEYS_PATH, "utf8")) as {
    operator: { key: string; evm: string };
    agent: { key: string; evm: string };
  };

  console.log("\nFund these EVM addresses on Hedera testnet faucet:");
  console.log("  https://portal.hedera.com/");
  console.log(`  OPERATOR (HCS + payTo): ${keys.operator.evm}`);
  console.log(`  AGENT    (x402 payer):  ${keys.agent.evm}`);
  console.log("Waiting for mirror node to see accounts…\n");

  let operatorId: string | null = null;
  let agentId: string | null = null;
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    operatorId = await resolveAccountId(keys.operator.evm);
    agentId = await resolveAccountId(keys.agent.evm);
    console.log(`  poll operator=${operatorId ?? "…"} agent=${agentId ?? "…"}`);
    if (operatorId && agentId) break;
    await new Promise((r) => setTimeout(r, 5000));
  }
  if (!operatorId) {
    throw new Error(
      "Operator account not funded in time. Fund the EVM address at portal.hedera.com and re-run.",
    );
  }
  if (!agentId) {
    console.warn(
      "Agent not funded yet — will still create HCS topic; fund agent for x402 pay.",
    );
  }

  const opKey = parseKey(keys.operator.key);
  await completeHollow(operatorId, opKey);
  if (agentId) {
    await completeHollow(agentId, parseKey(keys.agent.key));
  }

  const client = Client.forTestnet();
  client.setOperator(AccountId.fromString(operatorId), opKey);
  try {
    const bal = await new AccountBalanceQuery()
      .setAccountId(operatorId)
      .execute(client);
    console.log(`Operator balance: ${bal.hbars.toString()}`);

    if (agentId) {
      const agentBal = await new AccountBalanceQuery()
        .setAccountId(agentId)
        .execute(client);
      if (agentBal.hbars.toTinybars().toNumber() < 50_000_000) {
        const fund = await new TransferTransaction()
          .addHbarTransfer(operatorId, new Hbar(-5))
          .addHbarTransfer(agentId, new Hbar(5))
          .execute(client);
        await fund.getReceipt(client);
        console.log("Funded agent with 5 HBAR");
      }
    }

    const topicTx = await new TopicCreateTransaction()
      .setTopicMemo("ShelfSign attestations + x402 receipts")
      .execute(client);
    const topicReceipt = await topicTx.getReceipt(client);
    const topicId = topicReceipt.topicId!.toString();
    console.log(`Created HCS topic ${topicId}`);

    // Smoke-test a real consensus message
    const smoke = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(
        JSON.stringify({
          type: "shelfsign.hcs.smoke.v1",
          at: new Date().toISOString(),
        }),
      )
      .execute(client);
    const smokeReceipt = await smoke.getReceipt(client);
    console.log(
      `Smoke HCS seq=${smokeReceipt.topicSequenceNumber?.toString()} tx=${smoke.transactionId?.toString()}`,
    );

    const backendEnv = resolve(process.cwd(), ".env");
    upsertEnv(
      {
        HEDERA_NETWORK: "testnet",
        HEDERA_OPERATOR_ID: operatorId,
        HEDERA_OPERATOR_KEY: keys.operator.key,
        HEDERA_HCS_TOPIC_ID: topicId,
        ...(agentId
          ? {
              HEDERA_AGENT_ID: agentId,
              HEDERA_AGENT_KEY: keys.agent.key,
            }
          : {}),
        X402_MOCK: "0",
        X402_PAY_TO: operatorId,
        X402_ASSET: "0.0.0",
        X402_FACILITATOR_URL: "https://api.testnet.blocky402.com",
        X402_PRICE_PER_QUERY_HBAR: "0.01",
      },
      backendEnv,
    );

    if (agentId) {
      const feEnv = resolve(process.cwd(), "../frontend/.env.local");
      upsertEnv(
        {
          NEXT_PUBLIC_HEDERA_NETWORK: "testnet",
          NEXT_PUBLIC_HEDERA_PAYER_ID: agentId,
          NEXT_PUBLIC_HEDERA_PAYER_KEY: keys.agent.key,
        },
        feEnv,
      );
    }

    console.log("\nReal HCS configured.");
    console.log(`  Operator: ${operatorId}`);
    console.log(`  Topic:    ${topicId}`);
    console.log(`  HashScan: https://hashscan.io/testnet/topic/${topicId}`);
  } finally {
    client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
