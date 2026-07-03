import { DetailSkeleton } from '@/components/detail-skeleton'

// Detail-shaped loading state so opening a review doesn't inherit the list
// skeleton from /documents/management-reviews/loading.tsx.
export default function Loading() {
  return <DetailSkeleton />
}
