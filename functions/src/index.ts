import { setGlobalOptions } from 'firebase-functions/v2';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { callableOpts, hh, requireAuth, requireMember, str, REGION } from './lib/admin';
import { addDays, istDateString, nextDeliveryAfter } from './lib/time';
import { proposeForVendor } from './proposeOrders';

setGlobalOptions({ region: REGION, maxInstances: 10 });

export { proposeOrders } from './proposeOrders';
export { buildMessage } from './buildMessage';
export { checkLateDeliveries } from './checkLateDeliveries';
export { recogniseDelivery } from './recogniseDelivery';
export { confirmDelivery } from './confirmDelivery';
export { onStockEvent, onMemberWrite, onQueueAdd } from './onStockEvent';
export { createHousehold, joinHousehold } from './joinHousehold';

/** "Make a list now" — runs the same engine immediately for the vendor's next delivery day. */
export const generateDraftNow = onCall(callableOpts, async (req) => {
  const uid = requireAuth(req);
  const d = (req.data ?? {}) as Record<string, unknown>;
  const hid = str(d.householdId, 'householdId');
  const vid = str(d.vendorId, 'vendorId');
  await requireMember(hid, uid);
  const vendor = await hh(hid).collection('vendors').doc(vid).get();
  if (!vendor.exists) throw new HttpsError('not-found', 'Vendor not found');
  const today = istDateString(new Date());
  const forDate = nextDeliveryAfter(today, vendor.get('deliveryDays') ?? []) ?? addDays(today, 1);
  const orderId = await proposeForVendor(hid, vid, forDate, new Date(), true);
  if (!orderId) throw new HttpsError('already-exists', `A list for ${forDate} already exists`);
  return { orderId, forDate };
});
