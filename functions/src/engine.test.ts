import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proposeOrder, applyLearning, statusFromConfidence, median, type EngineItem, type EngineInput } from './engine';
import { istMidnightMs, DAY_MS } from './lib/time';
import { formatQty, buildOrderText, buildShortageText } from './i18n/units';

const FOR = '2026-11-08'; // Sunday, November
const D = istMidnightMs(FOR);
const daysAgo = (n: number) => D - n * DAY_MS;

const item = (p: Partial<EngineItem> & { id: string }): EngineItem => ({
  category: 'vegetable', defaultUnit: 'kg', defaultQty: 1, shelfLifeDays: 5, seasonMonths: [], peakMonths: [],
  rotation: 'weekly', isPinned: false, isHidden: false, vendorId: null,
  lastReceivedAt: null, lastFinishedAt: null, halfLeftAt: null, medianKeptQty: null, ...p,
});

const input = (items: EngineItem[], p: Partial<EngineInput> = {}): EngineInput => ({
  forDate: FOR, nextDeliveryDate: '2026-11-11', vendorId: 'v1', vendorCategories: [], items,
  carry: [], queue: [], lastOrderAt: daysAgo(7), recentlyOrderedIds: items.map((i) => i.id), festivals: [], ...p,
});

const reasons = (out: ReturnType<typeof proposeOrder>) => Object.fromEntries(out.lines.map((l) => [l.itemId, l.reason]));

test('rule 1+2: carry-overs and queue take priority with their reasons', () => {
  const out = proposeOrder(input([item({ id: 'a' }), item({ id: 'b', rotation: 'on_demand' })], {
    carry: [{ itemId: 'a', qty: 1, unit: 'kg' }],
    queue: [{ itemId: 'b', qty: 2, unit: 'kg', addedByUid: 'u2' }],
  }));
  assert.deepEqual(reasons(out), { a: 'shortage_carry', b: 'member_added' });
  assert.equal(out.lines.find((l) => l.itemId === 'b')!.addedByUid, 'u2');
});

test('rule 3: finished since last order is included even for on_demand', () => {
  const out = proposeOrder(input([item({ id: 'x', rotation: 'on_demand', lastReceivedAt: daysAgo(6), lastFinishedAt: daysAgo(2) })]));
  assert.deepEqual(reasons(out), { x: 'finished' });
});

test('rule 3: half_left at 50% only when it expires before the next delivery', () => {
  const soon = item({ id: 's', defaultQty: 1, shelfLifeDays: 5, lastReceivedAt: daysAgo(3), halfLeftAt: daysAgo(1), rotation: 'monthly' });
  const later = item({ id: 'l', shelfLifeDays: 30, lastReceivedAt: daysAgo(3), halfLeftAt: daysAgo(1), rotation: 'monthly' });
  const out = proposeOrder(input([soon, later]));
  assert.equal(out.lines.length, 1);
  assert.equal(out.lines[0].itemId, 's');
  assert.equal(out.lines[0].qty, 0.5);
});

test('rule 4: biweekly due at ≥12 days, monthly at ≥26 days', () => {
  const out = proposeOrder(input([
    item({ id: 'bw-due', rotation: 'biweekly', lastReceivedAt: daysAgo(12) }),
    item({ id: 'bw-no', rotation: 'biweekly', lastReceivedAt: daysAgo(8) }),
    item({ id: 'm-due', rotation: 'monthly', lastReceivedAt: daysAgo(26) }),
    item({ id: 'm-no', rotation: 'monthly', lastReceivedAt: daysAgo(20) }),
  ]));
  assert.deepEqual(Object.keys(reasons(out)).sort(), ['bw-due', 'm-due']);
});

test('rule 5: shelf-life suppression writes skipped "still at home"', () => {
  const out = proposeOrder(input([item({ id: 'onion', shelfLifeDays: 30, lastReceivedAt: daysAgo(7) })]));
  assert.equal(out.lines.length, 0);
  assert.deepEqual(out.skipped, [{ itemId: 'onion', reason: 'still_at_home', receivedDaysAgo: 7 }]);
});

