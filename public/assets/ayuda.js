/* VEO Territorios · Ayuda (versión sencilla). Una sola página: tareas paso a paso, las 5 fases y preguntas.
 * window.VEOAyuda.html(user) devuelve la vista. Las reglas reflejan api/main.js. */
(function(){
 'use strict';
 const MANAGER=['admin','dg','supervisor'],ADMIN=['admin','dg'],REPORT=['admin','dg','supervisor','legal'];
 const ROLE_TXT={
  broker:['Broker','Registras tus predios, subes sus documentos y pides que avancen de fase. Sólo ves tus propios predios.'],
  supervisor:['Supervisor','Ves todos los predios, asignas brokers y apruebas o rechazas los avances de fase.'],
  legal:['Legal','Revisas los documentos y el permiso municipal, y puedes generar el reporte ejecutivo.'],
  tecnico:['Técnico','Subes los documentos técnicos: memoria de cálculo, factibilidad eléctrica y estudios.'],
  admin:['Administrador','Puedes hacer todo: aprobar fases, gestionar usuarios y contraseñas, y desbloquear predios en operación.'],
  dg:['DG · Dirección General','Tienes los mismos permisos que el Administrador: puedes hacer todo.']};
 // Tareas: [icono, título, pasos[], botón {action|view, label}, roles permitidos (null = todos)]
 const TASKS=[
  ['📍','Registrar un predio nuevo',['Toca el botón rosa <b>＋ Registrar predio</b>.','Escribe un nombre para el predio y elige su corredor.','Toca <b>Marcar ubicación en el mapa</b> y señala el punto exacto.','Guarda. El predio queda en la fase 1 con su número de expediente.'],{action:'new-predio',label:'＋ Registrar predio'},null],
  ['📎','Subir una foto o documento',['Abre el predio en <b>Expedientes / Predios</b>.','Entra a la pestaña <b>Documentos</b>.','Elige qué tipo de documento es (ej. Fotografía del predio).','Toca <b>Seleccionar archivo</b>, escoge el archivo y luego <b>Subir al expediente</b>.'],{view:'predios',label:'Ir a mis predios'},null],
  ['⭐','Calificar un predio',['Abre el predio y entra a <b>Calificación</b>.','Da de 1 a 5 a cada punto: tráfico, visibilidad, electricidad, propietario y condiciones.','Guarda. Necesitas <b>70 puntos o más</b> para pasar a la fase 2.'],{view:'predios',label:'Ir a mis predios'},null],
  ['➡️','Pasar el predio a la siguiente fase',['Sube todo lo que pide la fase (lo ves abajo en «Las 5 fases»).','Abre el predio y entra a <b>Hitos / Cierre</b>.','Toca <b>Solicitar avance de fase</b>.','Si falta algo, el sistema te dice qué es. Si no, tu supervisor recibe la solicitud.'],{view:'predios',label:'Ir a mis predios'},null],
  ['✅','Aprobar o rechazar una solicitud',['Entra a <b>Aprobaciones</b>.','Toca <b>Ver expediente</b>: se abre en Documentos para revisar lo que se subió.','Toca <b>Aprobar</b> (el predio avanza) o <b>Rechazar</b> y escribe el motivo.'],{view:'aprobaciones',label:'Ir a Aprobaciones'},MANAGER],
  ['🔒','Editar un predio que ya está en operación',['Los predios en operación están bloqueados para que nadie los cambie por error.','Abre el predio y toca <b>Desbloquear</b>.','Un Administrador o DG escribe su usuario y contraseña.','Tienes 15 minutos para editar.'],null,null],
  ['📊','Preparar el reporte para la junta',['Entra a <b>Reporte ejecutivo</b>.','Elige las fases y el corredor que quieres mostrar.','Toca <b>Presentar</b> para verlo en pantalla o <b>Descargar PDF</b>.'],{view:'reportes',label:'Ir al reporte'},REPORT],
  ['👤','Dar de alta a un usuario',['Entra a <b>Gestión de credenciales</b> y toca <b>＋ Crear usuario</b>.','Escribe su nombre de usuario (puede llevar espacios), su rol y una contraseña temporal (puede ser de 4 números).','Al entrar por primera vez, el sistema le pedirá crear su propia contraseña.'],{view:'credenciales',label:'Ir a credenciales'},ADMIN]];
 const PH=[
  {n:1,name:'Búsqueda / Factibilidad',c:'#12a9bd',what:'Encontrar el predio y ver si sirve.',need:['Ubicación marcada en el mapa','Foto del predio','Mapa satelital','Broker asignado','Calificación de 70 o más']},
  {n:2,name:'Primer contacto',c:'#7c5ce6',what:'Hablar con el dueño.',need:['Nombre del dueño','Teléfono o correo','Fecha del contacto','Que no haya dicho que no','Recibo del predial']},
  {n:3,name:'Seguimiento',c:'#ec8a1f',what:'Negociar y formalizar el interés.',need:['Carta de intención','Dueño interesado','Explicarle lo del permiso municipal']},
  {n:4,name:'Cierre',c:'#e33a6f',what:'Firmar y tramitar.',need:['Contrato','Memoria de cálculo','Factibilidad eléctrica','Programa de obra','Permiso municipal autorizado','Cláusula suspensiva aceptada']},
  {n:5,name:'En operación',c:'#1fa971',what:'¡El espectacular ya funciona!',need:['Fotos o videos del sitio funcionando']}];
 const FAQ=[
  ['No me deja pedir el avance de fase','Falta algún requisito. Al tocar <b>Solicitar avance</b> aparece la lista de lo que falta; complétalo y vuelve a intentarlo.'],
  ['¿Puedo subir fotos de WhatsApp?','Sí. Guárdala en tu celular o computadora y súbela en <b>Documentos</b>. El sistema le cambia el nombre solo (ej. <i>foto_predio_1.jpg</i>).'],
  ['Me sacó de la aplicación','Por seguridad, la sesión se cierra tras <b>15 minutos</b> sin usarla. Vuelve a entrar con tu usuario y contraseña.'],
  ['Me dieron una contraseña temporal','Entra con ella y el sistema te pedirá crear una nueva (mínimo 7 caracteres).'],
  ['No veo los predios de otros brokers','Es normal: cada broker sólo ve sus predios. Supervisores y administradores ven todos.'],
  ['Rechazaron mi solicitud','Revisa la nota del supervisor en la <b>Bitácora</b> del predio, corrige lo que indica y vuelve a solicitar.'],
  ['¿Qué archivos puedo subir?','Fotos, videos y PDF de hasta 45 MB.'],
  ['¿Puedo usar VEO como app en el celular?','Sí: en el navegador elige «Agregar a pantalla de inicio» o toca <b>Instalar VEO</b> cuando aparezca el aviso.']];
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function btn(b){if(!b)return'';return b.action?`<button type="button" class="btn btn-primary small" data-action="${b.action}">${b.label}</button>`:`<button type="button" class="btn btn-primary small" data-action="nav" data-view="${b.view}">${b.label} →</button>`}
 function html(user){
  const role=user?.role,rt=ROLE_TXT[role],tasks=TASKS.filter(t=>!t[4]||t[4].includes(role));
  return `<div class="ay-root ay2">
  <div class="page-row"><div><div class="page-kicker">CENTRO DE AYUDA</div><h1 class="page-title">Ayuda</h1><div class="subhead">Todo lo que necesitas para usar VEO, explicado paso a paso.</div></div><div class="spaced"><a class="btn btn-ghost" href="/assets/docs/VEO_Guia_del_proceso.pdf" target="_blank" rel="noopener" download>⇩ DESCARGAR GUÍA EN PDF</a></div></div>
  <div class="ay2-intro"><div class="ay2-intro-ico">💡</div><div><b>¿Cómo funciona VEO?</b><p>Cada predio pasa por <b>5 fases</b>, desde que se encuentra hasta que el espectacular funciona. Para pasar de una fase a otra subes lo que se pide y un supervisor lo aprueba.</p>${rt?`<p class="ay2-role">Tu rol: <b>${esc(rt[0])}</b>. ${esc(rt[1])}</p>`:''}</div></div>
  <h2 class="ay2-h">¿Qué quieres hacer?</h2>
  <div class="ay2-tasks">${tasks.map(([ico,t,steps,b])=>`<details class="ay2-task"><summary><span class="ay2-ico">${ico}</span><span class="ay2-tt">${t}</span><span class="ay2-chev" aria-hidden="true">›</span></summary><ol class="ay2-steps">${steps.map(s=>`<li>${s}</li>`).join('')}</ol>${b?`<div class="ay2-go">${btn(b)}</div>`:''}</details>`).join('')}</div>
  <h2 class="ay2-h">Las 5 fases</h2>
  <p class="ay2-sub">Toca una fase para ver qué necesitas para pasar a la siguiente.</p>
  <div class="ay2-phases">${PH.map((p,i)=>`<details class="ay2-ph" style="--c:${p.c}"><summary><span class="ay2-num">${p.n}</span><span class="ay2-pt"><b>${p.name}</b><small>${p.what}</small></span><span class="ay2-chev" aria-hidden="true">›</span></summary><div class="ay2-need"><small>${i<4?'Para pasar a <b>'+PH[i+1].name+'</b> necesitas:':'Lo que se sube en esta fase:'}</small><ul>${p.need.map(x=>`<li>${x}</li>`).join('')}</ul></div></details>`).join('')}</div>
  <h2 class="ay2-h">Preguntas frecuentes</h2>
  <div class="ay2-faq">${FAQ.map(([q,a])=>`<details class="ay2-q"><summary>${q}<span class="ay2-chev" aria-hidden="true">›</span></summary><p>${a}</p></details>`).join('')}</div>
  <p class="ay2-foot">¿Prefieres leerlo en papel? Descarga la <a href="/assets/docs/VEO_Guia_del_proceso.pdf" target="_blank" rel="noopener" download>guía en PDF</a>.</p>
  </div>`}
 window.VEOAyuda={html(user){this.user=user;return html(user)},user:null};
})();
