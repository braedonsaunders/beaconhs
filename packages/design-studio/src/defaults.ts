import type {
  DesignArtboard,
  DesignDataField,
  DesignDocument,
  DesignElement,
  PrintProfile,
} from './schema'

export const DESIGN_STUDIO_DPI = 96

export const LETTER_LANDSCAPE = { width: 11, height: 8.5 }
export const LETTER_PORTRAIT = { width: 8.5, height: 11 }
export const CR80 = { width: 3.375, height: 2.125 }
export const LABEL_4X6 = { width: 4, height: 6 }

const certificatePrintProfile: PrintProfile = {
  provider: 'browser-pdf',
  media: 'letter',
  edgeToEdge: true,
  orientation: 'landscape',
}

const cardPrintProfile: PrintProfile = {
  provider: 'browser-pdf',
  media: 'cr80',
  duplex: true,
  edgeToEdge: true,
  orientation: 'landscape',
}

export type DesignStudioTheme = {
  primary: string
  accent: string
  paper: string
  typeface?: 'classic' | 'modern' | 'technical'
}

export const DEFAULT_DESIGN_STUDIO_THEME: DesignStudioTheme = {
  primary: '#18385f',
  accent: '#b8892f',
  paper: '#fdf9ef',
  typeface: 'classic',
}

export function createCertificateDesignDocument(
  theme: DesignStudioTheme = DEFAULT_DESIGN_STUDIO_THEME,
): DesignDocument {
  const font = fontFor(theme.typeface)
  return {
    version: 1,
    engine: 'fabric',
    kind: 'training-credential',
    name: 'Full-size certificate',
    unit: 'in',
    dpi: DESIGN_STUDIO_DPI,
    artboards: [
      {
        id: 'certificate',
        name: 'Certificate',
        format: 'letter-landscape',
        width: LETTER_LANDSCAPE.width,
        height: LETTER_LANDSCAPE.height,
        background: theme.paper,
        bleed: 0,
        printProfile: certificatePrintProfile,
        elements: [
          rect(
            'outer-frame',
            'Outer frame',
            0.34,
            0.34,
            10.32,
            7.82,
            'transparent',
            theme.primary,
            0.035,
          ),
          rect(
            'accent-frame',
            'Accent frame',
            0.47,
            0.47,
            10.06,
            7.56,
            'transparent',
            theme.accent,
            0.018,
          ),
          field('tenant', 'Issuer', 'tenant.name', 1.2, 0.72, 8.6, 0.28, 13, theme.primary, {
            align: 'center',
            letterSpacing: 0.08,
            fontFamily: "'Archivo', Arial, sans-serif",
          }),
          line('brand-rule', 'Brand rule', 3.8, 1.1, 3.4, 0.01, theme.accent, 0.018),
          text('title', 'Title', 'CERTIFICATE', 1.25, 1.48, 8.5, 0.62, 46, theme.primary, {
            align: 'center',
            fontFamily: font.display,
            fontWeight: '700',
            letterSpacing: 0.08,
          }),
          text('subtitle', 'Subtitle', 'OF COMPLETION', 2.85, 2.08, 5.3, 0.28, 11, theme.accent, {
            align: 'center',
            fontFamily: "'Archivo', Arial, sans-serif",
            fontWeight: '700',
            letterSpacing: 0.1,
          }),
          text('preface', 'Preface', 'This certifies that', 3.35, 2.86, 4.3, 0.26, 14, '#475569', {
            align: 'center',
            fontStyle: 'italic',
            fontWeight: '400',
          }),
          field(
            'recipient',
            'Recipient name',
            'recipient.fullName',
            1.3,
            3.12,
            8.4,
            0.62,
            44,
            theme.primary,
            {
              align: 'center',
              fontFamily: font.recipient,
              fontWeight: '700',
            },
          ),
          line('recipient-rule', 'Recipient rule', 2.15, 3.86, 6.7, 0.01, theme.accent, 0.015),
          field(
            'credential',
            'Credential name',
            'credential.name',
            1.55,
            4.32,
            7.9,
            0.56,
            25,
            '#0f172a',
            {
              align: 'center',
              fontFamily: font.body,
              fontWeight: '700',
            },
          ),
          field(
            'course-code',
            'Course code',
            'credential.code',
            3.8,
            4.94,
            3.4,
            0.24,
            10,
            '#64748b',
            {
              align: 'center',
              prefix: 'Course ',
              fontFamily: "'Archivo', Arial, sans-serif",
              letterSpacing: 0.07,
            },
          ),
          meta('completed', 'Completed', 'completedOn', 1.65, 5.65, theme.primary),
          meta('expires', 'Valid until', 'expiresOn', 4.55, 5.65, theme.primary),
          meta('instructor', 'Instructor', 'instructor', 7.1, 5.65, theme.primary),
          seal('seal', 'Issuer seal', 4.9, 6.48, 1.18, 1.18, theme.accent, theme.primary),
          line('signature-left', 'Signature line', 1.2, 7.2, 2.4, 0.01, theme.primary, 0.012),
          text(
            'signature-left-label',
            'Signature label',
            'Instructor / Evaluator',
            1.2,
            7.28,
            2.4,
            0.18,
            8,
            '#64748b',
            {
              align: 'center',
              fontFamily: "'Archivo', Arial, sans-serif",
            },
          ),
          line('signature-right', 'Issuer line', 7.4, 7.2, 2.4, 0.01, theme.primary, 0.012),
          text(
            'signature-right-label',
            'Issuer label',
            'Issued by Beacon',
            7.4,
            7.28,
            2.4,
            0.18,
            8,
            '#64748b',
            {
              align: 'center',
              fontFamily: "'Archivo', Arial, sans-serif",
            },
          ),
          qr('qr', 'Verification QR', 9.42, 0.72, 0.82, 0.82),
          field(
            'verify-token',
            'Verify token',
            'verify.token',
            8.35,
            7.68,
            2.0,
            0.16,
            5.5,
            '#64748b',
            {
              align: 'right',
              fontFamily: "ui-monospace, 'SF Mono', monospace",
              prefix: 'Token ',
            },
          ),
        ],
      },
    ],
  }
}

