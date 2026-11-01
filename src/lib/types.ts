import type { Timestamp } from 'firebase/firestore';

export type Lang = 'en' | 'hi' | 'mr';
export type Category = 'leafy' | 'vegetable' | 'root' | 'fruit' | 'herb' | 'dairy';
export type Unit = 'kg' | 'g' | 'pc' | 'bunch' | 'dozen';
export type Rotation = 'weekly' | 'biweekly' | 'monthly' | 'on_demand';

export const CATEGORY_ORDER: Category[] = ['leafy', 'vegetable', 'root', 'herb', 'fruit', 'dairy'];
export const UNITS: Unit[] = ['kg', 'g', 'pc', 'bunch', 'dozen'];
export const ROTATIONS: Rotation[] = ['weekly', 'biweekly', 'monthly', 'on_demand'];

export interface Household {
  id: string;
  name: string;
  city: string;
  languagePref: Lang;
  inviteCode: string;
  createdAt: Timestamp;
  notifyDraftHour?: number;
  notifyDeliveryDue?: boolean;
}

export interface Member {
  id: string;
  name: string;
  phone: string;
  role: 'owner' | 'member';
  fcmTokens: string[];
}

export interface Vendor {
  id: string;
  name: string;
  whatsappNumber: string;
  language: Lang;
  categories: Category[];
  deliveryDays: number[];
  usualDeliveryTime: string;
  reminderAfterMin: number;
  secondReminderAfterMin: number;
  notes: string;
  isActive: boolean;
}

export interface Item {
  id: string;
  nameEn: string;
  nameHi: string;
  nameMr: string;
  category: Category;
  defaultUnit: Unit;
  defaultQty: number;
  shelfLifeDays: number;
  effectiveShelfLifeDays?: number;
  seasonMonths: number[];
  peakMonths?: number[];
  rotation: Rotation;
  isPinned: boolean;
  isHidden: boolean;
  vendorId: string | null;
  lastReceivedAt: Timestamp | null;
  lastFinishedAt: Timestamp | null;
  halfLeftAt?: Timestamp | null;
  stockState?: StockState;
  skipStreak: number;
  addStreak: number;
  medianKeptQty: number | null;
}

/** Pantry belief maintained by onStockEvent. */
export type StockState = 'full' | 'half' | 'finished' | 'spoiled' | 'unknown';

export type StockEventKind = 'received' | 'finished' | 'half_left' | 'spoiled' | 'manual_set';

export interface StockEvent {
  id: string;
  itemId: string;
  kind: StockEventKind;
  qty: number;
  unit: Unit;
  source: 'order' | 'tap' | 'photo';
  at: Timestamp;
  byUid: string;
}

export type OrderStatus =
  | 'draft'
  | 'approved'
  | 'sent'
  | 'reminded'
  | 'received'
  | 'partially_received'
  | 'cancelled';

export interface SkippedEntry {
  itemId: string;
  reason: 'still_at_home' | 'out_of_season';
  receivedDaysAgo?: number;
}

export interface Order {
  id: string;
  vendorId: string;
  forDate: string;
  status: OrderStatus;
  generatedAt: Timestamp | null;
  approvedAt: Timestamp | null;
  sentAt: Timestamp | null;
  receivedAt: Timestamp | null;
  messageText: string | null;
  language: Lang;
  reminderCount: number;
  latenessMin: number | null;
  notes: string;
  skipped?: SkippedEntry[];
  festivalBanner?: string | null;
  peakItemIds?: string[];
  notices?: { itemId: string; code: string }[];
  totalSpend?: number | null;
}

export type OrderReason = 'rotation' | 'finished' | 'season' | 'shortage_carry' | 'member_added' | 'manual';
export type ReceivedStatus = 'received' | 'not_seen' | 'unsure' | 'short';

export interface OrderItem {
  id: string;
  qty: number;
  unit: Unit;
  reason: OrderReason;
  addedByUid: string | null;
  status: 'proposed' | 'kept' | 'removed' | 'added';
  receivedStatus: ReceivedStatus | null;
  receivedQty: number | null;
  photoConfidence: number | null;
  price: number | null;
}

export interface Recognition {
  itemId: string;
  seen: boolean | 'unsure';
  confidence: number;
  countEstimate: number | null;
}

export interface OrderPhoto {
  id: string;
  storagePath: string;
  takenAt: Timestamp;
  recognition?: Recognition[];
  extras?: { label: string; confidence: number }[];
  expiresAt: Timestamp;
}

export interface QueueEntry {
  id: string;
  qty: number;
  unit: Unit;
  addedByUid: string;
  addedAt: Timestamp;
}
