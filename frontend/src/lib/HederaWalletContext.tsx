"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { ClientHederaSigner } from "@x402/hedera";
import {
  clearSessionPayer,
  getPayerCredentials,
  setSessionPayer,
} from "@/lib/x402Client";
import {
  clearWalletSession,
  connectWalletConnect,
  createWalletConnectClientSigner,
  demoPayerAvailable,
  disconnectWalletConnect,
  persistWalletSession,
  readWalletSession,
  restoreWalletConnectSession,
  type ConnectedWallet,
  walletConnectConfigured,
} from "@/lib/hederaWallet";

interface HederaWalletContextValue {
  wallet: ConnectedWallet | null;
  connecting: boolean;
  error: string | null;
  walletConnectReady: boolean;
  demoReady: boolean;
  connectHashPack: () => Promise<void>;
  connectDemo: () => Promise<void>;
  connectImported: (accountId: string, privateKey: string) => Promise<void>;
  disconnect: () => Promise<void>;
  /** Build an x402 client signer for the active wallet. */
  getClientSigner: () => Promise<ClientHederaSigner>;
  clearError: () => void;
}

const HederaWalletContext = createContext<HederaWalletContextValue | null>(
  null,
);

export function HederaWalletProvider({ children }: { children: ReactNode }) {
  const [wallet, setWallet] = useState<ConnectedWallet | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const walletConnectReady = walletConnectConfigured();
  const demoReady = demoPayerAvailable();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = readWalletSession();
      if (!saved.mode) return;

      if (saved.mode === "walletconnect") {
        const restored = await restoreWalletConnectSession();
        if (!cancelled && restored) setWallet(restored);
        return;
      }

      if (saved.mode === "demo" && demoReady && saved.accountId) {
        const accountId = process.env.NEXT_PUBLIC_HEDERA_PAYER_ID?.trim();
        const key = process.env.NEXT_PUBLIC_HEDERA_PAYER_KEY?.trim();
        if (accountId && key) {
          setSessionPayer(accountId, key);
          if (!cancelled) {
            setWallet({
              mode: "demo",
              accountId,
              network:
                process.env.NEXT_PUBLIC_HEDERA_NETWORK === "mainnet"
                  ? "hedera:mainnet"
                  : "hedera:testnet",
              label: "Demo testnet payer",
            });
          }
        }
        return;
      }

      if (saved.mode === "imported" && saved.accountId) {
        const creds = getPayerCredentials();
        if (creds?.accountId === saved.accountId) {
          if (!cancelled) {
            setWallet({
              mode: "imported",
              accountId: saved.accountId,
              network:
                process.env.NEXT_PUBLIC_HEDERA_NETWORK === "mainnet"
                  ? "hedera:mainnet"
                  : "hedera:testnet",
              label: "Imported account",
            });
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [demoReady]);

  const connectHashPack = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const next = await connectWalletConnect();
      setWallet(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't connect wallet.");
      throw err;
    } finally {
      setConnecting(false);
    }
  }, []);

  const connectDemo = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const accountId = process.env.NEXT_PUBLIC_HEDERA_PAYER_ID?.trim();
      const key = process.env.NEXT_PUBLIC_HEDERA_PAYER_KEY?.trim();
      if (!accountId || !key) {
        throw new Error("Demo payer env not configured.");
      }
      setSessionPayer(accountId, key);
      const next: ConnectedWallet = {
        mode: "demo",
        accountId,
        network:
          process.env.NEXT_PUBLIC_HEDERA_NETWORK === "mainnet"
            ? "hedera:mainnet"
            : "hedera:testnet",
        label: "Demo testnet payer",
      };
      persistWalletSession("demo", accountId);
      setWallet(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Demo connect failed.");
      throw err;
    } finally {
      setConnecting(false);
    }
  }, []);

  const connectImported = useCallback(
    async (accountId: string, privateKey: string) => {
      setConnecting(true);
      setError(null);
      try {
        const id = accountId.trim();
        const key = privateKey.trim();
        if (!/^0\.0\.\d+$/.test(id)) {
          throw new Error("Account ID must look like 0.0.12345");
        }
        if (key.length < 32) {
          throw new Error("Private key looks too short.");
        }
        setSessionPayer(id, key);
        const next: ConnectedWallet = {
          mode: "imported",
          accountId: id,
          network:
            process.env.NEXT_PUBLIC_HEDERA_NETWORK === "mainnet"
              ? "hedera:mainnet"
              : "hedera:testnet",
          label: "Imported account",
        };
        persistWalletSession("imported", id);
        setWallet(next);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Import failed.");
        throw err;
      } finally {
        setConnecting(false);
      }
    },
    [],
  );

  const disconnect = useCallback(async () => {
    setError(null);
    if (wallet?.mode === "walletconnect") {
      await disconnectWalletConnect();
    } else {
      clearWalletSession();
      clearSessionPayer();
    }
    setWallet(null);
  }, [wallet?.mode]);

  const getClientSigner = useCallback(async (): Promise<ClientHederaSigner> => {
    if (!wallet) {
      throw new Error("Connect a Hedera wallet first.");
    }
    if (wallet.mode === "walletconnect") {
      return createWalletConnectClientSigner(wallet.accountId);
    }
    const creds = getPayerCredentials();
    if (!creds || creds.accountId !== wallet.accountId) {
      throw new Error("Local payer key missing — reconnect the wallet.");
    }
    const { createClientHederaSigner, PrivateKey } = await import(
      "@x402/hedera"
    );
    const parseKey = (raw: string) =>
      raw.startsWith("0x")
        ? PrivateKey.fromStringECDSA(raw)
        : PrivateKey.fromString(raw);
    return createClientHederaSigner(
      creds.accountId,
      parseKey(creds.privateKey),
      { network: wallet.network },
    );
  }, [wallet]);

  const value = useMemo(
    () => ({
      wallet,
      connecting,
      error,
      walletConnectReady,
      demoReady,
      connectHashPack,
      connectDemo,
      connectImported,
      disconnect,
      getClientSigner,
      clearError: () => setError(null),
    }),
    [
      wallet,
      connecting,
      error,
      walletConnectReady,
      demoReady,
      connectHashPack,
      connectDemo,
      connectImported,
      disconnect,
      getClientSigner,
    ],
  );

  return (
    <HederaWalletContext.Provider value={value}>
      {children}
    </HederaWalletContext.Provider>
  );
}

export function useHederaWallet(): HederaWalletContextValue {
  const ctx = useContext(HederaWalletContext);
  if (!ctx) {
    throw new Error("useHederaWallet must be used within HederaWalletProvider");
  }
  return ctx;
}
