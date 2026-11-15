# VEO Territorios

CRM de adquisición de sitios DOOH (publicidad exterior digital) en Monterrey y su área metropolitana.

- **Producción:** https://veocrm.vercel.app
- **Frontend:** `public/` (HTML, CSS y JavaScript sin compilación)
- **API:** `api/main.js` (función de Vercel, Node ≥ 20)
- **Base de datos y archivos:** Supabase (`supabase/migrations/`)

## Cómo se publica

Cada `git push` a `main` se publica automáticamente en producción en Vercel.
Cualquier otra rama genera un *preview* privado para probar antes.

## Variables de entorno (en Vercel, nunca en el repo)

Ver `.env.example`:

| Variable | Para qué |
|---|---|
| `SUPABASE_URL` | URL del proyecto Supabase |
| `SUPABASE_SECRET_KEY` | Clave secreta `sb_secret_…` (solo servidor) |
| `VEO_SESSION_SECRET` | Firma de las sesiones (≥ 32 caracteres) |
| `VEO_GOOGLE_MAPS_KEY` | Clave de Google Maps JavaScript API (restringida por dominio) |

## Base de datos

Las migraciones en `supabase/migrations/` se ejecutan en orden en el SQL Editor de Supabase.
Los usuarios se crean desde la app (**Gestión de credenciales**), no por SQL.
