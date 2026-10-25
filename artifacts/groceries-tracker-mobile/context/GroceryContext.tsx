import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { customFetch, setAuthTokenGetter, setBaseUrl, cloudEnabled, cloudSessionToken, cloudSignOut, cloudAutoRefresh, onCloudChange, refreshCloud } from '@workspace/api-client-react';

export type GroceryItem = {
  name: string;
  variant?: string;
  packCount?: number;
  measureAmount?: number;
  measureUnit?: string;
  quantity: number;
  price: number;
  category: string;
};

export type GroceryReceipt = {
  id: string;
  merchant: string;
  date: string;
  total: number;
  items: GroceryItem[];
  imageUri?: string;
  imageBase64?: string;
  imageMimeType?: 'image/jpeg' | 'image/png' | 'image/webp';
  purchaseTime?: string | null;
  timezone?: string | null;
};
export type GrocerySpace = { id: string; name: string; kind: 'private' | 'household'; timezone: string; role?: string };

type GroceryContextValue = {
  receipts: GroceryReceipt[];
  pendingDrafts: GroceryReceipt[];
  totalSpent: number;
  itemCount: number;
  addReceipt: (receipt: Omit<GroceryReceipt, 'id'>) => Promise<void>;
  removeReceipt: (id: string) => void;
  host: string;
  token: string;
  spaces: GrocerySpace[];
  activeSpace: GrocerySpace | null;
  selectSpace: (id: string) => Promise<void>;
  configureHost: (host: string) => Promise<void>;
  authenticate: (email: string, password: string, create?: boolean, householdName?: string) => Promise<void>;
  signOut: () => Promise<void>;
  acceptInvitation: (code: string) => Promise<void>;
  updateTimezone: (timezone: string) => Promise<void>;
  updateReceiptDate: (id: string, date: string, time: string | null) => Promise<void>;
  saveDraft: (draft: Omit<GroceryReceipt, 'id'>) => string;
  updateDraft: (draft: GroceryReceipt) => void;
  removeDraft: (id: string) => void;
};

const STORAGE_KEY = '@groceries-tracker/receipts';
const HOST_KEY = '@groceries-tracker/host';
const TOKEN_KEY = '@groceries-tracker/token';
const SPACE_KEY = '@groceries-tracker/space';
const DRAFTS_KEY = '@groceries-tracker/pending-receipts';
const GroceryContext = createContext<GroceryContextValue | null>(null);

