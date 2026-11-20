import { island } from './island.tsx'
import {
  Markdown,
  MentionText as SolidMentionText,
} from '../components/markdown/markdown.solid.tsx'

import { markdownText } from '../components/markdown/parse.ts'

const MarkdownIsland = island(Markdown)
const MentionIsland = island(SolidMentionText, { inline: true })

export function MessageResponse({
  children,
  className,
  isAnimating,
  without,
}: {
  children: string
  className?: string
  isAnimating?: boolean
  without?: readonly string[]
}) {
  return (
    <MarkdownIsland class={className} streaming={isAnimating} text={children} without={without} />
  )
}

export function MarkdownPreview({ text, lead }: { text: string; lead?: boolean }) {
  return markdownText(text, lead)
}

export function MentionText({ text }: { text: string }) {
  return <MentionIsland text={text} />
}
