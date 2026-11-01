import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions/v2';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import * as z from 'zod/v4';
import { db, hh, storage, callableOpts, requireAuth, requireMember, str } from './lib/admin';
import { statusFromConfidence } from './engine';

export const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');
const MODEL = 'claude-haiku-5-5';

const RecognitionSchema = z.object({
  items: z.array(
    z.object({
      itemId: z.string(),
      seen: z.enum(['yes', 'no', 'unsure']),
      confidence: z.number(),
      countEstimate: z.number().nullable(),
    }),
  ),
  extras: z.array(z.object({ label: z.string(), confidence: z.number() })),
});

type Seen = boolean | 'unsure';
interface Rec {
  itemId: string;
  seen: Seen;
  confidence: number;
  countEstimate: number | null;
}

const SYSTEM = `You check a photo of a vegetable/fruit delivery basket in an Indian household against the order.
For every ordered item, judge whether it is visible in the photo.
- "confidence" is the probability (0 to 1) that the item IS present in the photo.
- "seen" is "yes", "no" or "unsure", consistent with confidence.
- "countEstimate" is a rough count of pieces/bunches if countable, else null.
Use only the itemId values given. List any other clearly visible produce that is not on the order in "extras" with a short English label.
Leafy greens look alike (spinach, fenugreek, dill, amaranth): if you cannot tell them apart, use a middle confidence rather than guessing.`;

/**
 * Callable after a delivery photo is uploaded. Runs vision recognition, stores it on the photo doc,
 * merges every photo of the order by max confidence and writes receivedStatus/photoConfidence on
 * order items. Never sets receivedQty. On any failure returns {fallback: true} so the client shows
 * a plain tick list.
 */
export const recogniseDelivery = onCall(
  { ...callableOpts, secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 120, memory: '512MiB' },
  async (req) => {
    const uid = requireAuth(req);
    const d = (req.data ?? {}) as Record<string, unknown>;
    const hid = str(d.householdId, 'householdId');
    const oid = str(d.orderId, 'orderId');
    const pid = str(d.photoId, 'photoId');
    await requireMember(hid, uid);

    const orderRef = hh(hid).collection('orders').doc(oid);
    const photoRef = orderRef.collection('photos').doc(pid);
    const [photo, lines, itemsSnap] = await Promise.all([
      photoRef.get(),
      orderRef.collection('items').get(),
      hh(hid).collection('items').get(),
    ]);
    if (!photo.exists) throw new HttpsError('not-found', 'Photo not found');
    const storagePath: string = photo.get('storagePath');
    if (!storagePath?.startsWith(`households/${hid}/orders/${oid}/`)) {
      throw new HttpsError('permission-denied', 'Bad storage path');
    }

    const itemById = new Map(itemsSnap.docs.map((i) => [i.id, i]));
    const ordered = lines.docs
      .filter((l) => l.get('status') !== 'removed' && itemById.has(l.id))
      .map((l) => {
        const it = itemById.get(l.id)!;
        return { itemId: l.id, nameEn: it.get('nameEn'), nameHi: it.get('nameHi'), nameMr: it.get('nameMr'), qty: l.get('qty'), unit: l.get('unit') };
      });

    try {
      const file = storage.bucket().file(storagePath);
      const [[buf], [meta]] = await Promise.all([file.download(), file.getMetadata()]);
      const mediaType = (meta.contentType ?? 'image/jpeg') as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

      const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });
      // Haiku 5.5 has no server-side refusal fallback; a refusal falls through to the client tick list.
      const response = await client.messages.parse({
        model: MODEL,
        max_tokens: 4000,
        output_config: { effort: 'low', format: zodOutputFormat(RecognitionSchema) },
        system: SYSTEM,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType, data: buf.toString('base64') } },
              { type: 'text', text: `Ordered items (JSON):\n${JSON.stringify(ordered)}` },
            ],
          },
        ],
      });

      if (response.stop_reason === 'refusal' || !response.parsed_output) {
        logger.warn('recognition unusable', { stop: response.stop_reason });
        return { fallback: true };
      }

      const valid = new Set(ordered.map((o) => o.itemId));
      const clamp = (n: number) => Math.min(1, Math.max(0, n));
      const recognition: Rec[] = response.parsed_output.items
        .filter((r) => valid.has(r.itemId))
        .map((r) => ({
          itemId: r.itemId,
          seen: r.seen === 'yes' ? true : r.seen === 'no' ? false : 'unsure',
          confidence: clamp(r.confidence),
          countEstimate: r.countEstimate,
        }));
      const extras = response.parsed_output.extras.map((e) => ({ label: e.label, confidence: clamp(e.confidence) }));
      await photoRef.update({ recognition, extras });

      // Merge all photos of this order by max confidence
      const photos = await orderRef.collection('photos').get();
      const best = new Map<string, Rec>();
      const allExtras = new Map<string, number>();
      for (const p of photos.docs) {
        for (const r of (p.id === pid ? recognition : p.get('recognition') ?? []) as Rec[]) {
          const prev = best.get(r.itemId);
          if (!prev || r.confidence > prev.confidence) best.set(r.itemId, r);
        }
        for (const e of (p.id === pid ? extras : p.get('extras') ?? []) as { label: string; confidence: number }[]) {
          allExtras.set(e.label, Math.max(allExtras.get(e.label) ?? 0, e.confidence));
        }
      }

      const batch = db.batch();
      const merged = ordered.map((o) => {
        const r = best.get(o.itemId);
        const confidence = r?.confidence ?? 0;
        const receivedStatus = statusFromConfidence(confidence);
        batch.update(orderRef.collection('items').doc(o.itemId), { receivedStatus, photoConfidence: confidence });
        return { itemId: o.itemId, receivedStatus, confidence, countEstimate: r?.countEstimate ?? null };
      });
      await batch.commit();

      return {
        fallback: false,
        items: merged,
        extras: [...allExtras].map(([label, confidence]) => ({ label, confidence })),
      };
    } catch (err) {
      logger.error('recogniseDelivery failed', { hid, oid, pid, err });
      return { fallback: true };
    }
  },
);