test('rule 6: out-of-season excluded unless pinned; up to 3 season adds, peak first', () => {
  const out = proposeOrder(input([
    item({ id: 'mango', seasonMonths: [4, 5, 6] }),
    item({ id: 'pinned-mango', seasonMonths: [4, 5, 6], isPinned: true }),
    item({ id: 's1', rotation: 'on_demand', seasonMonths: [10, 11, 12] }),
    item({ id: 's2', rotation: 'on_demand', seasonMonths: [11, 12], peakMonths: [11] }),
    item({ id: 's3', rotation: 'on_demand', seasonMonths: [11] }),
    item({ id: 's4', rotation: 'on_demand', seasonMonths: [11] }),
  ], { recentlyOrderedIds: [] }));
  const r = reasons(out);
  assert.equal(r.mango, undefined);
  assert.equal(r['pinned-mango'], 'rotation');
  const season = out.lines.filter((l) => l.reason === 'season').map((l) => l.itemId);
  assert.equal(season.length, 3);
  assert.equal(season[0], 's2');
  assert.deepEqual(out.peakItemIds, ['s2']);
});

test('rule 8: medianKeptQty overrides defaultQty; hidden items ignored', () => {
  const out = proposeOrder(input([item({ id: 'a', medianKeptQty: 1.5 }), item({ id: 'h', isHidden: true })]));
  assert.equal(out.lines.length, 1);
  assert.equal(out.lines[0].qty, 1.5);
});

test('rule 9: sorted leafy → vegetable → root → herb → fruit', () => {
  const out = proposeOrder(input([
    item({ id: 'f', category: 'fruit' }), item({ id: 'h', category: 'herb' }), item({ id: 'r', category: 'root' }),
    item({ id: 'v', category: 'vegetable' }), item({ id: 'l', category: 'leafy' }),
  ]));
  assert.deepEqual(out.lines.map((l) => l.itemId), ['l', 'v', 'r', 'h', 'f']);
});

test('vendor categories filter candidates', () => {
  const out = proposeOrder(input([item({ id: 'f', category: 'fruit' }), item({ id: 'v' })], { vendorCategories: ['vegetable'] }));
  assert.deepEqual(out.lines.map((l) => l.itemId), ['v']);
});

test('rule 7: three removals demote one level; on_demand added 3× in 6 weeks promotes', () => {
  let s = { rotation: 'weekly' as const, skipStreak: 0, addStreak: 0, addHistory: [] as number[] };
  let r = applyLearning(s, 'removed', 0);
  r = applyLearning(r, 'removed', 0);
  r = applyLearning(r, 'removed', 0);
  assert.equal(r.rotation, 'biweekly');
  assert.equal(r.skipStreak, 0);
  assert.ok(r.notice?.startsWith('demoted'));

  let p = applyLearning({ rotation: 'on_demand', skipStreak: 0, addStreak: 0, addHistory: [] }, 'added', 0);
  p = applyLearning(p, 'added', 7 * DAY_MS);
  p = applyLearning(p, 'added', 14 * DAY_MS);
  assert.equal(p.rotation, 'biweekly');

  let old = applyLearning({ rotation: 'on_demand', skipStreak: 0, addStreak: 0, addHistory: [] }, 'added', 0);
  old = applyLearning(old, 'added', 50 * DAY_MS);
  old = applyLearning(old, 'added', 51 * DAY_MS);
  assert.equal(old.rotation, 'on_demand');
});

test('confidence thresholds and median', () => {
  assert.equal(statusFromConfidence(0.7), 'received');
  assert.equal(statusFromConfidence(0.3), 'not_seen');
  assert.equal(statusFromConfidence(0.5), 'unsure');
  assert.equal(median([1, 3, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
});

test('local units and message templates', () => {
  assert.equal(formatQty(250, 'g', 'mr'), 'पाव');
  assert.equal(formatQty(0.5, 'kg', 'mr'), 'अर्धा किलो');
  assert.equal(formatQty(500, 'g', 'hi'), 'आधा किलो');
  assert.equal(formatQty(2, 'bunch', 'mr'), '2 जुडी');
  assert.equal(formatQty(2, 'bunch', 'hi'), '2 गड्डी');
  assert.equal(formatQty(1, 'dozen', 'hi'), '1 दर्जन');
  const t = buildOrderText({ lang: 'mr', vendorName: 'रमेश', dayIndex: 0, time: '10:00', lines: [
    { name: 'पालक', qty: 2, unit: 'bunch' }, { name: 'टोमॅटो', qty: 1, unit: 'kg' },
  ] });
  assert.equal(t, 'नमस्कार रमेश 🙏 रविवार ची यादी:\n1. पालक – 2 जुडी\n2. टोमॅटो – 1 किलो\nसकाळी 10 पर्यंत पाठवा. धन्यवाद!');
  assert.equal(buildShortageText('hi', ['पालक', 'मेथी']), 'भैया, पालक, मेथी नहीं आए। अगली बार भेज दीजिए।');
});
