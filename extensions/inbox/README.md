# Inbox

Everything that waits on the user, in urgency order, answered in place: the `inbox` surface, first tab after Agent. Its
items are the open questions in the live Messages log merged with the items other extensions provide (`items.ts`);
a question leaves the moment it is answered or dismissed, wherever that happened, a provided item when its provider
stops listing it.

## Provided items (`ui.solid.tsx`)

Another extension puts its own things to do in the Inbox by providing the `InboxItems` point from its
`web.solid.tsx`: `provide(InboxItems, () => items)`, where `items` is an accessor of
`{ key, at, conversation?, tag, title, heading?, gist?, priority?, due?, pane }[]`. `key` is unique across providers
(`shell:12`), `at` is when it started waiting in epoch milliseconds, and `tag` is the row's kind tag. `title` is one
line of inline Markdown, shown without images in the pane and as plain text in the list. `heading` can render a
custom title in the pane; `pane` renders the content below it. With `conversation` the row names it and the pane
offers **Open in branch**. `priority` is `high`, `normal` (the default for sorting) or `low`; `due` is a local date
(`YYYY-MM-DD`). The sidebar and To-dos' **For you** row read the merged, age-ordered `Waiting` from `ui.solid.tsx`.
Providers return `undefined` until loaded and `[]` when loaded but empty. The Inbox waits for its sources before
advancing past a missing selection. A provider that throws is left out behind its inline error card. A question's
key is `message:<id>`.

## Surface (`web.solid.tsx`)

- **List**: one row per item, the asking branch's feature chip and `#id` as the sidebar draws them, a `preview` tag
  when the text links to a local preview (`http://127.0.0.1:…` or `localhost`), else `question`; the message's bold
  lead or first line as its title, its first question as the gist, and how long it has waited, amber past an hour.
  Rows show explicit priority and **Today** or **Overdue** when applicable. Overdue items come first, then items due
  today, then the rest; each group sorts by priority, then age, then key. Titles and gists show Markdown as plain text.
- **Reading pane** for the selected item: a title with inline Markdown and working links (no images in the title),
  the rest of the text (`Body`), forwarded images (`MessageImages`), **Open preview** (a new tab) when it links one,
  **Open in branch #id** (`messages:open {conversation, message}`), and the answer card (`MessageQuestions`). An
  extension providing `QuestionPane` (`ui.solid.tsx`) may take a question's pane over: side-chat shows the question's
  side chat there while it is in front.
- **Follow-up** below the answer card: **Ask #id about this** opens a prompt box (text and attachments) that sends
  the user's prompt to the asking branch without steering it or answering the card. To-dos put the same box in their
  pane, addressed to @ultimate.
- **Keys** (desktop): `j`/`k` move the selection in visible order, `⇧O` opens the branch (plain `o` is the card's
  "Something else…"), and the card's own keys (1–9, letters, ↵, ⇧↵) answer the shown item: the Inbox passes `keys`
  to the card. A branch's transcript keeps its own rule (`keyCard`) when the Inbox is not on screen.
- **Phone**: the list full width; a tap shows the item full screen with a back arrow, the answer card after the text.
- **Zero**: "Nothing waits on you", the questions answered or dismissed today (tap to open in the transcript),
  and **Back to @ultimate**.

The durable UI key `ext.inbox.selected` holds `{ key, at, open }`. The list and the reading pane show that key if
present, even when urgency reorders it. If it leaves, they show the next one by age, then key (regardless of visual
order), or the newest entry if none is that new. The selection moves to that entry, so a newer arrival never takes
its place. With no selection they show the first visible entry. Desktop ignores `open`; the phone's back arrow
clears `open` without forgetting the selection.

`?inbox=<key>` on load opens the surface at that entry and removes the parameter from the address. The
`inbox:open {key}` event does the same at runtime (a push notification's tap, `extensions/push`). A plain number, in
either or as `inbox:open {message}`, is a question's message id. A link to an entry that has not loaded yet keeps
its key with `at: 0`, so the entry shows when it arrives and the selection takes its real age.

## Follow-ups (`ui.solid.tsx`)

`FollowUp` is an item's own prompt box for other extensions' Solid code: `{ item, at, context, to, label,
placeholder, ask?, focus? }`. The user-only `submitFollowUp { item, text, images? }` action receives the prompt,
its item context and any attachments. It admits the input in follow-up mode and records the item's latest receipt
in the same commit. The item links to the receiving conversation; `followUpStatus { submissionId }` checks that
specific input: `pending`, `replied`, or `no-reply`. Drafts belong to the item in the current chapter. On a phone,
the box accounts for the space the keyboard takes so the Send button can stay in view while typing.

## Elsewhere

- **Sidebar**: a row under @ultimate's (`sidebar.under-ultimate`), amber `Inbox · N · oldest 2h` while items wait,
  a quiet `Inbox` at zero; a click opens the surface. @ultimate's own row then says only `waits on you`.
- **To-dos**: open user-owned to-dos appear in Inbox with a follow-up box to @ultimate. The to-do extension adds
  controls to the Inbox header; **Start** on one of @ultimate's tasks opens the same box in its dialog.
- ⌘K **Open Inbox**.
