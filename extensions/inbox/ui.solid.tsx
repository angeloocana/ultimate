/** @jsxImportSource @solidjs/web */
/**
 * Inbox for other extensions' Solid code: `FollowUp`, an item's own prompt box. It sends `context` plus the typed text
 * and attachments as a follow-up to `to()` (never a steer), then shows **Sent to #id · Open conversation** with that
 * submission's reply status, kept per `item` key across reloads. `ask` folds it behind a button with that label; `focus` focuses its field on mount.
 */
export { FollowUp } from './follow-up.solid.tsx'
