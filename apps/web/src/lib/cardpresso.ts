import 'server-only'

import { secureFetch } from '@beaconhs/sync/egress'
import { buildCardPressoPrintXml } from './cardpresso-xml'

type CardPressoConfig = {
  url: string
  basicAuthUsername: string
  basicAuthPassword: string
  loginName: string
  loginPassword: string
  cardDocument: string
  printer: string
  frontItemId: string
  backItemId: string
}

export type CardPressoPrintResult = {
  jobId: string | null
  status: string | null
  message: string | null
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`cardPresso direct printing is not configured (${name}).`)
  return value
}

function configuration(): CardPressoConfig {
  return {
    url: requiredEnvironment('CARDPRESSO_WPS_URL'),
    basicAuthUsername: process.env.CARDPRESSO_WPS_BASIC_AUTH_USERNAME?.trim() || 'wps',
    basicAuthPassword: requiredEnvironment('CARDPRESSO_WPS_BASIC_AUTH_PASSWORD'),
    loginName: requiredEnvironment('CARDPRESSO_WPS_LOGIN_NAME'),
    loginPassword: requiredEnvironment('CARDPRESSO_WPS_LOGIN_PASSWORD'),
    cardDocument: requiredEnvironment('CARDPRESSO_WPS_CARD_DOCUMENT'),
    printer: requiredEnvironment('CARDPRESSO_WPS_PRINTER'),
    frontItemId: process.env.CARDPRESSO_WPS_FRONT_ITEM_ID?.trim() || 'BEACON_FRONT',
    backItemId: process.env.CARDPRESSO_WPS_BACK_ITEM_ID?.trim() || 'BEACON_BACK',
  }
}

export function cardPressoConfigured(): boolean {
  return [
    'CARDPRESSO_WPS_URL',
    'CARDPRESSO_WPS_BASIC_AUTH_PASSWORD',
    'CARDPRESSO_WPS_LOGIN_NAME',
    'CARDPRESSO_WPS_LOGIN_PASSWORD',
    'CARDPRESSO_WPS_CARD_DOCUMENT',
    'CARDPRESSO_WPS_PRINTER',
  ].every((name) => Boolean(process.env[name]?.trim()))
}

function tag(body: string, name: string): string | null {
  const match = body.match(new RegExp(`<${name}(?:\\s[^>]*)?>([^<]{0,4000})</${name}>`, 'i'))
  return match?.[1]?.trim() || null
}

export async function sendCardPressoPrint(images: {
  front: Buffer
  back?: Buffer | null
}): Promise<CardPressoPrintResult> {
  const config = configuration()
  const body = buildCardPressoPrintXml(config, images)
  const authorization = Buffer.from(
    `${config.basicAuthUsername}:${config.basicAuthPassword}`,
    'utf8',
  ).toString('base64')
  const response = await secureFetch(config.url, {
    method: 'POST',
    headers: {
      authorization: `Basic ${authorization}`,
      'content-type': 'application/xml; charset=utf-8',
      accept: 'application/xml, text/xml',
    },
    body,
    timeoutMs: 30_000,
    maxRequestBytes: 16 * 1024 * 1024,
    maxResponseBytes: 1024 * 1024,
    maxRedirects: 0,
  })
  const responseBody = await response.text()
  const statusMatch = responseBody.match(/<jobStatus\b[^>]*\bstatus="([^"]{1,100})"/i)
  const jobMatch = responseBody.match(/\bprintJobId="([^"]{1,100})"/i)
  const result: CardPressoPrintResult = {
    jobId: jobMatch?.[1] ?? null,
    status: statusMatch?.[1] ?? null,
    message: tag(responseBody, 'statusMessage'),
  }
  if (!response.ok || result.status?.toUpperCase() === 'ERROR') {
    throw new Error(result.message || `cardPresso rejected the print job (${response.status}).`)
  }
  return result
}
