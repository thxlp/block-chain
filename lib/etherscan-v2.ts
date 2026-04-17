/**
 * Etherscan API v2 (single host for all supported chains).
 * This project only ever passes `chainid=11155111` (Ethereum Sepolia testnet).
 * On-chain links in the UI use https://sepolia.etherscan.io (not mainnet).
 */
export const ETHERSCAN_API_V2_URL = "https://api.etherscan.io/v2/api";
export const ETHERSCAN_SEPOLIA_CHAIN_ID = "11155111";
export const SEPOLIA_ETHERSCAN_SITE = "https://sepolia.etherscan.io";

export function getEtherscanApiKey(): string {
  if (typeof process === "undefined") return "";
  return process.env.NEXT_PUBLIC_ETHERSCAN_API_KEY ?? "";
}
