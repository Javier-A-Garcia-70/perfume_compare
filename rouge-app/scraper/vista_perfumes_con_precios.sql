-- Vista: perfumes_con_precios
-- Actualizar cada vez que se agrega una tienda nueva.
-- Ejecutar en Supabase → SQL Editor

DROP VIEW IF EXISTS perfumes_con_precios;

CREATE VIEW perfumes_con_precios AS
SELECT
    p.id, p.marca, p.nombre_base, p.tipo, p."tamaño", p.genero,
    p.descripcion, p.imagen, p.clave_unica,

    -- Rouge
    max(CASE WHEN t.tienda = 'rouge' THEN t.precio_final   END) AS rouge_precio,
    max(CASE WHEN t.tienda = 'rouge' THEN t.precio_lista   END) AS rouge_precio_lista,
    max(CASE WHEN t.tienda = 'rouge' THEN t.descuento      END) AS rouge_descuento,
    max(CASE WHEN t.tienda = 'rouge' THEN t.link           END) AS rouge_link,
    max(CASE WHEN t.tienda = 'rouge' THEN t.stock_estado   END) AS rouge_stock,
    bool_or(t.tienda = 'rouge')                                 AS en_rouge,

    -- Juleriaque
    max(CASE WHEN t.tienda = 'juleriaque' THEN t.precio_final   END) AS juleriaque_precio,
    max(CASE WHEN t.tienda = 'juleriaque' THEN t.precio_lista   END) AS juleriaque_precio_lista,
    max(CASE WHEN t.tienda = 'juleriaque' THEN t.descuento      END) AS juleriaque_descuento,
    max(CASE WHEN t.tienda = 'juleriaque' THEN t.link           END) AS juleriaque_link,
    max(CASE WHEN t.tienda = 'juleriaque' THEN t.stock_estado   END) AS juleriaque_stock,
    bool_or(t.tienda = 'juleriaque')                                 AS en_juleriaque,

    -- Farmacity
    max(CASE WHEN t.tienda = 'farmacity' THEN t.precio_final   END) AS farmacity_precio,
    max(CASE WHEN t.tienda = 'farmacity' THEN t.precio_lista   END) AS farmacity_precio_lista,
    max(CASE WHEN t.tienda = 'farmacity' THEN t.descuento      END) AS farmacity_descuento,
    max(CASE WHEN t.tienda = 'farmacity' THEN t.link           END) AS farmacity_link,
    max(CASE WHEN t.tienda = 'farmacity' THEN t.stock_estado   END) AS farmacity_stock,
    bool_or(t.tienda = 'farmacity')                                  AS en_farmacity,

    -- Simplicity
    max(CASE WHEN t.tienda = 'simplicity' THEN t.precio_final   END) AS simplicity_precio,
    max(CASE WHEN t.tienda = 'simplicity' THEN t.precio_lista   END) AS simplicity_precio_lista,
    max(CASE WHEN t.tienda = 'simplicity' THEN t.descuento      END) AS simplicity_descuento,
    max(CASE WHEN t.tienda = 'simplicity' THEN t.link           END) AS simplicity_link,
    max(CASE WHEN t.tienda = 'simplicity' THEN t.stock_estado   END) AS simplicity_stock,
    bool_or(t.tienda = 'simplicity')                                  AS en_simplicity,

    -- Beauty24
    max(CASE WHEN t.tienda = 'beauty24' THEN t.precio_final   END) AS beauty24_precio,
    max(CASE WHEN t.tienda = 'beauty24' THEN t.precio_lista   END) AS beauty24_precio_lista,
    max(CASE WHEN t.tienda = 'beauty24' THEN t.descuento      END) AS beauty24_descuento,
    max(CASE WHEN t.tienda = 'beauty24' THEN t.link           END) AS beauty24_link,
    max(CASE WHEN t.tienda = 'beauty24' THEN t.stock_estado   END) AS beauty24_stock,
    bool_or(t.tienda = 'beauty24')                                   AS en_beauty24,

    -- Farmacia del Pueblo
    max(CASE WHEN t.tienda = 'farmaciadelpueblo' THEN t.precio_final   END) AS farmaciadelpueblo_precio,
    max(CASE WHEN t.tienda = 'farmaciadelpueblo' THEN t.precio_lista   END) AS farmaciadelpueblo_precio_lista,
    max(CASE WHEN t.tienda = 'farmaciadelpueblo' THEN t.descuento      END) AS farmaciadelpueblo_descuento,
    max(CASE WHEN t.tienda = 'farmaciadelpueblo' THEN t.link           END) AS farmaciadelpueblo_link,
    max(CASE WHEN t.tienda = 'farmaciadelpueblo' THEN t.stock_estado   END) AS farmaciadelpueblo_stock,
    bool_or(t.tienda = 'farmaciadelpueblo')                                  AS en_farmaciadelpueblo,

    -- Globales
    bool_or(t.descuento > 0) AS tiene_oferta,
    min(t.precio_final)      AS precio_min

FROM perfumes p
LEFT JOIN perfume_tiendas t ON t.perfume_id = p.id
GROUP BY p.id, p.marca, p.nombre_base, p.tipo, p."tamaño", p.genero,
         p.descripcion, p.imagen, p.clave_unica;
