'use client'

// Renders an assistant turn's ordered parts — markdown text + tool-use cards +
// (M5) proposal cards. The SAME renderer serves live streaming and DB reload.

import { ChatMarkdown } from './markdown'
import { ToolUseCard } from './tool-use-card'
import { ProposalCard, proposalFromOutput } from './proposal-card'
import { ToolResultView } from './result-views'

type AnyPart = { type: string; [k: string]: unknown }

export function MessageParts({ parts }: { parts: unknown[] }) {
  const list = Array.isArray(parts) ? (parts as AnyPart[]) : []
  return (
    <div className="space-y-2.5">
      {list.map((part, i) => (
        <PartView key={i} part={part} />
      ))}
    </div>
  )
}

function PartView({ part }: { part: AnyPart }) {
  if (!part || typeof part !== 'object' || typeof part.type !== 'string') return null
  const { type } = part

  if (type === 'text') {
    const text = typeof part.text === 'string' ? part.text : ''
    return text.trim() ? <ChatMarkdown>{text}</ChatMarkdown> : null
  }
  if (type === 'step-start' || type === 'reasoning') return null

  if (type === 'dynamic-tool' || type.startsWith('tool-')) {
    const name =
      type === 'dynamic-tool' ? String(part.toolName ?? 'tool') : type.slice('tool-'.length)
    const state = (part.state as 'input-streaming' | 'output-available') ?? 'output-available'
    // A draft_* tool that produced a proposal renders a confirm card too.
    const proposal = proposalFromOutput(part.output)
    return (
      <div className="space-y-2">
        <ToolUseCard name={name} state={state} input={part.input} output={part.output} />
        {/* Search and read tool results render as interactive, deep-linked cards. */}
        {proposal ? null : <ToolResultView name={name} output={part.output} />}
        {proposal ? <ProposalCard proposal={proposal} /> : null}
      </div>
    )
  }
  return null
}
