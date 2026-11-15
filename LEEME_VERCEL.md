# VEO TERRITORIOS · Publicación en Vercel

## Cómo publicar

Este ZIP contiene una carpeta de proyecto lista para Vercel. Sube el **ZIP completo** en https://vercel.com/drop desde Safari o conecta la carpeta a tu proyecto de Vercel. Si publicas desde Terminal en Mac, ejecuta `npx vercel --prod` desde la carpeta que contiene `vercel.json`.

- Framework: **Other** (sitio estático).
- Carpeta de salida: **public**.
- No requiere comando de compilación.

Si ya habías publicado VEO, usa un nuevo despliegue de **ese mismo proyecto de Vercel**. La URL (origen) debe permanecer igual para conservar los registros guardados en el navegador; si cambias de dominio o borras datos de Safari/Chrome, el almacenamiento local no se transfiere.

## Cambios de esta versión

- «Ver mis ubicaciones» abre el Mapa de Oportunidades a ancho completo, encuadrado en Monterrey y un sector amplio del área metropolitana de referencia.
- Botón «Vista Monterrey · AMM» para recuperar ese encuadre y mostrar todos los pines.
- Las cuatro fases tienen tarjetas de colores diferentes: turquesa, violeta, ámbar y rosa.
- El logo VEO en la cabecera y la barra lateral regresa al Centro de Control.
- Se retiran las leyendas de demostración y de vista previa de la interfaz.
- Diseño adaptable a móvil y tablet y fichas de aforo incluidas.

## Seguridad y límites — IMPORTANTE

**Este es un proyecto estático de prueba, no un CRM seguro multiusuario.** El login ADMIN simula el acceso en el navegador y no protege realmente los datos. Los predios, contraseñas de prueba, archivos y comentarios se guardan en el almacenamiento del navegador del dispositivo; no se comparten con otros usuarios. No captures información confidencial ni credenciales reales. Para varios brokers con sesiones y datos compartidos se necesita un backend y una base de datos persistente, junto con almacenamiento seguro de archivos.

El mapa interactivo utiliza cartografía en línea de Esri; las fichas de aforo se incluyen dentro de la carpeta `public/assets/media/`. La verificación geográfica depende de servicios externos y puede quedar pendiente de confirmación.

## Estructura del paquete

`vercel.json` → configuración del despliegue estático.

`public/index.html` → punto de entrada.

`public/assets/` → CSS, JavaScript, logotipo, mapas y fichas de aforo.

`public/sw.js` → caché PWA. Si al actualizar no ves los cambios, recarga la página o cierra y vuelve a abrir la pestaña (puede existir caché de versiones anteriores).