export function createWalletDesignDocument(
  theme: DesignStudioTheme = DEFAULT_DESIGN_STUDIO_THEME,
): DesignDocument {
  return {
    version: 1,
    engine: 'fabric',
    kind: 'training-credential',
    name: 'Wallet card',
    unit: 'in',
    dpi: DESIGN_STUDIO_DPI,
    artboards: [walletFront(theme), walletBack(theme)],
  }
}

function walletFront(theme: DesignStudioTheme): DesignArtboard {
  return {
    id: 'wallet-front',
    name: 'Front',
    format: 'cr80-front',
    width: CR80.width,
    height: CR80.height,
    background: theme.paper,
    bleed: 0,
    printProfile: cardPrintProfile,
    elements: [
      rect('brand-band', 'Brand band', 0, 0, 3.375, 0.55, theme.primary, theme.primary, 0),
      rect('accent-rule', 'Accent rule', 0, 0.55, 3.375, 0.035, theme.accent, theme.accent, 0),
      field('tenant', 'Issuer', 'tenant.name', 0.14, 0.15, 2.45, 0.16, 7, '#ffffff', {
        fontFamily: "'Archivo', Arial, sans-serif",
        fontWeight: '800',
        letterSpacing: 0.025,
        transform: 'uppercase',
      }),
      text('tag', 'Card label', 'TRAINING CREDENTIAL', 0.14, 0.32, 2.25, 0.12, 4.6, '#dbeafe', {
        fontFamily: "'Archivo', Arial, sans-serif",
        fontWeight: '700',
        letterSpacing: 0.045,
      }),
      image('logo', 'Logo', 'tenant.logo', 2.63, 0.13, 0.56, 0.26, 'contain'),
      image('photo', 'Photo', 'recipient.photo', 0.14, 0.36, 0.68, 0.84, 'cover', 0.06),
      field('recipient', 'Recipient', 'recipient.fullName', 0.94, 0.67, 2.22, 0.2, 10, '#0f172a', {
        fontFamily: "'Archivo', Arial, sans-serif",
        fontWeight: '800',
      }),
      field(
        'employee',
        'Employee number',
        'recipient.employeeNo',
        0.94,
        0.9,
        1.5,
        0.12,
        5.2,
        '#64748b',
        {
          fontFamily: "ui-monospace, 'SF Mono', monospace",
          prefix: '#',
        },
      ),
      field('credential', 'Credential', 'credential.name', 0.94, 1.07, 2.2, 0.34, 7.4, '#1e293b', {
        fontFamily: "'Archivo', Arial, sans-serif",
        fontWeight: '700',
        lineHeight: 1.1,
      }),
      field('code', 'Code', 'credential.code', 0.94, 1.47, 0.75, 0.14, 5.5, theme.primary, {
        fontFamily: "ui-monospace, 'SF Mono', monospace",
        fontWeight: '700',
      }),
      meta('completed', 'Completed', 'completedOn', 0.14, 1.73, theme.primary, 0.75, 0.24, 5.2),
      meta('expires', 'Expires', 'expiresOn', 0.95, 1.73, theme.primary, 0.75, 0.24, 5.2),
      qr('qr-mini', 'QR', 2.73, 1.55, 0.42, 0.42),
      seal('seal', 'Seal', 2.34, 1.58, 0.36, 0.36, theme.accent, theme.primary),
    ],
  }
}