export function GroceryProvider({ children }: { children: React.ReactNode }) {
  const [receipts, setReceipts] = useState<GroceryReceipt[]>([]);
  const [pendingDrafts, setPendingDrafts] = useState<GroceryReceipt[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [host, setHost] = useState(cloudEnabled() ? 'cloud' : '');
  const [syncRevision,setSyncRevision]=useState(0);
  useEffect(()=>{if(!cloudEnabled())return;const unsubscribe=onCloudChange(()=>setSyncRevision(v=>v+1));const sub=AppState.addEventListener('change',state=>{cloudAutoRefresh(state==='active');if(state==='active')refreshCloud();});return()=>{unsubscribe();sub.remove();};},[]);
  const [token, setToken] = useState('');
  const [spaces, setSpaces] = useState<GrocerySpace[]>([]);
  const [activeSpaceId, setActiveSpaceId] = useState('');

  useEffect(() => {
    Promise.all([AsyncStorage.getItem(STORAGE_KEY), AsyncStorage.getItem(HOST_KEY), AsyncStorage.getItem(TOKEN_KEY), AsyncStorage.getItem(SPACE_KEY), AsyncStorage.getItem(DRAFTS_KEY)])
      .then(async ([value, savedHost, savedToken, savedSpace, savedDrafts]) => {
        if (value && !cloudEnabled()) try {
          const saved = JSON.parse(value) as GroceryReceipt[];
          if (Array.isArray(saved)) setReceipts(saved);
        } catch {
          setReceipts([]);
        }
        if(cloudEnabled()){ savedHost='cloud'; savedToken=await cloudSessionToken(); }
        if (savedHost) { setHost(savedHost); setBaseUrl(savedHost); }
        if (savedToken) { setToken(savedToken); setAuthTokenGetter(() => savedToken); }
        if (savedSpace) setActiveSpaceId(savedSpace);
        if (savedDrafts) { try { const parsed = JSON.parse(savedDrafts) as GroceryReceipt[]; if (Array.isArray(parsed)) setPendingDrafts(parsed); } catch { setPendingDrafts([]); } }
        if (savedHost && savedToken) {
          try {
            const remoteSpaces = await customFetch<GrocerySpace[]>('/api/spaces');
            setSpaces(remoteSpaces);
            const spaceId = savedSpace && remoteSpaces.some((space) => space.id === savedSpace) ? savedSpace : remoteSpaces.find((space) => space.kind === 'household')?.id ?? remoteSpaces[0]?.id ?? '';
            setActiveSpaceId(spaceId); await AsyncStorage.setItem(SPACE_KEY, spaceId);
            if (spaceId) {
              const rows = await customFetch<any[]>(`/api/receipts?spaceId=${encodeURIComponent(spaceId)}`);
              setReceipts(rows.map((row) => ({ id: row.id, merchant: row.merchant, total: row.total, date: row.purchaseDate, purchaseTime: row.purchaseTime, timezone: row.timezone, items: row.items.map((item: any) => ({ name: item.name, variant: item.variant, packCount: item.packCount ?? undefined, measureAmount: item.measureAmount ?? undefined, measureUnit: item.measureUnit ?? undefined, quantity: item.quantity ?? 1, price: item.linePrice, category: item.category })), imageUri: row.photoUrl ? (cloudEnabled() ? row.photoUrl : `${savedHost}${row.photoUrl}`) : undefined })));
            }
          } catch { /* retain client-side drafts while the local host is offline */ }
        }
      })
      .finally(() => setHydrated(true));
  }, []);

  useEffect(() => {
    if (!hydrated || !host || !token || !activeSpaceId) return;
    let current = true;
    customFetch<any[]>(`/api/receipts?spaceId=${encodeURIComponent(activeSpaceId)}`).then((rows) => {
      if (!current) return;
      setReceipts(rows.map((row) => ({ id: row.id, merchant: row.merchant, total: row.total, date: row.purchaseDate, purchaseTime: row.purchaseTime, timezone: row.timezone, items: row.items.map((item: any) => ({ name: item.name, variant: item.variant, packCount: item.packCount ?? undefined, measureAmount: item.measureAmount ?? undefined, measureUnit: item.measureUnit ?? undefined, quantity: item.quantity ?? 1, price: item.linePrice, category: item.category })), imageUri: row.photoUrl ? (cloudEnabled() ? row.photoUrl : `${host}${row.photoUrl}`) : undefined })));
    }).catch(() => undefined);
    return () => { current = false; };
  }, [hydrated, host, token, activeSpaceId, syncRevision]);

  useEffect(()=>{
    if(!cloudEnabled()||!hydrated||!token)return;let active=true;
    customFetch<GrocerySpace[]>('/api/spaces').then(rows=>{if(active)setSpaces(rows);}).catch(()=>undefined);
    return()=>{active=false;};
  },[hydrated,token,syncRevision]);

  useEffect(() => { if (hydrated) AsyncStorage.setItem(DRAFTS_KEY, JSON.stringify(pendingDrafts)).catch(() => undefined); }, [hydrated, pendingDrafts]);

  useEffect(() => {
    if (hydrated) {
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(receipts)).catch(() => undefined);
    }
  }, [hydrated, receipts]);

  const activeSpace = spaces.find((space) => space.id === activeSpaceId) ?? null;
  const value = useMemo<GroceryContextValue>(() => ({
    receipts,
    pendingDrafts,
    totalSpent: receipts.reduce((sum, receipt) => sum + receipt.total, 0),
    itemCount: receipts.reduce((sum, receipt) => sum + receipt.items.length, 0),
    addReceipt: async (receipt) => {
      if (token && activeSpaceId) {
        const saved = await customFetch<any>('/api/receipts', { method: 'POST', body: JSON.stringify({ spaceId: activeSpaceId, merchant: receipt.merchant, total: receipt.total, purchaseDate: receipt.date, purchaseTime: receipt.purchaseTime ?? null, timezone: receipt.timezone ?? activeSpace?.timezone, imageBase64: receipt.imageBase64, mimeType: receipt.imageMimeType ?? 'image/jpeg', items: receipt.items.map((item) => ({ name: item.name, variant: item.variant, category: item.category, linePrice: item.price, quantity: item.quantity, packCount: item.packCount, measureAmount: item.measureAmount, measureUnit: item.measureUnit })) }) });
        setReceipts((current) => [{ ...receipt, id: saved.id, imageBase64: undefined, items: saved.items.map((item: any) => ({ name: item.name, variant: item.variant, packCount: item.packCount ?? undefined, measureAmount: item.measureAmount ?? undefined, measureUnit: item.measureUnit ?? undefined, category: item.category, quantity: item.quantity ?? 1, price: item.linePrice })) }, ...current]);
      } else {
        throw new Error('Connect and sign in to the household server before saving shared receipts. Your review draft is still on this device.');
      }
    },
    removeReceipt: (id) => setReceipts((current) => current.filter((receipt) => receipt.id !== id)),
    saveDraft: (draft) => { const id = `draft-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; setPendingDrafts((current) => [{ ...draft, id }, ...current.filter((entry) => entry.id !== id)]); return id; },
    updateDraft: (draft) => setPendingDrafts((current) => current.map((entry) => entry.id === draft.id ? draft : entry)),
    removeDraft: (id) => setPendingDrafts((current) => current.filter((draft) => draft.id !== id)),
    host, token, spaces, activeSpace,
    selectSpace: async (id) => { setActiveSpaceId(id); await AsyncStorage.setItem(SPACE_KEY, id); },
    configureHost: async (nextHost) => { const cleanHost = cloudEnabled() ? 'cloud' : nextHost.trim().replace(/\/$/, ''); setHost(cleanHost); setBaseUrl(cleanHost || null); await AsyncStorage.setItem(HOST_KEY, cleanHost); },
    authenticate: async (email, password, create = false, householdName = 'My household') => { const result = await customFetch<{ token: string; spaces: GrocerySpace[] }>(`/api/auth/${create ? 'register' : 'login'}`, { method: 'POST', body: JSON.stringify({ email, password, name: householdName }) }); setToken(result.token); setSpaces(result.spaces); setAuthTokenGetter(() => result.token); await AsyncStorage.setItem(TOKEN_KEY, result.token); const selected = result.spaces.find((space) => space.kind === 'household') ?? result.spaces[0]; if (selected) { setActiveSpaceId(selected.id); await AsyncStorage.setItem(SPACE_KEY, selected.id); } },
    signOut: async () => { if(cloudEnabled())await cloudSignOut(); setReceipts([]); setActiveSpaceId(''); await AsyncStorage.removeItem(STORAGE_KEY); setToken(''); setSpaces([]); setAuthTokenGetter(null); await AsyncStorage.removeItem(TOKEN_KEY); },
    acceptInvitation: async (code) => { const next = await customFetch<GrocerySpace[]>(`/api/invitations/${encodeURIComponent(code.includes('?') ? new URL(code.trim()).searchParams.get('invite') ?? code.trim() : code.trim())}/accept`, { method: 'POST' }); setSpaces(next); const household = next.find((space) => space.kind === 'household'); if (household) { setActiveSpaceId(household.id); await AsyncStorage.setItem(SPACE_KEY, household.id); } },
    updateTimezone: async (timezone) => { if (!activeSpaceId) throw new Error('Connect to a household first.'); const updated = await customFetch<GrocerySpace>(`/api/spaces/${activeSpaceId}`, { method: 'PATCH', body: JSON.stringify({ timezone }) }); setSpaces((current) => current.map((space) => space.id === updated.id ? { ...space, ...updated } : space)); },
    updateReceiptDate: async (id, date, time) => { const updated = await customFetch<any>(`/api/receipts/${id}`, { method: 'PATCH', body: JSON.stringify({ purchaseDate: date, purchaseTime: time, timezone: activeSpace?.timezone }) }); setReceipts((current) => current.map((receipt) => receipt.id === id ? { ...receipt, date: updated.purchaseDate, purchaseTime: updated.purchaseTime, timezone: updated.timezone } : receipt)); },
  }), [receipts, pendingDrafts, host, token, spaces, activeSpaceId]);

  return <GroceryContext.Provider value={value}>{children}</GroceryContext.Provider>;
}

export function useGroceries() {
  const context = useContext(GroceryContext);
  if (!context) throw new Error('useGroceries must be used inside GroceryProvider');
  return context;
}
