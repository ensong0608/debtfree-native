/** Extract exact recurring-bill IDs from canonical memo markers. */
export function extractBillIdsFromMemo(memo?: string | null): Set<string> {
  const ids = new Set<string>();
  if (!memo || !memo.includes('bill:')) return ids;

  const bracketMatches = memo.matchAll(/\[bill:([^\]:]+)(?::[^\]]*)?\]/g);
  for (const match of bracketMatches) {
    if (match[1]) ids.add(match[1].trim());
  }

  const tagMatches = memo.matchAll(/(?:^|[\s,;:(])bill:([a-zA-Z0-9_-]+)(?::[^\s,;)\]]*)?/g);
  for (const match of tagMatches) {
    if (match[1]) ids.add(match[1].trim());
  }
  return ids;
}

/** Extract the exact bill ID from a transaction ID formatted as `bill:<id>...`. */
export function extractBillIdFromTxId(txId: string): string | null {
  if (!txId.startsWith('bill:')) return null;
  const parts = txId.split(':');
  return parts.length >= 2 && parts[1] ? parts[1] : null;
}

/** Match only explicit stored bill identifiers, never display names. */
export function transactionHasBillId(tx: { id: string; memo?: string | null }, billId: string): boolean {
  return extractBillIdFromTxId(tx.id) === billId || extractBillIdsFromMemo(tx.memo).has(billId);
}
