// Registro no bloqueante: mejora la instalación en móvil sin interferir con el CRM.
if ('serviceWorker' in navigator && location.protocol==='https:') {
  window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(err=>console.warn('PWA opcional:',err.message)));
}
