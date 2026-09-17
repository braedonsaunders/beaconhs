import type { IssueDraft, IssuePublisher, PublishedIssue } from './types'

export type MemoryIssueRecord = PublishedIssue & {
  body: string
  labels: string[]
}

export function createMemoryIssuePublisher(seed: MemoryIssueRecord[] = []): IssuePublisher & {
  records: MemoryIssueRecord[]
} {
  const records = [...seed]
  let nextNumber = records.reduce((max, record) => Math.max(max, record.number), 0) + 1

  return {
    records,
    async searchOpen(query) {
      const needle = query.toLowerCase()
      return records
        .filter((record) => record.title.toLowerCase().includes(needle))
        .map((record) => ({
          id: record.id,
          title: record.title,
          url: record.url,
        }))
    },
    async create(draft: IssueDraft) {
      const number = nextNumber
      nextNumber += 1
      const record: MemoryIssueRecord = {
        id: `mem-${number}`,
        number,
        url: `https://example.invalid/issues/${number}`,
        title: draft.title,
        body: draft.body,
        labels: draft.labels,
      }
      records.unshift(record)
      return record
    },
  }
}
