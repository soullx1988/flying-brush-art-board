import { z } from 'zod'

export const feishuGeometryFields = {
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().nonnegative(),
  height: z.number().finite().nonnegative(),
  rotation: z.number().finite().optional(),
}

const base = {
  id: z.string().min(1),
  ...feishuGeometryFields,
  style: z.record(z.string(), z.unknown()).optional(),
  parentId: z.string().min(1).optional(),
  zIndex: z.union([z.string(), z.number()]).optional(),
}

const point = z.object({ x: z.number().finite(), y: z.number().finite(), pressure: z.number().finite().optional() }).passthrough()
const endpoint = z.object({
  elementId: z.string().min(1).optional(),
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
}).passthrough().superRefine((value, context) => {
  if (value.elementId || (value.x !== undefined && value.y !== undefined)) return
  context.addIssue({ code: 'custom', message: 'Endpoint requires an elementId or complete x/y point' })
})

export const feishuKnownNodeSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('shape'), shape: z.string().min(1), text: z.string().optional() }).passthrough(),
  z.object({ ...base, type: z.literal('text'), text: z.string() }).passthrough(),
  z.object({ ...base, type: z.literal('sticky_note'), text: z.string() }).passthrough(),
  z.object({ ...base, type: z.literal('image'), mediaToken: z.string().min(1), mimeType: z.string().min(1).optional(), name: z.string().optional() }).passthrough(),
  z.object({ ...base, type: z.literal('connector'), start: endpoint, end: endpoint, text: z.string().optional() }).passthrough(),
  z.object({ ...base, type: z.literal('section'), title: z.string() }).passthrough(),
  z.object({ ...base, type: z.literal('table'), cells: z.array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()]))) }).passthrough(),
  z.object({ ...base, type: z.literal('freehand'), points: z.array(point).min(1) }).passthrough(),
  z.object({ ...base, type: z.literal('svg'), svg: z.string().min(1) }).passthrough(),
  z.object({ ...base, type: z.literal('mind_map'), text: z.string(), children: z.array(z.unknown()).optional() }).passthrough(),
])

export type FeishuKnownNode = z.infer<typeof feishuKnownNodeSchema>

export function extractFeishuNodes(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  const parsed = z.object({ nodes: z.array(z.unknown()) }).passthrough().safeParse(value)
  return parsed.success ? parsed.data.nodes : [value]
}
