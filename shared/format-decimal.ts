/** Format exact survey totals without converting their canonical decimal strings to Number. */
export const formatSurveyDecimal = (value: string | null | undefined, locale: string): string => {
  if (value == null) return '—'
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value)
  if (!match) return value
  const [, sign, integer, fraction] = match
  if (!integer) return value
  const formatter = new Intl.NumberFormat(locale)
  const whole = formatter.format(BigInt(`${sign}${integer}`))
  const signedWhole = sign && BigInt(integer) === BigInt(0) ? `-${whole}` : whole
  const decimal = formatter.formatToParts(1.1).find(part => part.type === 'decimal')?.value ?? '.'
  return fraction ? `${signedWhole}${decimal}${fraction}` : signedWhole
}