function walletBack(theme: DesignStudioTheme): DesignArtboard {
  return {
    id: 'wallet-back',
    name: 'Back',
    format: 'cr80-back',
    width: CR80.width,
    height: CR80.height,
    background: theme.primary,
    bleed: 0,
    printProfile: cardPrintProfile,
    elements: [
      rect('back-field', 'Security field', 0.1, 0.1, 3.175, 1.925, '#ffffff', theme.accent, 0.012),
      qr('qr', 'Verification QR', 0.18, 0.23, 0.86, 0.86),
      text(
        'verify-label',
        'Verify label',
        'VERIFY THIS CARD',
        1.18,
        0.28,
        1.9,
        0.14,
        6.2,
        theme.primary,
        {
          fontFamily: "'Archivo', Arial, sans-serif",
          fontWeight: '800',
          letterSpacing: 0.045,
        },
      ),
      field('verify-url', 'Verify URL', 'verify.url', 1.18, 0.47, 1.88, 0.24, 5.8, '#334155', {
        fontFamily: "ui-monospace, 'SF Mono', monospace",
        lineHeight: 1.1,
      }),
      field('verify-token', 'Verify token', 'verify.token', 1.18, 0.79, 1.9, 0.14, 5.2, '#64748b', {
        fontFamily: "ui-monospace, 'SF Mono', monospace",
        prefix: 'Token ',
      }),
      field('issuer', 'Issuer', 'tenant.name', 0.18, 1.33, 2.95, 0.18, 6.2, theme.primary, {
        fontFamily: "'Archivo', Arial, sans-serif",
        fontWeight: '700',
        align: 'center',
      }),
      text(
        'notice',
        'Notice',
        'This credential remains property of the issuer and must be verified before site access.',
        0.28,
        1.58,
        2.82,
        0.22,
        5.5,
        '#475569',
        { align: 'center', lineHeight: 1.1, fontFamily: "'Archivo', Arial, sans-serif" },
      ),
    ],
  }
}

// --- Equipment QR label (4×6in thermal label) ------------------------------
//
// Faithful port of the legacy Blade label (equipmentqrcode.blade.php):
// 101.6×152.4mm page, 1.5mm margin, 1px black outer border, header band
// (uppercase 800-weight 6mm "EQUIPMENT" + 3.5mm 700-weight division, 1px
// bottom rule), then a 58mm QR column (1px border, 2mm padding) beside the
// info column (5.5mm 800 name + 21mm-key rows TAG/CLASS/SERIAL/INSPECT at
// 3.6mm with uppercase 700 keys). All metrics below are the legacy mm values
// converted to the studio's inch unit; fonts convert mm → pt (× 72 / 25.4).

const PX_IN = 1 / 96 // 1 CSS px → inches

const LABEL_FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif"

