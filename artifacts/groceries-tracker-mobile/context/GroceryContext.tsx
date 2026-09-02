import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

export type GroceryItem = {
  name: string;
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
};

type GroceryContextValue = {
  receipts: GroceryReceipt[];
  totalSpent: number;
  itemCount: number;
  addReceipt: (receipt: Omit<GroceryReceipt, 'id'>) => void;
  removeReceipt: (id: string) => void;
};

const STORAGE_KEY = '@groceries-tracker/receipts';
const GroceryContext = createContext<GroceryContextValue | null>(null);

export function GroceryProvider({ children }: { children: React.ReactNode }) {
  const [receipts, setReceipts] = useState<GroceryReceipt[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((value) => {
        if (!value) return;
        try {
          const saved = JSON.parse(value) as GroceryReceipt[];
          if (Array.isArray(saved)) setReceipts(saved);
        } catch {
          setReceipts([]);
        }
      })
      .finally(() => setHydrated(true));
  }, []);

  useEffect(() => {
    if (hydrated) {
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(receipts)).catch(() => undefined);
    }
  }, [hydrated, receipts]);

  const value = useMemo<GroceryContextValue>(() => ({
    receipts,
    totalSpent: receipts.reduce((sum, receipt) => sum + receipt.total, 0),
    itemCount: receipts.reduce((sum, receipt) => sum + receipt.items.length, 0),
    addReceipt: (receipt) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      setReceipts((current) => [{ ...receipt, id }, ...current]);
    },
    removeReceipt: (id) => setReceipts((current) => current.filter((receipt) => receipt.id !== id)),
  }), [receipts]);

  return <GroceryContext.Provider value={value}>{children}</GroceryContext.Provider>;
}

export function useGroceries() {
  const context = useContext(GroceryContext);
  if (!context) throw new Error('useGroceries must be used inside GroceryProvider');
  return context;
}