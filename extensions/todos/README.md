# To-dos

The project's short list of open loops, each owned by the user or @ultimate and managed in Inbox. For planned work
with tasks and reviews, use `plan`.

## State

The `todos` document on conversation 1 (conversation scope, latest history, initial on fork) holds
`{ next, items: [{ id, text, owner: 'user' | 'ultimate', at, done?, priority?, due? }] }`, oldest first. Text is
trimmed, nonempty and at most 300 characters. Priority is `high`, `normal` (the default), or `low`. A due date is a
calendar day (`YYYY-MM-DD`); old items have no deadline. Ticking keeps the newest 50 done items and drops older ones;
open items are never dropped.

## Agents

`todo {action: 'add', text, owner, priority?, due?} | {action: 'done', id} | {action: 'list'}` belongs to @ultimate: it is deferred
and named in `agents/ultimate.md`, and any other caller is refused. A coordinator that wants something on the list
asks @ultimate.

Whenever the open list changed since @ultimate last heard it, the input that starts its next run goes in after a
`todos.note` entry listing its open to-dos and the user's, by id (`No to-dos are open.` once the last one is ticked).
Due-today and overdue status use the host’s calendar, so the note can change without an edit; it never starts a
run on its own. An unchanged list adds nothing. The note is never part of the system prompt, so the prompt cache holds.

## Other projects

Each project keeps its own list. Another project's @ultimate reads it with codemode
`ultimate.doc('todos', 1, { project })` (see [codemode](../codemode/README.md#other-projects)) and asks this
project's @ultimate to add one with `ultimate.tell`.

## Inbox

Open to-dos for the user appear beside open questions, under keys like `todo:12`. Tap a to-do to edit it, mark it done,
or write @ultimate about it in its follow-up box (text and attachments, Inbox's `FollowUp`). Web and Obsidian URLs
are tappable once the to-do is open; tapping a link does not mark the task done. **Add** creates a to-do for either owner. The header’s menu holds **@ultimate’s tasks** and **Completed to-dos**; neither counts toward what
waits on the user. Completed items can be reopened. **Start** on one of @ultimate's tasks opens the same box in the
dialog. Either sends `About my to-do #id: …` (or `Work on your to-do #id: …`) plus the user's text as a follow-up and
shows where it went and whether a reply arrived, without leaving the Inbox.

## Extensions

The `todos.references` Solid point (`TodoReferences` in `ui.solid.tsx`) receives `{ id, text }` for the opened
Inbox to-do. Use it to render references alongside the to-do's actions; it does not change the list row or title.
User extensions can declare the point by that name with `definePoint` from `@/sdk/solid`.

Server code adds with `host.want(TodosApi)?.add({ text, owner, key?, priority?, due? })` (`api.ts`), which returns the to-do. It is
not core tier: to-dos are optional, and nothing in the core needs them.

A `key` (nonempty, at most 200 characters) makes an add idempotent: the same key again adds nothing and returns the
to-do it added, as it is now or, once ticked out of the list, as it was when added. The `todos.keys` document on
conversation 1 records each key with its to-do in the same commit and keeps the newest 500; a key older than that is
forgotten, and using it again adds a new to-do. Without a key every add adds.

## Actions

All user-only; the HTTP endpoint still calls them.

- `add { text, owner, key?, priority?, due? }` → the new to-do, or the one `key` already added (above).
- `update { id, text?, priority?, due? }` → the edited to-do. Omit fields to leave them unchanged, or pass `due: null`
  to clear the date.
- `done { id }` → the to-do, ticked.
- `reopen { id }` → the to-do, open again.
