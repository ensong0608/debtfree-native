/** Serialize accepted UI selections; loading alone must never write a preference. */
export function createSelectionCommitter(write: (userId: string, householdId: string) => Promise<void>) {
  let queue: Promise<unknown> = Promise.resolve();
  return (userId: string, householdId: string, isCurrent: () => boolean): Promise<boolean> => {
    const commit = queue.catch(() => {}).then(async () => {
      if (!isCurrent()) return false;
      await write(userId, householdId);
      return true;
    });
    queue = commit;
    return commit;
  };
}
