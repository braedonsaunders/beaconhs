// Re-export of the canonical signature-pad primitive from @beaconhs/ui so
// callers using `@/components/signature-pad` continue to work. The canvas
// implementation lives in packages/ui/src/signature-pad.tsx (velocity-mapped
// stroke width, DPR-aware sizing, pointer events for mouse/touch/stylus).
export { SignaturePad, type SignaturePadProps } from '@beaconhs/ui'
