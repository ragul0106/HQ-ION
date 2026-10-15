/** Requests a buyer can send to a seller (the ONIX seller adapter forwards these to our webhook). */
export const REQUEST_ACTIONS = [
  'discover',
  'select',
  'init',
  'confirm',
  'status',
  'track',
  'update',
  'cancel',
  'rate',
  'support',
] as const;

/** Notifications the adapter routes to us that are not buyer requests. Their content is not yet known. */
export const NOTIFICATION_ACTIONS = ['on_publish'] as const;

export type RequestAction = (typeof REQUEST_ACTIONS)[number];
export type NotificationAction = (typeof NOTIFICATION_ACTIONS)[number];

/** Phase 1 (PRD): `select` is the only buyer request we implement. The rest are scaffolded and refused. */
export const UNSUPPORTED_IN_PHASE_1: readonly RequestAction[] = [
  'discover',
  'init',
  'confirm',
  'status',
  'track',
  'update',
  'cancel',
  'rate',
  'support',
];

export function isKnownAction(value: string): value is RequestAction | NotificationAction {
  return (
    (REQUEST_ACTIONS as readonly string[]).includes(value) ||
    (NOTIFICATION_ACTIONS as readonly string[]).includes(value)
  );
}
