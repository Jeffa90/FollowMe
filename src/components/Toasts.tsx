"use client";
import { createContext, useCallback, useContext, useState } from "react";

const Ctx = createContext<(msg: string) => void>(() => {});
export const useToast = () => useContext(Ctx);
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<{ id: number; msg: string }[]>([]);
  const push = useCallback((msg: string) => {
    const id = Date.now() + Math.random();
    setItems((i) => [...i, { id, msg }]);
    setTimeout(() => setItems((i) => i.filter((x) => x.id !== id)), 5000);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="toast-region" role="status" aria-live="polite" aria-atomic="false">
        {items.map((t) => <div key={t.id} className="toast">{t.msg}</div>)}
      </div>
    </Ctx.Provider>
  );
}
