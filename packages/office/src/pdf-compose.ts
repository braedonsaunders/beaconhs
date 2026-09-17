// PDF composition lives in @braedonsaunders/appkit-pdf: imposing many existing
// PDFs onto one page geometry, and stamping page furniture afterwards, is not
// specific to this product. Re-exported here so worker code keeps importing
// document tooling from one place rather than reaching past it.
//
// The behaviour and its tests live with the implementation in AppKit.
export {
  composePdf,
  countPages,
  imposePages,
  pageGeometry,
  stampFooter,
} from '@braedonsaunders/appkit-pdf'
export type {
  ComposePart,
  ContentBox,
  ComposePdfInput,
  FooterCell,
  PageGeometry,
  StampFooterOptions,
} from '@braedonsaunders/appkit-pdf'
