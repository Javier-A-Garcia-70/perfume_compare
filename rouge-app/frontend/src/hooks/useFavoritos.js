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

  // Acepta una o varias ids (todas las variantes de un perfume agrupado).
  // Así el favorito se trata como grupo: si alguna variante está guardada se
  // considera favorito, y al quitarlo se borran TODAS las variantes.
  const toggle = useCallback(async (perfumeIds, precioActual) => {
    const ids = Array.isArray(perfumeIds) ? perfumeIds : [perfumeIds];
    const next = new Set(favIds);
    const yaEsFav = ids.some(id => next.has(id));

    if (yaEsFav) {
      ids.forEach(id => next.delete(id));
      if (user && supabase)
        await supabase.from("favoritos").delete().eq("user_id", user.id).in("perfume_id", ids);
    } else {
      const repId = ids[0];
      next.add(repId);
      if (user && supabase)
        await supabase.from("favoritos").upsert({
          user_id: user.id,
          perfume_id: repId,
          precio_al_guardar: precioActual ?? null,
        });
    }
    setFavIds(next);
    if (!user) localStorage.setItem(LS_KEY, JSON.stringify([...next]));
  }, [favIds, user]);

  return { favIds, toggle };
}
