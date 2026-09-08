/**
 * Fund Hedera testnet operator/agent (Portal PAT or web faucet), complete
 * hollow accounts, create an HCS topic, write IDs into backend/.env (+ frontend).
 *
 * Preferred (fully automatic):
 *   HEDERA_PAT=<portal PAT> npm run setup:hcs
 *
 * Manual fallback:
 *   1) Script opens https://faucet.hedera.com and prints EVM addresses
 *   2) Fund both addresses (100 HBAR each)
 *   3) Script polls mirror, creates topic, updates .env
 */
import "dotenv/config";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";
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
const PORTAL_FAUCET = "https://portal.hedera.com/api/disbursement/cli";

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

function ensureKeys(): {
  operator: { key: string; evm: string };
  agent: { key: string; evm: string };
} {
  const envOpKey = process.env.HEDERA_OPERATOR_KEY?.trim();
  const envAgKey = process.env.HEDERA_AGENT_KEY?.trim();
  const envOpEvm = process.env.HEDERA_OPERATOR_EVM?.trim();
  const envAgEvm = process.env.HEDERA_AGENT_EVM?.trim();

  if (envOpKey && envAgKey) {
    const op = parseKey(envOpKey);
    const ag = parseKey(envAgKey);
    const data = {
      operator: {
        key: envOpKey.startsWith("0x") ? envOpKey : `0x${op.toStringRaw()}`,
        evm: (envOpEvm || `0x${op.publicKey.toEvmAddress()}`).toLowerCase(),
      },
      agent: {
        key: envAgKey.startsWith("0x") ? envAgKey : `0x${ag.toStringRaw()}`,
        evm: (envAgEvm || `0x${ag.publicKey.toEvmAddress()}`).toLowerCase(),
      },
    };
    writeFileSync(KEYS_PATH, JSON.stringify(data, null, 2));
    return data;
  }

  if (existsSync(KEYS_PATH)) {
    return JSON.parse(readFileSync(KEYS_PATH, "utf8")) as {
      operator: { key: string; evm: string };
      agent: { key: string; evm: string };
    };
  }

  const op = PrivateKey.generateECDSA();
  const ag = PrivateKey.generateECDSA();
  const data = {
    operator: {
      key: `0x${op.toStringRaw()}`,
      evm: `0x${op.publicKey.toEvmAddress()}`,
    },
    agent: {
      key: `0x${ag.toStringRaw()}`,
      evm: `0x${ag.publicKey.toEvmAddress()}`,
    },
  };
  writeFileSync(KEYS_PATH, JSON.stringify(data, null, 2));
  return data;
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

async function fundViaPortalPat(address: string, amount = 50): Promise<boolean> {
  const pat = process.env.HEDERA_PAT?.trim();
  if (!pat) return false;
  const res = await fetch(PORTAL_FAUCET, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${pat}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ address, amount, network: "testnet" }),
  });
  const text = await res.text();
  if (!res.ok) {
    console.warn(`Portal faucet ${address}: HTTP ${res.status} ${text.slice(0, 200)}`);
    return false;
  }
  console.log(`Portal faucet funded ${address}: ${text.slice(0, 200)}`);
  return true;
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

function openFaucet(operatorEvm: string, agentEvm: string) {
  console.log("\nFund these EVM addresses on the Hedera testnet faucet:");
  console.log("  https://faucet.hedera.com/");
  console.log(`  OPERATOR (HCS + payTo): ${operatorEvm}`);
  console.log(`  AGENT    (x402 payer):  ${agentEvm}`);
  console.log(
    "Or set HEDERA_PAT (portal.hedera.com → Personal Access Token) and re-run.\n",
  );
  try {
    execSync(`open "https://faucet.hedera.com/"`, { stdio: "ignore" });
  } catch {
    /* non-mac or headless */
  }
}

async function main() {
  const keys = ensureKeys();
  const opKey = parseKey(keys.operator.key);
  const agKey = parseKey(keys.agent.key);

  // Prefer Portal PAT when present
  const pat = process.env.HEDERA_PAT?.trim();
  if (pat) {
    console.log("HEDERA_PAT set — funding via Portal faucet API…");
    await fundViaPortalPat(keys.operator.evm);
    await fundViaPortalPat(keys.agent.evm);
  } else {
    openFaucet(keys.operator.evm, keys.agent.evm);
  }

  console.log("Waiting for mirror node to see accounts…\n");

  let operatorId: string | null = null;
  let agentId: string | null = null;
  const deadline = Date.now() + (pat ? 2 : 10) * 60_000;
  while (Date.now() < deadline) {
    operatorId = await resolveAccountId(keys.operator.evm);
    agentId = await resolveAccountId(keys.agent.evm);
    console.log(
      `  poll operator=${operatorId ?? "…"} agent=${agentId ?? "…"}`,
    );
    if (operatorId && agentId) break;
    if (operatorId && !agentId && Date.now() > deadline - 30_000) break;
    await new Promise((r) => setTimeout(r, 5000));
  }
  if (!operatorId) {
    throw new Error(
      "Operator account not funded in time. Fund the OPERATOR EVM at faucet.hedera.com (or set HEDERA_PAT) and re-run: npm run setup:hcs",
    );
  }
  if (!agentId) {
    console.warn(
      "Agent not funded yet — will still create HCS topic; fund agent for x402 pay.",
    );
  }

  await completeHollow(operatorId, opKey);
  if (agentId) {
    await completeHollow(agentId, agKey);
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

    let topicId = process.env.HEDERA_HCS_TOPIC_ID?.trim();
    if (!topicId || topicId.includes("mock")) {
      const topicTx = await new TopicCreateTransaction()
        .setTopicMemo("ShelfSign attestations + x402 receipts")
        .execute(client);
      const topicReceipt = await topicTx.getReceipt(client);
      topicId = topicReceipt.topicId!.toString();
      console.log(`Created HCS topic ${topicId}`);
    } else {
      console.log(`Reusing existing HCS topic ${topicId}`);
    }

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
        HEDERA_OPERATOR_EVM: keys.operator.evm,
        HEDERA_HCS_TOPIC_ID: topicId,
        ...(agentId
          ? {
              HEDERA_AGENT_ID: agentId,
              HEDERA_AGENT_KEY: keys.agent.key,
              HEDERA_AGENT_EVM: keys.agent.evm,
            }
          : {}),
        X402_PAY_TO: operatorId,
        X402_ASSET: "0.0.0",
        X402_FACILITATOR_URL: "https://api.testnet.blocky402.com",
        X402_PRICE_PER_QUERY_USDC: "0.01",
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
    console.log("Restart the backend (or let tsx watch reload) so it picks up .env.");
  } finally {
    client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
