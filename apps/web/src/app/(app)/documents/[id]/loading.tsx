import { DetailSkeleton } from '@/components/detail-skeleton'

// Detail-shaped loading state so navigating into a document doesn't inherit
// the list table skeleton from /documents/loading.tsx.
export default function Loading() {
  return <DetailSkeleton />
}
