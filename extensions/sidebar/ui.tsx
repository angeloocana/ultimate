/** The sidebar's points for other extensions' browser code. */
import type { ConversationId } from '@earendil-works/pi-durable'
import type { ReactNode } from 'react'
import { definePoint } from '@/sdk'

/**
 * Rows nested under @ultimate's row (`side-chat` lists its open side chats, `voice-live` the Voice conversation); several
 * extensions may provide it and their rows show in discovery order. Input is @ultimate's conversation id.
 */
export const UnderUltimate = definePoint<ConversationId | undefined, ReactNode>(
  'sidebar.under-ultimate',
)
/**
 * Top-level conversations no section lists (`side-chat` names its side chats, open or ended, `voice-live` the Voice
 * conversation; both nest under @ultimate instead); several extensions may provide it and the sidebar takes the union.
 * Input is @ultimate's conversation id.
 */
export const Unlisted = definePoint<ConversationId | undefined, ReadonlySet<number>>(
  'sidebar.unlisted',
)
/** Whether a preview started by this conversation is running, provided by `instance`. */
export const PreviewUp = definePoint<ConversationId | undefined, boolean>('sidebar.preview-up')
/**
 * What the project block shows under its heading for moving to another running project, provided by `projects` on a
 * phone, where its rail is hidden; nothing while nothing provides it.
 */
export const ProjectSwitch = definePoint<null, ReactNode>('sidebar.project-switch')

export { colourOf, GithubMark, ProjectSwatch, RepoLabel, stemOf } from './tile.tsx'
