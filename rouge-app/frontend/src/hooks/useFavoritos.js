import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";

const LS_KEY = "favoritos_local";

export function useFavoritos(user) {
  const [favIds, setFavIds] = useState(new Set());

  // Carga inicial
  useEffect(() => {
    if (user && supabase) {
      supabase
        .from("favoritos")
        .select("perfume_id")
        .eq("user_id", user.id)
        .then(({ data }) => {
          if (data) setFavIds(new Set(data.map(r => r.perfume_id)));
        });
    } else {
      try {
        const local = JSON.parse(localStorage.getItem(LS_KEY) || "[]");
        setFavIds(new Set(local));
      } catch { setFavIds(new Set()); }
    }
  }, [user]);

  const toggle = useCallback(async (perfumeId, precioActual) => {
    const next = new Set(favIds);
    if (next.has(perfumeId)) {
      next.delete(perfumeId);
      if (user && supabase)
        await supabase.from("favoritos").delete().match({ user_id: user.id, perfume_id: perfumeId });
    } else {
      next.add(perfumeId);
      if (user && supabase)
        await supabase.from("favoritos").upsert({
          user_id: user.id,
          perfume_id: perfumeId,
          precio_al_guardar: precioActual ?? null,
        });
    }
    setFavIds(next);
    if (!user) localStorage.setItem(LS_KEY, JSON.stringify([...next]));
  }, [favIds, user]);

  return { favIds, toggle };
}
