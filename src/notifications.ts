import type { NotificationPreferences } from './onboarding-domain';

type Item = { id: string; name: string; dueDate: string; state: { status: string } };
type Preferences = Pick<NotificationPreferences, 'upcomingReminders' | 'overdueAlerts'>;
export type ObligationNotificationPayload = { id: string; title: string; body: string; date: Date };

/** Device-local dates are deliberate: reminders ring at 9 AM where the device is. */
export function buildObligationNotificationPayloads(items: readonly Item[], prefs: Preferences, now: Date): ObligationNotificationPayload[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const horizon = new Date(today); horizon.setDate(horizon.getDate() + 30);
  const result: ObligationNotificationPayload[] = [];
  for (const item of items) {
    if (item.state.status === 'paid' || item.state.status === 'pending_confirmation') continue;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(item.dueDate);
    if (!match) continue;
    const due = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    if (due.getFullYear() !== Number(match[1]) || due.getMonth() !== Number(match[2]) - 1 || due.getDate() !== Number(match[3])) continue;
    if (due > horizon) continue;
    if (due >= today && prefs.upcomingReminders) {
      let date = new Date(due); date.setDate(date.getDate() - 1); date.setHours(9);
      if (date <= now) { date = new Date(due); date.setHours(9); }
      if (date > now) result.push({ id: item.id, title: 'Upcoming payment', body: `${item.name || 'An obligation'} is due on ${item.dueDate}.`, date });
    }
    if (prefs.overdueAlerts) {
      const date = due < today ? new Date(today) : new Date(due);
      if (due >= today) date.setDate(date.getDate() + 1);
      date.setHours(9);
      if (date <= now) date.setDate(date.getDate() + 1);
      result.push({ id: item.id, title: 'Past-due payment', body: `${item.name || 'An obligation'} is past due.`, date });
    }
  }
  return result.sort((a, b) => a.date.getTime() - b.date.getTime() || a.id.localeCompare(b.id)).slice(0, 40);
}

type PermissionStatus = 'granted' | 'denied' | 'undetermined' | 'unavailable';
async function nativeNotifications() {
  try { return await import('expo-notifications'); } catch { return null; }
}
export async function getLocalNotificationPermissionStatus(): Promise<PermissionStatus> {
  try {
    const api = await nativeNotifications();
    if (!api) return 'unavailable';
    const permission = await api.getPermissionsAsync();
    return permission.granted ? 'granted' : permission.status === 'denied' ? 'denied' : 'undetermined';
  } catch { return 'unavailable'; }
}
export async function requestLocalNotificationPermission(): Promise<'granted' | 'denied' | 'unavailable'> {
  try {
    const api = await nativeNotifications();
    if (!api) return 'unavailable';
    const permission = await api.requestPermissionsAsync();
    return permission.granted ? 'granted' : 'denied';
  } catch { return 'unavailable'; }
}

// Serialize replacements to prevent overlapping effects from creating duplicates.
let queue: Promise<void> = Promise.resolve();
function enqueue(work: () => Promise<void>): Promise<void> {
  queue = queue.catch(() => {}).then(work).catch(() => {});
  return queue;
}
export function cancelAllLocalNotifications(): Promise<void> {
  return enqueue(async () => { const api = await nativeNotifications(); if (api) await api.cancelAllScheduledNotificationsAsync(); });
}
export function syncLocalObligationNotifications(items: readonly Item[], prefs: Preferences): Promise<void> {
  return enqueue(async () => {
    const api = await nativeNotifications();
    if (!api) return;
    await api.cancelAllScheduledNotificationsAsync();
    if ((!prefs.upcomingReminders && !prefs.overdueAlerts) || (await getLocalNotificationPermissionStatus()) !== 'granted') return;
    for (const payload of buildObligationNotificationPayloads(items, prefs, new Date())) {
      await api.scheduleNotificationAsync({ content: { title: payload.title, body: payload.body }, trigger: { type: api.SchedulableTriggerInputTypes.DATE, date: payload.date } });
    }
  });
}

type MilestoneInput = { id: string; title: string; status: string };
export function buildMilestoneNotificationPayloads(milestones: readonly MilestoneInput[], alreadyNotifiedIds: readonly string[], enabled: boolean): { id: string; title: string; body: string }[] {
  if (!enabled) return [];
  const seen = new Set(alreadyNotifiedIds);
  return milestones.flatMap(milestone => {
    if (milestone.status !== 'completed' || seen.has(milestone.id)) return [];
    seen.add(milestone.id);
    return [{ id: milestone.id, title: 'Milestone reached', body: milestone.title }];
  });
}

const notifiedMilestoneSessionIds = new Set<string>();

/** Returns the IDs successfully scheduled so the caller can persist them. */
export function syncMilestoneNotifications(milestones: readonly MilestoneInput[], alreadyNotifiedIds: readonly string[], enabled: boolean): Promise<string[]> {
  let result = [...alreadyNotifiedIds];
  return enqueue(async () => {
    const api = await nativeNotifications();
    if (!api || !enabled || (await getLocalNotificationPermissionStatus()) !== 'granted') return;
    const seen = [...new Set([...result, ...notifiedMilestoneSessionIds])];
    for (const payload of buildMilestoneNotificationPayloads(milestones, seen, true)) {
      notifiedMilestoneSessionIds.add(payload.id);
      await api.scheduleNotificationAsync({ content: { title: payload.title, body: payload.body }, trigger: null });
      result = [...result, payload.id];
    }
  }).then(() => result);
}