export function createEquipmentLabelDesignDocument(): DesignDocument {
  // A print-first 4×6in tag in the spirit of the legacy thermal label —
  // black-bordered frame, EQUIPMENT header band, a large centred QR, and
  // full-width spec rows underneath (the legacy side-by-side columns squeezed
  // values into ~8mm on absolute layout, so the rows moved below the QR).
  const m = 0.06 // frame inset
  const pad = 0.16 // content padding inside the frame
  const rightEdge = 4 - pad
  const keyStyle = {
    fontFamily: LABEL_FONT,
    fontWeight: '700' as const,
    letterSpacing: 0.005,
    lineHeight: 1.15,
  }
  const valStyle = { fontFamily: LABEL_FONT, fontWeight: '600' as const, lineHeight: 1.15 }
  const rowYs = { tag: 4.28, class: 4.585, serial: 4.89, inspected: 5.195, nextDue: 5.5 }
  const keyRow = (id: string, label: string, y: number): DesignElement =>
    text(
      `${id}-key`,
      `${label} key`,
      label.toUpperCase(),
      pad,
      y,
      0.95,
      0.2,
      10,
      '#000000',
      keyStyle,
    )
  const valueRow = (
    id: string,
    name: string,
    value: DesignDataField,
    y: number,
    extra: Partial<Extract<DesignElement, { kind: 'field' }>> = {},
  ): DesignElement =>
    field(`${id}-value`, name, value, 1.16, y, rightEdge - 1.16, 0.2, 10, '#000000', {
      ...valStyle,
      ...extra,
    })

  return {
    version: 1,
    engine: 'fabric',
    kind: 'equipment-label',
    name: 'Equipment QR label',
    unit: 'in',
    dpi: DESIGN_STUDIO_DPI,
    artboards: [
      {
        id: 'label',
        name: 'Label',
        format: 'label-4x6',
        width: LABEL_4X6.width,
        height: LABEL_4X6.height,
        background: '#ffffff',
        bleed: 0,
        printProfile: {
          provider: 'browser-pdf',
          media: 'custom',
          edgeToEdge: true,
          orientation: 'portrait',
        },
        elements: [
          rect(
            'label-border',
            'Label border',
            m,
            m,
            4 - m * 2,
            6 - m * 2,
            'transparent',
            '#000000',
            PX_IN,
          ),
          text('brand', 'Header — EQUIPMENT', 'EQUIPMENT', pad, 0.17, 2.0, 0.28, 17, '#000000', {
            fontFamily: LABEL_FONT,
            fontWeight: '800',
            letterSpacing: 0.01,
            lineHeight: 1,
          }),
          field(
            'division',
            'Site / division',
            'equipment.division',
            1.9,
            0.235,
            rightEdge - 1.9,
            0.18,
            10,
            '#000000',
            { fontFamily: LABEL_FONT, fontWeight: '700', align: 'right', lineHeight: 1 },
          ),
          line('header-rule', 'Header rule', m, 0.55, 4 - m * 2, 0.05, '#000000', PX_IN),
          field(
            'name',
            'Equipment name',
            'equipment.name',
            pad,
            0.68,
            4 - pad * 2,
            0.6,
            16,
            '#000000',
            {
              fontFamily: LABEL_FONT,
              fontWeight: '800',
              lineHeight: 1.1,
            },
          ),
          rect('qr-panel', 'QR panel', 0.64, 1.38, 2.72, 2.72, '#ffffff', '#000000', PX_IN),
          qr('qr', 'Scan QR', 0.72, 1.46, 2.56, 2.56),
          keyRow('tag', 'Tag', rowYs.tag),
          valueRow('tag', 'Asset tag', 'equipment.assetTag', rowYs.tag),
          keyRow('class', 'Class', rowYs.class),
          valueRow('class', 'Class', 'equipment.class', rowYs.class),
          keyRow('serial', 'Serial', rowYs.serial),
          valueRow('serial', 'Serial number', 'equipment.serial', rowYs.serial),
          keyRow('inspected', 'Inspected', rowYs.inspected),
          valueRow('inspect-last', 'Last inspection', 'equipment.lastInspection', rowYs.inspected, {
            transform: 'date-short',
          }),
          keyRow('next-due', 'Next due', rowYs.nextDue),
          valueRow(
            'inspect-next',
            'Next inspection due',
            'equipment.nextInspectionDue',
            rowYs.nextDue,
            {
              transform: 'date-short',
            },
          ),
        ],
      },
    ],
  }
}

// --- Person ID badge (two-sided CR80) ---------------------------------------
//
// Front: brand band with the company name + logo, the person's photo, name,
// employee number, title, and department. Back: a QR panel that opens the
// person's PUBLIC live training transcript (verify.url), plus a return notice.
// Tenants restyle every element in the badge studio; this default is a clean,
// neutral starting point.

export function createPersonBadgeDesignDocument(
  theme: DesignStudioTheme = DEFAULT_DESIGN_STUDIO_THEME,
): DesignDocument {
  return {
    version: 1,
    engine: 'fabric',
    kind: 'person-badge',
    name: 'ID badge',
    unit: 'in',
    dpi: DESIGN_STUDIO_DPI,
    artboards: [personBadgeFront(theme), personBadgeBack(theme)],
  }
}

