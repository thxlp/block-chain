import { ethers } from "ethers";

const DECODE_IFACE = new ethers.Interface([
  "function receiveProduct(uint256 _productId)",
  "function shipProduct(uint256 _productId, address _receiver)",
  "function recallProduct(uint256 _id)",
]);

/**
 * Returns true if calldata targets the given product id (receive / ship / recall).
 * createProduct is not matched (no id in calldata).
 */
export function txInputMatchesProductId(
  input: string | undefined,
  productId: bigint
): boolean {
  if (!input || input.length < 10) return false;
  const data = input.startsWith("0x") ? input : `0x${input}`;
  try {
    const parsed = DECODE_IFACE.parseTransaction({ data });
    if (!parsed) return false;
    if (
      parsed.name !== "receiveProduct" &&
      parsed.name !== "shipProduct" &&
      parsed.name !== "recallProduct"
    ) {
      return false;
    }
    const idArg = parsed.args[0] as bigint;
    return BigInt(idArg.toString()) === productId;
  } catch {
    return false;
  }
}
