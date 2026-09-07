/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Hedera SDK / x402 client signing in the browser
  serverExternalPackages: [
    "@hashgraph/sdk",
    "@hiero-ledger/sdk",
    "@x402/hedera",
    "@hashgraph/hedera-wallet-connect",
  ],
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        encoding: false,
      };
    }
    return config;
  },
};

module.exports = nextConfig;
