# Inbox

Everything that waits on the user, in urgency order, answered in place: the `inbox` surface, first tab after Agent. Its
items are the open questions in the live Messages log merged with the items other extensions provide (`items.ts`);
a question leaves the moment it is answered or dismissed, wherever
that happened, a provided item when its provider stops listing it.

## Provided items (`ui.tsx`)

Another extension puts its own things to do in the Inbox (a command to run in a terminal, say) by providing the
`InboxItems` point from its `web.tsx`: `provide(InboxItems, () => items)`, a hook returning
`{ key, at, conversation?, tag, title, gist?, priority?, due?, pane }[]`. `key` is unique across providers (`shell:12`),
`at` is when it started waiting, `tag` is the row's kind tag, and `pane` is the reading pane's content below the title,
its buttons included. With `conversation` the row names it and the pane offers **Open in branch**. `priority` is
`high`, `normal` (the default for sorting) or `low`; `due` is a date (`YYYY-MM-DD`) in the user's local calendar.
The sidebar reads the merged, age-ordered `Waiting` from `ui.tsx`. Providers return `undefined` until loaded and
`[]` when loaded but empty. The Inbox waits for its sources before advancing past a missing selection. A provider
that throws is left out behind its inline error card. A question's key is `message:<id>`.

## Surface (`web.tsx`)

- **List**: one row per item, the asking branch's feature chip and `#id` as the sidebar draws them, a `preview` tag
  when the text links to a local preview (`http://127.0.0.1:…` or `localhost`), else `question`; the start of the
  message as its title, its first question as the gist, and how long it has waited, amber past an hour. Rows show
  explicit priority and **Today** or **Overdue** when applicable. The list puts overdue items first, then items due
  today, then the rest; within each group it sorts by priority, then age, then key. Questions still have no due
  date or priority label. Titles and gists show Markdown as plain preview text; tapping the row opens the full message.
- **Reading pane** for the selected item: the whole message in the transcript's Markdown renderer (including the
  first line and links), its forwarded images (`MessageImages`), **Open preview** (a new tab) when it links one,
  **Open in branch #id** (messages' `messages:open {conversation, message}`), and the answer card itself (questions' `MessageQuestions`). An extension
  providing `QuestionPane` (`ui.tsx`) may take a question's pane over: side-chat shows the question's side chat there
  while it is in front.
- **Keys** (desktop): `j`/`k` move the selection in visible order, `⇧O` opens the branch (plain `o` is the card's
  "Something else…"), and the card's own keys (1–9, letters, ↵, ⇧↵) answer the shown item: the Inbox passes `keys`
  to the card. A branch's transcript keeps its own rule (`keyCard`) when the Inbox is not on screen.
- **Phone**: the list full width; a tap shows the item full screen with a back arrow, the answer card after the text.
- **Zero**: "Nothing waits on you", the questions answered or dismissed today (tap to open in the transcript),
  and **Back to @ultimate**.

React renders the shell and reading pane; Solid islands render the list, empty state, sidebar row, badge and link
handler. They receive plain data, not provided panes.

The durable UI key `ext.inbox.selected` holds `{ key, at, open }`. The list and the reading pane show that key if
present, even when urgency reorders it. If it leaves, they show the next one by age, then key (regardless of visual
order), or the newest entry if none is that new. The selection moves to that entry, so a newer arrival never takes
its place. With no selection they show the first visible entry. Desktop ignores `open`; the phone's back arrow
clears `open` without forgetting the selection.

`?inbox=<key>` on load opens the surface at that entry and removes the parameter from the address. The
`inbox:open {key}` event does the same at runtime (a push notification's tap, `extensions/push`). A plain number, in
either or as `inbox:open {message}`, is a question's message id. A link to an entry that has not loaded yet keeps
its key with `at: 0`, so the entry shows when it arrives and the selection takes its real age.

## Follow-ups

Ask the conversation that owns an Inbox item without answering the card or marking the item done. Questions go to
the asker; to-dos go to `@ultimate` in this project. The shared composer supports file and image attachments.
After sending, the item links to the recipient's conversation and shows the status of its most recent prompt.
`followUpStatus { submissionId }` reads the input in that conversation: `pending`, `replied`, or `no-reply`.
It is a read-only polling action and does not infer a reply from other activity in the conversation.

## Elsewhere

- **Sidebar**: a row under @ultimate's (`sidebar.under-ultimate`), amber `Inbox · N · oldest 2h` while items wait,
  a quiet `Inbox` at zero; a click opens the surface. @ultimate's own row then says only `waits on you`.
- **To-dos**: open user-owned to-dos appear in Inbox. The to-do extension adds controls to the Inbox header.
- ⌘K **Open Inbox**.
