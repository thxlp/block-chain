import { ethers } from "ethers";

/** Sepolia — ใช้เมื่อไม่ตั้ง `NEXT_PUBLIC_CONTRACT_ADDRESS` ใน `.env.local` */
const FALLBACK_CONTRACT_RAW =
  "0x3e0b592ffe7206198f0d0ad63f80e8515b3c0bae";

/**
 * ที่อยู่คอนแทรค Sepolia แบบ checksum — ป้องกันสลับเชน/พิมพ์ผิดโดยไม่รู้ตัว
 * ตั้ง `NEXT_PUBLIC_CONTRACT_ADDRESS` ได้ถ้าต้องการ override (ต้องเป็น Sepolia เท่านั้น)
 */
export function getSepoliaContractAddress(): string {
  const fromEnv =
    typeof process !== "undefined"
      ? process.env.NEXT_PUBLIC_CONTRACT_ADDRESS?.trim()
      : "";
  const raw =
    fromEnv && fromEnv.length > 0 ? fromEnv : FALLBACK_CONTRACT_RAW;
  try {
    const checksummed = ethers.getAddress(raw);
    console.log(
      `[Sepolia contract] checksum=${checksummed} | source=${fromEnv ? "NEXT_PUBLIC_CONTRACT_ADDRESS (.env)" : "fallback (app code)"}`
    );
    return checksummed;
  } catch (err) {
    console.error(
      "[Sepolia contract] ที่อยู่ไม่ถูกต้อง — ใช้ fallback:",
      FALLBACK_CONTRACT_RAW,
      err
    );
    return ethers.getAddress(FALLBACK_CONTRACT_RAW);
  }
}
