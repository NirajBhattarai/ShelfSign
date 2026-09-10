/**
 * Hedera WalletConnect (HashPack etc.) + local demo/import payers for x402.
 */
import type { ClientHederaSigner } from "@x402/hedera";

export type WalletMode = "none" | "walletconnect" | "demo" | "imported";

export interface ConnectedWallet {
  mode: Exclude<WalletMode, "none">;
  accountId: string;
  network: "hedera:testnet" | "hedera:mainnet";
  label: string;
}

const MODE_KEY = "shelvesign_wallet_mode";
const ACCOUNT_KEY = "shelvesign_wallet_account";

export function shortenAccountId(id: string): string {
  if (id.length <= 14) return id;
  const parts = id.split(".");
  if (parts.length === 3) return `0.0.…${parts[2]}`;
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}

export function walletConnectConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim());
}

export function demoPayerAvailable(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_HEDERA_PAYER_ID?.trim() &&
      process.env.NEXT_PUBLIC_HEDERA_PAYER_KEY?.trim(),
  );
}

export function persistWalletSession(
  mode: Exclude<WalletMode, "none">,
  accountId: string,
) {
  if (typeof window === "undefined") return;
  localStorage.setItem(MODE_KEY, mode);
  localStorage.setItem(ACCOUNT_KEY, accountId);
}

export function clearWalletSession() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(MODE_KEY);
  localStorage.removeItem(ACCOUNT_KEY);
}

export function readWalletSession(): {
  mode: Exclude<WalletMode, "none"> | null;
  accountId: string | null;
} {
  if (typeof window === "undefined") {
    return { mode: null, accountId: null };
  }
  const mode = localStorage.getItem(MODE_KEY) as Exclude<
    WalletMode,
    "none"
  > | null;
  const accountId = localStorage.getItem(ACCOUNT_KEY);
  return { mode, accountId };
}

function networkLabel(): "hedera:testnet" | "hedera:mainnet" {
  return process.env.NEXT_PUBLIC_HEDERA_NETWORK === "mainnet"
    ? "hedera:mainnet"
    : "hedera:testnet";
}

type ConnectorBundle = {
  connector: import("@hashgraph/hedera-wallet-connect").DAppConnector;
  LedgerId: typeof import("@hiero-ledger/sdk").LedgerId;
};

let connectorPromise: Promise<ConnectorBundle> | null = null;

async function getConnector(): Promise<ConnectorBundle> {
  const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim();
  if (!projectId) {
    throw new Error(
      "Set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID (free at cloud.reown.com).",
    );
  }

  if (!connectorPromise) {
    connectorPromise = (async () => {
      const [
        {
          DAppConnector,
          HederaJsonRpcMethod,
          HederaSessionEvent,
          HederaChainId,
        },
        { LedgerId },
      ] = await Promise.all([
        import("@hashgraph/hedera-wallet-connect"),
        import("@hiero-ledger/sdk"),
      ]);

      const isMainnet = process.env.NEXT_PUBLIC_HEDERA_NETWORK === "mainnet";
      const ledger = isMainnet ? LedgerId.MAINNET : LedgerId.TESTNET;
      const chain = isMainnet ? HederaChainId.Mainnet : HederaChainId.Testnet;

      const connector = new DAppConnector(
        {
          name: "ShelfSign",
          description: "Camera-attested B2B stock · x402 pay-per-query",
          url:
            typeof window !== "undefined"
              ? window.location.origin
              : "http://localhost:3000",
          icons: [
            typeof window !== "undefined"
              ? `${window.location.origin}/favicon.ico`
              : "https://hashscan.io/favicon.ico",
          ],
        },
        ledger,
        projectId,
        Object.values(HederaJsonRpcMethod),
        [HederaSessionEvent.ChainChanged, HederaSessionEvent.AccountsChanged],
        [chain],
      );

      await connector.init({ logger: "error" });
      return { connector, LedgerId };
    })();
  }

  return connectorPromise;
}