function personBadgeFront(theme: DesignStudioTheme): DesignArtboard {
  return {
    id: 'badge-front',
    name: 'Front',
    format: 'cr80-front',
    width: CR80.width,
    height: CR80.height,
    background: '#ffffff',
    bleed: 0,
    printProfile: cardPrintProfile,
    elements: [
      rect('brand-band', 'Brand band', 0, 0, 3.375, 0.52, theme.primary, theme.primary, 0),
      rect('accent-rule', 'Accent rule', 0, 0.52, 3.375, 0.035, theme.accent, theme.accent, 0),
      field('tenant', 'Company', 'tenant.name', 0.14, 0.14, 2.4, 0.16, 7.2, '#ffffff', {
        fontFamily: "'Archivo', Arial, sans-serif",
        fontWeight: '800',
        letterSpacing: 0.02,
        transform: 'uppercase',
      }),
      text('tag', 'Card label', 'EMPLOYEE ID', 0.14, 0.32, 2.2, 0.12, 4.6, '#dbeafe', {
        fontFamily: "'Archivo', Arial, sans-serif",
        fontWeight: '700',
        letterSpacing: 0.04,
      }),
      image('logo', 'Logo', 'tenant.logo', 2.62, 0.12, 0.58, 0.28, 'contain'),
      image('photo', 'Photo', 'recipient.photo', 0.16, 0.72, 0.92, 1.15, 'cover', 0.08),
      field('name', 'Name', 'recipient.fullName', 1.22, 0.78, 2.0, 0.36, 11, '#0f172a', {
        fontFamily: "'Archivo', Arial, sans-serif",
        fontWeight: '800',
        lineHeight: 1.05,
      }),
      field(
        'employee',
        'Employee number',
        'recipient.employeeNo',
        1.22,
        1.18,
        1.9,
        0.13,
        5.6,
        '#64748b',
        { fontFamily: "ui-monospace, 'SF Mono', monospace", prefix: '#' },
      ),
      field('title', 'Job title', 'person.title', 1.22, 1.38, 1.95, 0.15, 6.4, '#1e293b', {
        fontFamily: "'Archivo', Arial, sans-serif",
        fontWeight: '700',
      }),
      field(
        'department',
        'Department',
        'person.department',
        1.22,
        1.56,
        1.95,
        0.14,
        5.6,
        '#64748b',
        { fontFamily: "'Archivo', Arial, sans-serif", fontWeight: '600' },
      ),
      qr('qr-mini', 'Transcript QR', 2.78, 1.54, 0.44, 0.44),
      field('issued', 'Issued', 'issuedAt', 0.16, 1.95, 1.4, 0.12, 4.8, '#94a3b8', {
        fontFamily: "'Archivo', Arial, sans-serif",
        fontWeight: '600',
        prefix: 'Issued ',
        transform: 'date-short',
      }),
    ],
  }
}

function personBadgeBack(theme: DesignStudioTheme): DesignArtboard {
  return {
    id: 'badge-back',
    name: 'Back',
    format: 'cr80-back',
    width: CR80.width,
    height: CR80.height,
    background: theme.primary,
    bleed: 0,
    printProfile: cardPrintProfile,
    elements: [
      rect('qr-panel', 'QR panel', 0.16, 0.16, 1.02, 1.02, '#ffffff', '#ffffff', 0),
      qr('qr', 'Transcript QR', 0.24, 0.24, 0.86, 0.86),
      text(
        'scan-label',
        'Scan label',
        'SCAN FOR LIVE TRAINING RECORD',
        1.34,
        0.24,
        1.86,
        0.28,
        6.2,
        '#ffffff',
        {
          fontFamily: "'Archivo', Arial, sans-serif",
          fontWeight: '800',
          letterSpacing: 0.03,
          lineHeight: 1.2,
        },
      ),
      rect('scan-rule', 'Scan rule', 1.34, 0.6, 0.46, 0.026, theme.accent, theme.accent, 0),
      field('verify-url', 'Transcript URL', 'verify.url', 1.34, 0.7, 1.82, 0.3, 5, '#e2e8f0', {
        fontFamily: "ui-monospace, 'SF Mono', monospace",
        lineHeight: 1.2,
      }),
      field('issuer', 'Company', 'tenant.name', 0.24, 1.34, 2.9, 0.16, 6.4, '#ffffff', {
        fontFamily: "'Archivo', Arial, sans-serif",
        fontWeight: '700',
        align: 'center',
      }),
      text(
        'notice',
        'Notice',
        'This badge remains property of the employer. If found, please return it to the address above.',
        0.34,
        1.56,
        2.7,
        0.3,
        5,
        '#cbd5e1',
        { align: 'center', lineHeight: 1.25, fontFamily: "'Archivo', Arial, sans-serif" },
      ),
    ],
  }
}

