// LibreOffice + poppler helpers shared by the worker (slides import, document
// version renders, book concatenation) and the web app (draft text extraction
// for the document AI panel). Both binaries ship in the production image;
// locally `brew install --cask libreoffice` + `brew install poppler`.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const exec = promisify(execFile)

const SOFFICE_CANDIDATES = [
  process.env.SOFFICE_PATH,
  'soffice',
  '/usr/bin/soffice',
  '/Applications/LibreOffice.app/Contents/MacOS/soffice',
].filter((p): p is string => !!p)

export async function resolveSoffice(): Promise<string> {
  for (const candidate of SOFFICE_CANDIDATES) {
    if (candidate.includes('/')) {
      try {
        await access(candidate)
        return candidate
      } catch {
        continue
      }
    } else {
      try {
        await exec(candidate, ['--version'], { timeout: 15_000 })
        return candidate
      } catch {
        continue
      }
    }
  }
  throw new Error(
    'LibreOffice (soffice) is not installed on the worker — install libreoffice (mac: brew install --cask libreoffice) or set SOFFICE_PATH.',
  )
}

/**
 * Convert one office file with LibreOffice headless. `convertTo` is soffice's
 * --convert-to argument (e.g. 'pdf', 'txt:Text'); returns the converted bytes.
 */
const SOFFICE_ATTEMPTS = 3

function sofficeErrorDetail(error: unknown): string {
  const err = error as { message?: string; stderr?: string; stdout?: string }
  return [err.message, err.stderr, err.stdout].filter(Boolean).join('\n').trim()
}

export async function sofficeConvert(
  input: Buffer,
  inputName: string,
  convertTo: string,
): Promise<Buffer> {
  const soffice = await resolveSoffice()
  let lastError: unknown
  for (let attempt = 1; attempt <= SOFFICE_ATTEMPTS; attempt++) {
    const workDir = await mkdtemp(join(tmpdir(), 'bhs-office-'))
    try {
      const srcPath = join(workDir, inputName)
      await writeFile(srcPath, input)
      await exec(soffice, ['--headless', '--convert-to', convertTo, '--outdir', workDir, srcPath], {
        timeout: 180_000,
        env: { ...process.env, HOME: workDir },
      })
      const outExt = convertTo.split(':')[0]!
      const outPath = srcPath.replace(/\.[^.]+$/, `.${outExt}`)
      try {
        // Read directly: checking access and then reopening creates a needless
        // time-of-check/time-of-use window. The private random work directory is
        // cleaned in finally regardless of whether LibreOffice produced output.
        return await readFile(outPath)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new Error(`LibreOffice did not produce a .${outExt} from ${inputName}`)
        }
        throw error
      }
    } catch (error) {
      lastError = error
      if (attempt === SOFFICE_ATTEMPTS) {
        throw new Error(
          `LibreOffice convert failed after ${SOFFICE_ATTEMPTS} attempts: ${sofficeErrorDetail(error)}`,
        )
      }
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => {})
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`LibreOffice convert failed: ${sofficeErrorDetail(lastError)}`)
}

/** Concatenate PDFs in order with poppler's pdfunite. */
export async function pdfUnite(pdfs: Buffer[]): Promise<Buffer> {
  if (pdfs.length === 0) throw new Error('pdfUnite needs at least one PDF')
  if (pdfs.length === 1) return pdfs[0]!
  const workDir = await mkdtemp(join(tmpdir(), 'bhs-pdfunite-'))
  try {
    const inputs: string[] = []
    for (let i = 0; i < pdfs.length; i++) {
      const p = join(workDir, `in-${String(i).padStart(4, '0')}.pdf`)
      await writeFile(p, pdfs[i]!)
      inputs.push(p)
    }
    const outPath = join(workDir, 'out.pdf')
    await exec('pdfunite', [...inputs, outPath], { timeout: 180_000 })
    return await readFile(outPath)
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {})
  }
}
export * from './fodt'
export * from './limits'
