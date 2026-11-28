/* VEO Territorios · Ayuda interactiva (versión web de la «Guía del proceso»).
 * window.VEOAyuda.html(user) devuelve la vista; la interacción se maneja con delegación de eventos.
 * Las reglas reflejan api/main.js (requisitos por fase, pesos del score, roles). */
(function(){
 'use strict';
 const PH=[
  {n:1,k:'BUSQUEDA_FACTIBILIDAD',name:'Búsqueda / Factibilidad',short:'Factibilidad',c:'#12a9bd',what:'Encontrar el predio, ubicarlo en el mapa, tomar fotos y calificarlo.'},
  {n:2,k:'PRIMER_CONTACTO',name:'Primer contacto',short:'Primer contacto',c:'#7c5ce6',what:'Identificar y hablar con el propietario o administrador.'},
  {n:3,k:'SEGUIMIENTO',name:'Seguimiento',short:'Seguimiento',c:'#ec8a1f',what:'Negociar y formalizar el interés con una carta de intención.'},
  {n:4,k:'CIERRE',name:'Cierre',short:'Cierre',c:'#e33a6f',what:'Contrato, estudios técnicos y permiso municipal.'},
  {n:5,k:'EN_OPERACION',name:'En operación',short:'Operación',c:'#1fa971',what:'El espectacular funcionando. El expediente queda en sólo lectura.'}];
 const GATES=[
  {req:['Broker asignado','Ubicación registrada (pin GPS)','Fotografía del predio','Evidencia de mapa satelital','Calificación de 70/100 o más'],opt:['Video con dron'],where:'Ficha del predio, Calificación y Documentos'},
  {req:['Nombre del dueño o administrador','Teléfono o correo de contacto','Fecha del primer contacto','Respuesta «evaluando» o «interesado» (no descartada)','Recibo de pago del predial'],opt:[],where:'Ficha del predio (Primer contacto y negociación) y Documentos'},
  {req:['Carta de intención presentada','Interés del propietario confirmado','Condición del permiso municipal explicada al propietario'],opt:[],where:'Ficha del predio y Documentos'},
  {req:['Contrato firmado / condicionado','Memoria de cálculo estructural','Factibilidad eléctrica','Evidencia de programa de obra','Permiso municipal autorizado','Cláusula suspensiva reconocida'],opt:['Mecánica de suelos'],where:'Documentos e Hitos / Cierre'},
  {req:['Fotos y videos del sitio funcionando (tipo «Fotos / videos en operación»)'],opt:[],where:'Documentos'}];
 const STEPS=[
  {t:'Ubicar en el mapa',s:'Corredores y aforo',c:'#12a9bd',view:'mapa',go:'Abrir Mapa de oportunidades',d:'En <b>Mapa de oportunidades</b> ves los 15 corredores y los predios ya registrados con el color de su fase. En <b>Inteligencia vial</b> están las fichas de aforo vehicular de cada corredor.'},
  {t:'Registrar predio',s:'Nombre, corredor y pin',c:'#12a9bd',act:'new-predio',go:'Registrar un predio',d:'Botón rosa <b>＋ Registrar predio</b> (arriba a la derecha). Escribe el nombre, elige el corredor y toca <b>Marcar ubicación en el mapa</b>. Si eres broker, el predio queda a tu nombre automáticamente.'},
  {t:'Calificar',s:'Score de 0 a 100',c:'#7c5ce6',view:'predios',go:'Ir a Expedientes',d:'En la pestaña <b>Calificación</b> del expediente evalúas 5 criterios del 1 al 5. Para pasar a Primer contacto se necesita un score de <b>70 o más</b>. Prueba el simulador en la sección «Fases y requisitos».'},
  {t:'Subir documentos',s:'Fotos, cartas, contratos',c:'#ec8a1f',view:'predios',go:'Ir a Expedientes',d:'En la pestaña <b>Documentos</b> eliges el tipo, das clic en <b>📎 Seleccionar archivo</b> (o lo arrastras) y luego <b>Subir al expediente</b>. El archivo se renombra solo (ej. <code>foto_predio_1.jpg</code>).'},
  {t:'Solicitar avance',s:'Pestaña Hitos / Cierre',c:'#ec8a1f',view:'predios',go:'Ir a Expedientes',d:'En <b>Hitos / Cierre</b> está el botón <b>Solicitar avance de fase</b>. Si falta algo, el sistema te dice exactamente qué es antes de enviar la solicitud.'},
  {t:'Supervisor aprueba',s:'Revisa y decide',c:'#e33a6f',view:'aprobaciones',go:'Abrir Aprobaciones',d:'La solicitud aparece en <b>Aprobaciones</b>. El supervisor da <b>Ver expediente</b> (abre directo en Documentos), revisa y elige <b>Aprobar</b> o <b>Rechazar</b> con una nota. Al aprobar, el predio pasa a la siguiente fase y se repiten los pasos 3 a 6.'}];
 const ROLES=[
  {k:'broker',n:'Broker',c:'#46d98c',d:'Registra predios (quedan a su nombre), califica, sube documentos y solicita avances. Sólo ve sus propios predios.'},
  {k:'supervisor',n:'Supervisor',c:'#5aa6ff',d:'Ve todos los predios, asigna brokers y aprueba o rechaza los avances de fase.'},
  {k:'legal',n:'Legal',c:'#b48cff',d:'Revisa la parte documental y el estatus del permiso municipal. Genera el reporte ejecutivo.'},
  {k:'tecnico',n:'Técnico',c:'#2fd3c5',d:'Aporta los documentos técnicos: memoria de cálculo, factibilidad eléctrica, estudios.'},
  {k:'admin',n:'Administrador',c:'#ff5c9a',d:'Todo lo anterior, más usuarios y contraseñas, eliminar expedientes y desbloquear predios en operación.'},
  {k:'dg',n:'DG · Dirección General',c:'#f5b83d',d:'Los mismos privilegios que el Administrador.'}];
 // ✓ sí · ◐ parcial · — no   (orden de columnas = ROLES)
 const PERMS=[
  ['Registrar predios',['✓ propios','✓','—','—','✓','✓']],
  ['Editar ficha y subir evidencia',['✓ asignados','✓ todos','✓ documental','✓ técnica','✓ todos','✓ todos']],
  ['Solicitar avance de fase',['✓','✓','—','—','✓','✓']],
  ['Aprobar o rechazar fases',['—','✓','—','—','✓','✓']],
  ['Reporte ejecutivo',['—','✓','✓','—','✓','✓']],
  ['Usuarios y contraseñas',['—','—','—','—','✓','✓']],
  ['Desbloquear predio en operación',['—','—','—','—','✓','✓']],
  ['Eliminar expedientes',['—','—','—','—','✓','✓']]];
 const W={flujo:['Tráfico (aforo vehicular)',45],visibilidad:['Visibilidad',25],electrica:['Factibilidad eléctrica',10],propietario:['Acceso al propietario',10],comercial:['Condiciones económicas',10]};
 const FAQ=[
  ['¿Por qué no me deja solicitar el avance?','Porque falta algún requisito de la puerta. Al dar <b>Solicitar avance</b> aparece la lista de lo que falta; complétalo en la pestaña indicada y vuelve a intentarlo.'],
  ['¿Cómo subo una foto de WhatsApp?','Guárdala en tu equipo o celular, entra a <b>Documentos</b>, elige el tipo (ej. Fotografía del predio) y selecciónala. El sistema la renombra solo, por ejemplo <code>foto_predio_1.jpg</code>.'],
  ['No puedo editar un predio que está en operación','Es normal: en Operación todo queda en sólo lectura. Da <b>Desbloquear</b> y que un Administrador o DG escriba su usuario y contraseña. La edición queda abierta 15 minutos y se registra en la bitácora.'],
  ['Me sacó de la sesión','Por seguridad la sesión se cierra tras <b>15 minutos sin actividad</b>. Vuelve a entrar con tu usuario y contraseña.'],
  ['Me dieron una contraseña temporal','Entra con ella; el sistema te pedirá cambiarla de inmediato por una personal (mínimo 7 caracteres). La temporal puede ser de 4 dígitos.'],
  ['¿Por qué no veo los predios de otros brokers?','Cada broker ve únicamente los predios asignados a él. Supervisión, Legal, Técnico, Administrador y DG ven todos.'],
  ['¿Qué pasa si el supervisor rechaza mi solicitud?','El predio se queda en su fase y verás la nota del supervisor en la bitácora. Corrige lo que indica y vuelve a solicitar el avance.'],
  ['¿Qué tipos de archivo puedo subir?','Fotos (incluye HEIC de iPhone), videos y PDF de hasta 45 MB. También puedes arrastrarlos al recuadro de Documentos.'],
  ['¿Cómo genero el reporte para la junta?','En <b>Reporte ejecutivo</b> (Administrador, DG, Supervisor y Legal) eliges fases y corredor; puedes <b>presentarlo en pantalla</b> o <b>descargarlo en PDF</b> horizontal.'],
  ['¿Puedo instalar VEO en el celular?','Sí. Desde el navegador usa «Agregar a pantalla de inicio» o el aviso <b>Instalar VEO</b>; se abre como una app.']];
 const TABS=[['recorrido','Recorrido'],['fases','Fases y requisitos'],['aprobacion','Aprobaciones'],['roles','Roles'],['dia','Día a día'],['faq','Preguntas']];
 const st={tab:'recorrido',step:0,phase:0,role:null,flow:'ok',checks:{},rate:{flujo:4,visibilidad:4,electrica:3,propietario:3,comercial:3}};
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const score=()=>Math.round(Object.entries(W).reduce((s,[k,[,w]])=>s+st.rate[k]*w/5,0));

 function vRecorrido(){const s=STEPS[st.step];
  return `<p class="ay-lead">Este es el ciclo que repite cada predio. Toca cada paso para ver qué se hace y dónde. Los pasos <b>3 a 6</b> se repiten en cada fase hasta llegar a <b>En operación</b>.</p>
  <div class="ay-steps">${STEPS.map((x,i)=>`<button type="button" class="ay-step ${i===st.step?'on':''}" style="--c:${x.c}" data-ay="step" data-i="${i}"><i>${i+1}</i><span><b>${x.t}</b><small>${x.s}</small></span></button>${i<STEPS.length-1?'<span class="ay-arrow" aria-hidden="true">›</span>':''}`).join('')}</div>
  <div class="ay-loop">↻ Al aprobar: siguiente fase · se repiten los pasos 3 a 6 · <b>meta: EN OPERACIÓN</b></div>
  <div class="ay-detail" style="--c:${s.c}"><div class="ay-detail-num">${st.step+1}</div><div><h3>${s.t}</h3><p>${s.d}</p>
   <div class="ay-detail-actions">${st.step>0?'<button type="button" class="btn btn-ghost small" data-ay="step" data-i="'+(st.step-1)+'">‹ Anterior</button>':''}${st.step<STEPS.length-1?'<button type="button" class="btn btn-ghost small" data-ay="step" data-i="'+(st.step+1)+'">Siguiente ›</button>':''}${s.act?`<button type="button" class="btn btn-primary small" data-action="${s.act}">${s.go}</button>`:`<button type="button" class="btn btn-primary small" data-action="nav" data-view="${s.view}">${s.go} →</button>`}</div></div></div>`}

 function vFases(){const p=PH[st.phase],g=GATES[st.phase],key='g'+st.phase,ch=st.checks[key]||{},done=g.req.filter((_,i)=>ch[i]).length,last=st.phase===4;
  const sc=score();
  return `<p class="ay-lead">Entre una fase y la siguiente hay una <b>puerta</b>: el sistema no deja solicitar el avance hasta que todos los requisitos están completos. Toca una fase para ver lo que pide su puerta y úsala como lista de verificación.</p>
  <div class="ay-phases">${PH.map((x,i)=>`<button type="button" class="ay-ph ${i===st.phase?'on':''}" style="--c:${x.c}" data-ay="phase" data-i="${i}"><i>${x.n}</i><b>${x.short}</b></button>${i<4?'<span class="ay-gate" aria-hidden="true">🔒</span>':''}`).join('')}</div>
  <div class="ay-gatecard" style="--c:${(PH[st.phase+1]||p).c}">
   <div class="ay-gatehead"><div><small>${last?'FASE FINAL':'PUERTA '+'ABCD'[st.phase]}</small><h3>${last?'En operación':p.name+' → '+PH[st.phase+1].name}</h3><p>${p.what}</p></div>
    <div class="ay-meter"><b>${done}/${g.req.length}</b><small>${done===g.req.length?'¡Listo para solicitar!':'requisitos marcados'}</small></div></div>
   <div class="ay-bar"><i style="width:${Math.round(done/g.req.length*100)}%"></i></div>
   <ul class="ay-checks">${g.req.map((r,i)=>`<li><label><input type="checkbox" data-ay="check" data-k="${key}" data-i="${i}" ${ch[i]?'checked':''}/><span>${esc(r)}</span></label></li>`).join('')}${g.opt.map(o=>`<li class="opt"><span>${esc(o)} · opcional</span></li>`).join('')}</ul>
   <p class="ay-where">📂 Dónde se captura: <b>${g.where}</b>. Esta lista es sólo una guía personal; no modifica ningún expediente.</p></div>
  <div class="ay-score"><div class="ay-score-head"><div><h3>Simulador de score</h3><p>Mueve cada criterio del 1 al 5 y mira cómo cambia el score. Se necesitan <b>70</b> para pasar la puerta A.</p></div>
   <div class="ay-score-val ${sc>=70?'ok':'no'}" id="ay-score-val"><b>${sc}</b><small>${sc>=70?'✓ pasa la puerta A':'falta para 70'}</small></div></div>
   ${Object.entries(W).map(([k,[l,w]])=>`<div class="ay-srow"><span>${l} <em>${w}%</em></span><input type="range" min="1" max="5" step="1" value="${st.rate[k]}" data-ay="rate" data-k="${k}" aria-label="${l}"/><b id="ay-r-${k}">${st.rate[k]}/5</b></div>`).join('')}</div>`}

 function vAprobacion(){const f=st.flow;const on=id=>({ok:['b1','b2','s1','s2','v1','v2','ok'],falta:['b1','b2','s1','no1'],rechazo:['b1','b2','s1','s2','v1','v2','no2']}[f].includes(id)?'on':'');
  const msg={ok:'Todo completo: la solicitud llega a Aprobaciones, el supervisor revisa los documentos, aprueba y el predio <b>pasa a la siguiente fase</b>.',falta:'Faltan requisitos: el sistema <b>no envía la solicitud</b> y muestra exactamente qué falta. El broker lo completa y vuelve a solicitar.',rechazo:'El supervisor <b>rechaza con una nota</b>. El predio se queda en su fase; el broker corrige lo indicado y vuelve a solicitar.'}[f];
  return `<p class="ay-lead">El broker propone y el supervisor decide. Elige un escenario para ver el camino que sigue la solicitud.</p>
  <div class="ay-seg">${[['ok','✓ Aprobado'],['falta','⚠ Faltan requisitos'],['rechazo','✕ Rechazado']].map(([k,l])=>`<button type="button" class="${f===k?'on':''}" data-ay="flow" data-k="${k}">${l}</button>`).join('')}</div>
  <div class="ay-lanes">
   <div class="ay-lane"><small>BROKER</small><div class="ay-lrow"><span class="ay-node ${on('b1')}">Sube documentos</span><span class="ay-a">→</span><span class="ay-node ${on('b2')}">Solicitar avance</span><span class="ay-node ay-bad ${on('no1')}">⚠ Completa lo que falta</span><span class="ay-node ay-bad ${on('no2')}">✕ Corrige según la nota</span></div></div>
   <div class="ay-lane"><small>SISTEMA VEO</small><div class="ay-lrow"><span class="ay-node ay-dia ${on('s1')}">¿Requisitos completos?</span><span class="ay-a">→</span><span class="ay-node ${on('s2')}">Solicitud pendiente en Aprobaciones</span></div></div>
   <div class="ay-lane"><small>SUPERVISOR · ADMIN · DG</small><div class="ay-lrow"><span class="ay-node ${on('v1')}">Ver expediente (Documentos)</span><span class="ay-a">→</span><span class="ay-node ay-dia ${on('v2')}">¿Aprueba?</span><span class="ay-a">→</span><span class="ay-node ay-good ${on('ok')}">★ Pasa a la siguiente fase</span></div></div></div>
  <div class="ay-note">${msg}</div>
  <div class="ay-grid2"><div class="ay-card"><h3>Los archivos se renombran solos</h3><p>No importa si la foto viene de WhatsApp: el sistema le pone el nombre del documento elegido.</p>
   <table class="ay-names">${[['Fotografía del predio','foto_predio_1.jpg'],['Mapa satelital','mapa_satelital_1.jpg'],['Recibo del predial','recibo_predial_1.pdf'],['Carta de intención','carta_intencion_1.pdf'],['Fotos en operación','operacion_1.mp4']].map(([a,b])=>`<tr><td>${a}</td><td><code>${b}</code></td></tr>`).join('')}</table></div>
   <div class="ay-card"><h3>Todo queda en la Bitácora</h3><p>Cada documento, comentario, solicitud y decisión queda registrado con nombre y fecha en la pestaña <b>Bitácora</b> del expediente.</p><button type="button" class="btn btn-primary small" data-action="nav" data-view="aprobaciones">Abrir Aprobaciones →</button></div></div>`}

 function vRoles(user){const sel=st.role??Math.max(0,ROLES.findIndex(r=>r.k===user?.role));
  return `<p class="ay-lead">Toca un rol para ver qué puede hacer. Tu rol aparece marcado.</p>
  <div class="ay-roles">${ROLES.map((r,i)=>`<button type="button" class="ay-role ${i===sel?'on':''}" style="--c:${r.c}" data-ay="role" data-i="${i}"><span class="dot"></span><b>${r.n}</b>${r.k===user?.role?'<em>TU ROL</em>':''}<small>${r.d}</small></button>`).join('')}</div>
  <div class="ay-card"><h3>Permisos de ${ROLES[sel].n}</h3><ul class="ay-perms">${PERMS.map(([l,v])=>{const x=v[sel],yes=x!=='—';return `<li class="${yes?'yes':'no'}"><i>${yes?'✓':'—'}</i><span>${l}</span>${yes&&x.length>1?`<em>${x.replace('✓ ','')}</em>`:''}</li>`}).join('')}</ul></div>`}

 function vDia(){return `<p class="ay-lead">Lo que conviene saber para trabajar sin contratiempos.</p>
  <div class="ay-grid2">
   <div class="ay-card"><h3>📍 Registrar un predio</h3><ol class="ay-ol"><li>Botón rosa <b>＋ Registrar predio</b>.</li><li>Nombre del predio y corredor (15 corredores).</li><li><b>Marcar ubicación en el mapa</b>: toca el punto exacto. El corredor se marca en rosa y avisa si quedas fuera.</li><li>Se crea el expediente en fase 1 con un ID único (ej. VEO-14-00009).</li></ol><button type="button" class="btn btn-primary small" data-action="new-predio">＋ Registrar predio</button></div>
   <div class="ay-card"><h3>🔒 Predio en operación</h3><p>Su ficha, calificación, documentos, hitos y bitácora quedan en <b>sólo lectura</b>.</p><div class="ay-mini"><span>Desbloquear</span><i>→</i><span>Usuario y contraseña de Admin o DG</span><i>→</i><span>Edición abierta 15 min</span></div><p class="ay-small">El desbloqueo queda registrado en la bitácora.</p></div>
   <div class="ay-card"><h3>🛡️ Acceso y seguridad</h3><ul class="ay-ul"><li>La sesión se cierra sola tras <b>15 minutos</b> sin actividad.</li><li>El usuario puede ser un nombre con espacios (ej. <i>Juan Pérez</i>).</li><li>La contraseña temporal (desde 4 caracteres, puede ser sólo números) se cambia al primer ingreso.</li><li>Cada broker ve únicamente sus predios.</li></ul></div>
   <div class="ay-card"><h3>📊 Reporte ejecutivo</h3><p>Para Administrador, DG, Supervisor y Legal: eliges fases y corredor y obtienes una presentación con resumen, mapas por corredor con calles, ficha de cada sitio y siguientes acciones. Se presenta en pantalla o se descarga en PDF.</p></div>
   <div class="ay-card"><h3>🗺️ Mapa e Inteligencia vial</h3><p>El mapa muestra los 15 corredores y cada predio con el color de su fase. Inteligencia vial reúne las fichas de aforo vehicular, base del criterio de tráfico del score.</p><button type="button" class="btn btn-ghost small" data-action="nav" data-view="mapa">Abrir mapa →</button></div>
   <div class="ay-card ay-gold"><h3>⭐ Regla de oro</h3><p>Si <b>Solicitar avance</b> marca que falta algo, la lista dice exactamente qué es. Complétalo en la pestaña indicada y vuelve a solicitar.</p></div></div>`}

 function vFaq(){return `<p class="ay-lead">Escribe una palabra para filtrar las preguntas.</p>
  <input class="field ay-search" type="search" placeholder="Ej. contraseña, WhatsApp, rechazo…" data-ay="faq-search" aria-label="Buscar en preguntas frecuentes"/>
  <div class="ay-faq">${FAQ.map(([q,a])=>`<details class="ay-q" data-text="${esc((q+' '+a.replace(/<[^>]+>/g,'')).toLowerCase())}"><summary>${q}</summary><p>${a}</p></details>`).join('')}</div>
  <p class="ay-empty" hidden>Sin resultados. Prueba con otra palabra.</p>`}

 function body(user){return ({recorrido:vRecorrido,fases:vFases,aprobacion:vAprobacion,roles:()=>vRoles(user),dia:vDia,faq:vFaq}[st.tab]||vRecorrido)()}
 const tabs=()=>TABS.map(([k,l])=>`<button type="button" role="tab" aria-selected="${st.tab===k}" class="${st.tab===k?'on':''}" data-ay="tab" data-k="${k}">${l}</button>`).join('');
 function html(user){
  return `<div class="page-row"><div><div class="page-kicker">CENTRO DE AYUDA</div><h1 class="page-title">Ayuda · Guía del proceso</h1><div class="subhead">Cómo se mueve un predio desde que se encuentra hasta que el espectacular está en operación. Explicado en forma práctica e interactiva.</div></div><div class="spaced"><a class="btn btn-ghost" href="/assets/docs/VEO_Guia_del_proceso.pdf" target="_blank" rel="noopener" download>⇩ DESCARGAR GUÍA EN PDF</a></div></div>
  <div class="ay-hero"><div class="ay-hero-txt"><small>VEO EN 30 SEGUNDOS</small><ul><li>Cada predio tiene un <b>expediente único</b> con ficha, calificación, documentos y bitácora.</li><li>Avanza por <b>5 fases</b>; para pasar de una a otra se cumplen requisitos y un <b>supervisor aprueba</b>.</li><li>Todo queda registrado: quién subió qué, quién aprobó y cuándo.</li></ul></div>
   <div class="ay-hero-ph">${PH.map(p=>`<span style="--c:${p.c}"><i>${p.n}</i>${p.name}</span>`).join('')}</div></div>
  <div class="ay-tabs" role="tablist">${tabs()}</div>
  <div class="ay-body" id="ay-body">${body(user)}</div>`}

 function rerender(){const b=document.getElementById('ay-body');if(!b)return;b.innerHTML=body(window.VEOAyuda.user);
  const t=document.querySelector('.ay-tabs');if(t)t.innerHTML=tabs()}
 document.addEventListener('click',ev=>{const b=ev.target.closest('[data-ay]');if(!b||!b.closest('.ay-root,#view'))return;const a=b.dataset.ay;
  if(a==='tab'){st.tab=b.dataset.k;rerender()}
  else if(a==='step'){st.step=+b.dataset.i;rerender()}
  else if(a==='phase'){st.phase=+b.dataset.i;rerender()}
  else if(a==='role'){st.role=+b.dataset.i;rerender()}
  else if(a==='flow'){st.flow=b.dataset.k;rerender()}});
 document.addEventListener('change',ev=>{const el=ev.target;if(el.dataset?.ay!=='check')return;const k=el.dataset.k;(st.checks[k]=st.checks[k]||{})[el.dataset.i]=el.checked;const y=window.scrollY;rerender();window.scrollTo(0,y)});
 document.addEventListener('input',ev=>{const el=ev.target;
  if(el.dataset?.ay==='rate'){st.rate[el.dataset.k]=+el.value;const r=document.getElementById('ay-r-'+el.dataset.k);if(r)r.textContent=el.value+'/5';const s=score(),v=document.getElementById('ay-score-val');if(v){v.className='ay-score-val '+(s>=70?'ok':'no');v.innerHTML=`<b>${s}</b><small>${s>=70?'✓ pasa la puerta A':'falta para 70'}</small>`}}
  else if(el.dataset?.ay==='faq-search'){const q=el.value.trim().toLowerCase();let n=0;document.querySelectorAll('.ay-q').forEach(d=>{const hit=!q||d.dataset.text.includes(q);d.hidden=!hit;if(hit){n++;if(q)d.open=true}});const e=document.querySelector('.ay-empty');if(e)e.hidden=n>0}});
 window.VEOAyuda={html(user){this.user=user;return `<div class="ay-root">${html(user)}</div>`},user:null};
})();