export async function connectWalletConnect(): Promise<ConnectedWallet> {
  const { connector } = await getConnector();
  if (connector.signers.length === 0) {
    await connector.openModal(undefined, true);
  }
  const signer = connector.signers[0];
  if (!signer) throw new Error("Wallet connected but no signer available.");
  const accountId = signer.getAccountId().toString();
  const wallet: ConnectedWallet = {
    mode: "walletconnect",
    accountId,
    network: networkLabel(),
    label: "HashPack / WalletConnect",
  };
  persistWalletSession("walletconnect", accountId);
  return wallet;
}

export async function restoreWalletConnectSession(): Promise<ConnectedWallet | null> {
  if (!walletConnectConfigured()) return null;
  try {
    const { connector } = await getConnector();
    const signer = connector.signers[0];
    if (!signer) return null;
    const accountId = signer.getAccountId().toString();
    persistWalletSession("walletconnect", accountId);
    return {
      mode: "walletconnect",
      accountId,
      network: networkLabel(),
      label: "HashPack / WalletConnect",
    };
  } catch {
    return null;
  }
}

export async function disconnectWalletConnect(): Promise<void> {
  if (!walletConnectConfigured()) return;
  try {
    const { connector } = await getConnector();
    if (connector.signers.length > 0) {
      await connector.disconnectAll();
    }
  } catch {
    // ignore — session may already be gone
  } finally {
    clearWalletSession();
  }
}

/**
 * Build an x402 ClientHederaSigner that asks the connected wallet to sign
 * the partially-signed TransferTransaction (fee payer settles later).
 */
export async function createWalletConnectClientSigner(
  accountId: string,
): Promise<ClientHederaSigner> {
  const [{ connector }, sdk] = await Promise.all([
    getConnector(),
    import("@hiero-ledger/sdk"),
  ]);
  const {
    AccountId,
    Client,
    Hbar,
    TokenId,
    TransferTransaction,
    TransactionId,
  } = sdk;

  const dappSigner =
    connector.signers.find((s) => s.getAccountId().toString() === accountId) ??
    connector.signers[0];
  if (!dappSigner) {
    throw new Error("No WalletConnect signer — reconnect your wallet.");
  }

  const payer = AccountId.fromString(accountId);
  const network =
    process.env.NEXT_PUBLIC_HEDERA_NETWORK === "mainnet"
      ? "mainnet"
      : "testnet";

  return {
    accountId: payer.toString(),
    createPartiallySignedTransferTransaction: async (requirements) => {
      const req = requirements as {
        amount: string;
        payTo: string;
        asset: string;
        extra?: { feePayer?: string };
      };
      const feePayer = req.extra?.feePayer;
      if (typeof feePayer !== "string") {
        throw new Error("feePayer is required in paymentRequirements.extra");
      }
      const amount = BigInt(req.amount);
      if (amount <= 0n) throw new Error("amount must be greater than zero");

      const payTo = AccountId.fromString(req.payTo);
      const tx = new TransferTransaction();
      if (req.asset === "0.0.0") {
        tx.addHbarTransfer(payer, Hbar.fromTinybars((-amount).toString()));
        tx.addHbarTransfer(payTo, Hbar.fromTinybars(amount.toString()));
      } else {
        const tokenId = TokenId.fromString(req.asset);
        tx.addTokenTransfer(tokenId, payer, -amount);
        tx.addTokenTransfer(tokenId, payTo, amount);
      }
      tx.setTransactionId(
        TransactionId.generate(AccountId.fromString(feePayer)),
      );

      // Match @x402/hedera local signer: freeze against testnet/mainnet nodes
      // before asking the wallet for the payer signature.
      const client =
        network === "mainnet" ? Client.forMainnet() : Client.forTestnet();
      try {
        tx.freezeWith(client);
      } finally {
        client.close();
      }

      const signed = await dappSigner.signTransaction(tx);
      const bytes =
        typeof signed.toBytes === "function"
          ? signed.toBytes()
          : (signed as unknown as { toBytes: () => Uint8Array }).toBytes();
      let binary = "";
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]!);
      }
      return btoa(binary);
    },
  } satisfies ClientHederaSigner;
}