function fontFor(typeface: DesignStudioTheme['typeface']) {
  if (typeface === 'technical') {
    return {
      body: "'Archivo', Arial, sans-serif",
      display: "ui-monospace, 'SF Mono', monospace",
      recipient: "'Archivo', Arial, sans-serif",
    }
  }
  if (typeface === 'modern') {
    return {
      body: "'Archivo', Arial, sans-serif",
      display: "'Archivo', Arial, sans-serif",
      recipient: "'Cormorant Garamond', Georgia, serif",
    }
  }
  return {
    body: "'Cormorant Garamond', Georgia, serif",
    display: "'Cormorant Garamond', Georgia, serif",
    recipient: "'Great Vibes', 'Apple Chancery', cursive",
  }
}

function text(
  id: string,
  name: string,
  value: string,
  x: number,
  y: number,
  width: number,
  height: number,
  fontSize: number,
  color: string,
  extra: Partial<Extract<DesignElement, { kind: 'text' }>> = {},
): DesignElement {
  return {
    id,
    name,
    kind: 'text',
    text: value,
    x,
    y,
    width,
    height,
    fontSize,
    color,
    fontFamily: "'Archivo', Arial, sans-serif",
    fontWeight: '600',
    align: 'left',
    visible: true,
    opacity: 1,
    ...extra,
  }
}

function field(
  id: string,
  name: string,
  value: DesignDataField,
  x: number,
  y: number,
  width: number,
  height: number,
  fontSize: number,
  color: string,
  extra: Partial<Extract<DesignElement, { kind: 'field' }>> = {},
): DesignElement {
  return {
    id,
    name,
    kind: 'field',
    field: value,
    x,
    y,
    width,
    height,
    fontSize,
    color,
    fontFamily: "'Archivo', Arial, sans-serif",
    fontWeight: '600',
    align: 'left',
    transform: 'none',
    fallback: '',
    visible: true,
    opacity: 1,
    ...extra,
  }
}

function meta(
  id: string,
  label: string,
  value: DesignDataField,
  x: number,
  y: number,
  color: string,
  width = 1.8,
  height = 0.42,
  fontSize = 8,
): DesignElement {
  return {
    id,
    name: label,
    kind: 'field',
    field: value,
    prefix: `${label}: `,
    x,
    y,
    width,
    height,
    fontSize,
    color,
    fontFamily: "'Archivo', Arial, sans-serif",
    fontWeight: '700',
    align: 'center',
    transform: value === 'completedOn' || value === 'expiresOn' ? 'date-long' : 'none',
    visible: true,
    opacity: 1,
  }
}

function rect(
  id: string,
  name: string,
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
  stroke: string,
  strokeWidth: number,
): DesignElement {
  return {
    id,
    name,
    kind: 'rect',
    x,
    y,
    width,
    height,
    fill,
    stroke,
    strokeWidth,
    visible: true,
    opacity: 1,
  }
}

function line(
  id: string,
  name: string,
  x: number,
  y: number,
  width: number,
  height: number,
  stroke: string,
  strokeWidth: number,
): DesignElement {
  return {
    id,
    name,
    kind: 'line',
    x,
    y,
    width,
    height,
    fill: 'transparent',
    stroke,
    strokeWidth,
    visible: true,
    opacity: 1,
  }
}

function image(
  id: string,
  name: string,
  source: 'tenant.logo' | 'recipient.photo',
  x: number,
  y: number,
  width: number,
  height: number,
  fit: 'contain' | 'cover',
  radius = 0,
): DesignElement {
  return {
    id,
    name,
    kind: 'image',
    source,
    x,
    y,
    width,
    height,
    fit,
    radius,
    visible: true,
    opacity: 1,
  }
}

function qr(
  id: string,
  name: string,
  x: number,
  y: number,
  width: number,
  height: number,
): DesignElement {
  return {
    id,
    name,
    kind: 'qr',
    field: 'verify.qr',
    x,
    y,
    width,
    height,
    background: '#ffffff',
    foreground: '#0f172a',
    visible: true,
    opacity: 1,
  }
}

function seal(
  id: string,
  name: string,
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
  stroke: string,
): DesignElement {
  return {
    id,
    name,
    kind: 'seal',
    x,
    y,
    width,
    height,
    fill,
    stroke,
    visible: true,
    opacity: 1,
  }
}
