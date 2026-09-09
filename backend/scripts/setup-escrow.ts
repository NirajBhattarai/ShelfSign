/**
 * Create the ShelfSign Hedera HBAR escrow vault (operator-keyed account).
 * Writes HEDERA_ESCROW_ACCOUNT_ID + ESCROW_AMOUNT_HBAR to .env.
 *
 *   npm run setup:escrow
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import "../src/loadEnv.js";
import {
  createEscrowVault,
  escrowAmountUnits,
  HBAR_TOKEN_ID,
} from "../src/services/escrow.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "../.env");

function upsertEnv(vars: Record<string, string>) {
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
  const result = await createEscrowVault();
  const amountHbar = (escrowAmountUnits() / 100_000_000).toFixed(2);
  const amountEnv =
    process.env.ESCROW_AMOUNT_HBAR?.trim() ||
    process.env.ESCROW_AMOUNT_USDC?.trim() ||
    "10";

  upsertEnv({
    HEDERA_ESCROW_ACCOUNT_ID: result.escrowAccountId,
    ESCROW_TOKEN_ID: HBAR_TOKEN_ID,
    ESCROW_AMOUNT_HBAR: amountEnv,
  });

  console.log(
    JSON.stringify(
      {
        created: result.created,
        escrowAccountId: result.escrowAccountId,
        tokenId: result.tokenId,
        lockPerCameraHbar: amountHbar,
        hashscan: `https://hashscan.io/testnet/account/${result.escrowAccountId}`,
        note: result.created
          ? "New HBAR escrow vault created."
          : "Reused existing HEDERA_ESCROW_ACCOUNT_ID.",
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
