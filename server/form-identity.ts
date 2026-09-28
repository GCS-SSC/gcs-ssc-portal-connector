import { createHash } from 'node:crypto'

export const foreignId = (value: string) =>
  (BigInt(`0x${createHash('sha256').update(value).digest('hex').slice(0, 15)}`) + BigInt(1)).toString()
