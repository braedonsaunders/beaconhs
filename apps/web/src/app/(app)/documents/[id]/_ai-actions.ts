'use server'

// The document AI assistant: thread persistence (platform ai_conversations /
// ai_messages, scope 'documents.editor', one thread per user per document)
// and the agent turn itself. The agent runs a full tool loop server-side
// against the DOCX master: read (LibreOffice text extraction), surgical
// exact-match edits (docx → flat-ODT splice → docx, formatting preserved),
// and whole-document writes (HTML → docx). The open editor session is stale
// after a change, so the caller remounts the embed; the WOPI timestamp guard
// makes a stale session's late autosave a harmless 409.

import { revalidatePath } from 'next/cache'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { aiConversations, aiMessages, attachments, documents } from '@beaconhs/db/schema'
import { assertCan } from '@beaconhs/tenant'
import { getObject, newAttachmentKey, putObject } from '@beaconhs/storage'
import { replaceTextInFodt, sofficeConvert } from '@beaconhs/office'
import { runDocAgent, AIDisabledError, type DocChatMessage } from '@beaconhs/ai'
import { sanitizeDocumentHtml } from '@beaconhs/forms-core'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { getTenantAiConfig } from '@/lib/ai-config'
import { documentReadFilter } from '@/lib/assistant/doc-access'
import { isUuid } from '@/lib/list-params'

const SCOPE = 'documents.editor'
const MAX_STORED_MESSAGES = 100
const MAX_TURN_MESSAGES = 40
const MAX_MESSAGE_LENGTH = 24_000
const MAX_TURN_TEXT = 256_000

type DocAiRole = 'user' | 'assistant'
type DocAiMessage = { id: string; role: DocAiRole; content: string }

async function documentIsVisible(
  ctx: Awaited<ReturnType<typeof requireRequestContext>>,
  documentId: string,
): Promise<boolean> {
  if (!isUuid(documentId)) return false
  const [document] = await ctx.db((tx) =>
    tx
      .select({ id: documents.id })
      .from(documents)
      .where(
        and(eq(documents.id, documentId), isNull(documents.deletedAt), documentReadFilter(ctx)),
      )
      .limit(1),
  )
  return Boolean(document)
}

export async function loadDocConversation(
  documentId: string,
): Promise<{ conversationId: string; messages: DocAiMessage[] }> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'documents.read')
  if (!(await documentIsVisible(ctx, documentId))) throw new Error('Document not found')
  return ctx.db(async (tx) => {
    const existing = await tx
      .select()
      .from(aiConversations)
      .where(
        and(
          eq(aiConversations.scope, SCOPE),
          eq(aiConversations.scopeRefId, documentId),
          eq(aiConversations.userId, ctx.userId),
        ),
      )
      .orderBy(desc(aiConversations.createdAt))
      .limit(1)
    let conv = existing[0]
    if (!conv) {
      const [created] = await tx
        .insert(aiConversations)
        .values({
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          scope: SCOPE,
          scopeRefId: documentId,
          title: 'Document assistant',
        })
        .returning()
      conv = created!
    }
    const msgs = await tx
      .select()
      .from(aiMessages)
      .where(eq(aiMessages.conversationId, conv.id))
      .orderBy(desc(aiMessages.createdAt))
      .limit(MAX_STORED_MESSAGES)
    return {
      conversationId: conv.id,
      messages: msgs
        .reverse()
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({ id: m.id, role: m.role as DocAiRole, content: m.content })),
    }
  })
}

export async function appendDocMessages(input: {
  conversationId: string
  messages: { role: DocAiRole; content: string }[]
}): Promise<{ ok: boolean }> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'documents.read')
  if (
    !input ||
    typeof input !== 'object' ||
    !isUuid(input.conversationId) ||
    !Array.isArray(input.messages) ||
    input.messages.length === 0 ||
    input.messages.length > 20 ||
    input.messages.some(
      (message) =>
        !message ||
        (message.role !== 'user' && message.role !== 'assistant') ||
        typeof message.content !== 'string' ||
        message.content.length > MAX_MESSAGE_LENGTH,
    )
  ) {
    return { ok: false }
  }
  // Ownership: only the conversation's own user may append to it, and only
  // within this module's scope — a client-supplied id can't write into another
  // user's thread.
  const [conv] = await ctx.db((tx) =>
    tx
      .select({
        userId: aiConversations.userId,
        scope: aiConversations.scope,
        scopeRefId: aiConversations.scopeRefId,
      })
      .from(aiConversations)
      .where(eq(aiConversations.id, input.conversationId))
      .limit(1),
  )
  if (
    !conv ||
    conv.userId !== ctx.userId ||
    conv.scope !== SCOPE ||
    !conv.scopeRefId ||
    !(await documentIsVisible(ctx, conv.scopeRefId))
  ) {
    return { ok: false }
  }
  await ctx.db(async (tx) => {
    for (const m of input.messages) {
      await tx.insert(aiMessages).values({
        tenantId: ctx.tenantId,
        conversationId: input.conversationId,
        role: m.role,
        content: m.content,
      })
    }
  })
  return { ok: true }
}

