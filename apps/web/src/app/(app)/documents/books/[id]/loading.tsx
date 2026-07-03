import { DetailSkeleton } from '@/components/detail-skeleton'

// Detail-shaped loading state so opening a book doesn't inherit the list
// skeleton from /documents/books/loading.tsx.
export default function Loading() {
  return <DetailSkeleton />
}
