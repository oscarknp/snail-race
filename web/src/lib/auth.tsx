import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { api, type Me } from "./api.ts";

interface AuthState {
  me: Me | null;
  loading: boolean;
  setMe: (me: Me | null) => void;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setMe(await api<Me | null>("/auth/me"));
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    await api("/auth/logout", { method: "POST", body: {} }).catch(() => {});
    setMe(null);
  }, []);

  useEffect(() => {
    refresh();
    // A 401 anywhere means the session ended (expired, or reset elsewhere).
    const onUnauthorized = () => setMe(null);
    window.addEventListener("snail:unauthorized", onUnauthorized);
    return () => window.removeEventListener("snail:unauthorized", onUnauthorized);
  }, [refresh]);

  return <AuthContext.Provider value={{ me, loading, setMe, refresh, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}

/** For pages behind the login wall, where `me` is guaranteed. */
export function useMe(): Me {
  const { me } = useAuth();
  if (!me) throw new Error("useMe without a user");
  return me;
}