export async function newDocConversation(documentId: string): Promise<{ conversationId: string }> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'documents.read')
  if (!(await documentIsVisible(ctx, documentId))) throw new Error('Document not found')
  const [conv] = await ctx.db((tx) =>
    tx
      .insert(aiConversations)
      .values({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        scope: SCOPE,
        scopeRefId: documentId,
        title: 'Document assistant',
      })
      .returning({ id: aiConversations.id }),
  )
  return { conversationId: conv!.id }
}

type DocAiTurnResult =
  | { ok: true; text: string; actions: string[]; docChanged: boolean }
  | { ok: false; error: string }

export async function runDocumentAiTurn(
  documentId: string,
  messages: DocChatMessage[],
): Promise<DocAiTurnResult> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'documents.manage')
  if (!(await documentIsVisible(ctx, documentId))) return { ok: false, error: 'Document not found' }
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 200) {
    return { ok: false, error: 'No messages' }
  }
  const chat: DocChatMessage[] = messages
    .slice(-MAX_TURN_MESSAGES)
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_LENGTH) }))
  if (
    chat.length === 0 ||
    chat.reduce((total, message) => total + message.content.length, 0) > MAX_TURN_TEXT
  ) {
    return { ok: false, error: 'The conversation is too large for one AI turn.' }
  }

  const loadMaster = async () => {
    return ctx.db(async (tx) => {
      const [doc] = await tx
        .select({
          key: documents.key,
          title: documents.title,
          sourceAttachmentId: documents.sourceAttachmentId,
        })
        .from(documents)
        .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)))
        .limit(1)
      if (!doc) throw new Error('Document not found')
      if (!doc.sourceAttachmentId) return { doc, attachment: null }
      const [att] = await tx
        .select({ id: attachments.id, key: attachments.r2Key })
        .from(attachments)
        .where(eq(attachments.id, doc.sourceAttachmentId))
        .limit(1)
      return { doc, attachment: att ?? null }
    })
  }

  const readMasterDocx = async (): Promise<Buffer | null> => {
    const { attachment } = await loadMaster()
    if (!attachment) return null
    return getObject({ key: attachment.key })
  }

  const saveMasterDocx = async (docx: Buffer, summary: string) => {
    const { doc, attachment } = await loadMaster()
    if (attachment) {
      // Overwrite in place (S3 PUT is atomic) + bump the WOPI version stamp so
      // the open editor session can never clobber this change.
      await putObject({
        key: attachment.key,
        body: docx,
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      })
      await ctx.db(async (tx) => {
        await tx
          .update(attachments)
          .set({ sizeBytes: docx.length, updatedAt: new Date() })
          .where(eq(attachments.id, attachment.id))
      })
    } else {
      const filename = `${(doc.key || doc.title || 'Document').replace(/[^\w.\- ]+/g, '').trim() || 'Document'}.docx`
      const key = newAttachmentKey({ tenantId: ctx.tenantId, kind: 'document', filename })
      await putObject({
        key,
        body: docx,
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      })
      await ctx.db(async (tx) => {
        const [att] = await tx
          .insert(attachments)
          .values({
            tenantId: ctx.tenantId,
            uploadedBy: ctx.userId,
            kind: 'document',
            r2Key: key,
            contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            sizeBytes: docx.length,
            filename,
          })
          .returning()
        if (!att) throw new Error('Failed to store the document file')
        await tx
          .update(documents)
          .set({ sourceAttachmentId: att.id })
          .where(eq(documents.id, documentId))
      })
    }
    await recordAudit(ctx, {
      entityType: 'document',
      entityId: documentId,
      action: 'update',
      summary,
    })
    revalidatePath(`/documents/${documentId}`)
  }

  const extractText = async (): Promise<string> => {
    const docx = await readMasterDocx()
    if (!docx) return ''
    return (await sofficeConvert(docx, 'document.docx', 'txt:Text')).toString('utf8')
  }

  const aiConfig = await getTenantAiConfig(ctx)
  try {
    const result = await runDocAgent(aiConfig, {
      messages: chat,
      docText: (await extractText()).slice(0, 16_000),
      tools: {
        readDocument: extractText,
        editDocument: async (edits) => {
          const docx = await readMasterDocx()
          if (!docx) return edits.map((e) => ({ find: e.find, count: 0 }))
          const fodt = (await sofficeConvert(docx, 'document.docx', 'fodt')).toString('utf8')
          const { fodt: edited, results } = replaceTextInFodt(fodt, edits)
          if (results.some((r) => r.count > 0)) {
            const next = await sofficeConvert(
              Buffer.from(edited, 'utf8'),
              'document.fodt',
              'docx:MS Word 2007 XML',
            )
            await saveMasterDocx(next, 'AI assistant edited the document')
          }
          return results
        },
        writeDocument: async (html) => {
          const safe = sanitizeDocumentHtml(html)
          const page = `<!doctype html><html><head><meta charset="utf-8"></head><body>${safe}</body></html>`
          const docx = await sofficeConvert(
            Buffer.from(page, 'utf8'),
            'document.html',
            'docx:MS Word 2007 XML',
          )
          await saveMasterDocx(docx, 'AI assistant wrote the document')
        },
      },
    })
    return { ok: true, ...result }
  } catch (err) {
    if (err instanceof AIDisabledError) {
      return { ok: false, error: 'AI is not configured for this tenant.' }
    }
    console.error('[documents] AI turn failed', err)
    return { ok: false, error: 'The AI request failed.' }
  }
}
