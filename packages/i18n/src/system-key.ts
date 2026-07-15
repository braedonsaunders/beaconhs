/** Stable, browser-safe key shared by catalog extraction and runtime lookup. */
export function systemMessageKey(source: string): `m_${string}` {
  let high = 0xdeadbeef
  let low = 0x41c6ce57

  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index)
    high = Math.imul(high ^ code, 2_654_435_761)
    low = Math.imul(low ^ code, 1_597_334_677)
  }

  high = Math.imul(high ^ (high >>> 16), 2_246_822_507)
  high ^= Math.imul(low ^ (low >>> 13), 3_266_489_909)
  low = Math.imul(low ^ (low >>> 16), 2_246_822_507)
  low ^= Math.imul(high ^ (high >>> 13), 3_266_489_909)

  const value = 4_294_967_296 * (2_097_151 & low) + (high >>> 0)
  return `m_${value.toString(16).padStart(14, '0')}`
}
