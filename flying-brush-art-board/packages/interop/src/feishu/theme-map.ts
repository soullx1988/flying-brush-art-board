import { z } from 'zod'

export interface InteropTheme {
  background: string
  primary: string
  text: string
  sourcePayload: unknown
}

const themeSchema = z.object({
  backgroundColor: z.string().optional(),
  primaryColor: z.string().optional(),
  textColor: z.string().optional(),
}).passthrough()

export function mapFeishuTheme(value: unknown): InteropTheme {
  const parsed = themeSchema.safeParse(value)
  const theme = parsed.success ? parsed.data : {}
  return {
    background: theme.backgroundColor ?? '#ffffff',
    primary: theme.primaryColor ?? '#3370ff',
    text: theme.textColor ?? '#1f2329',
    sourcePayload: structuredClone(value),
  }
}
