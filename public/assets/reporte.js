/* VEO · Reporte ejecutivo de sitios (presentación 16:9 para junta directiva).
 * Genera diapositivas HTML de 1280×720 px (= 13.333 × 7.5 in, formato PowerPoint panorámico):
 * se previsualizan escaladas, se presentan a pantalla completa y se imprimen / guardan como PDF.
 * Datos: GET /api/report (sólo admin, supervisor y legal). */
(function(){
'use strict';
const PH=['BUSQUEDA_FACTIBILIDAD','PRIMER_CONTACTO','SEGUIMIENTO','CIERRE','EN_OPERACION'];
const PH_NAME=['Búsqueda / Factibilidad','Primer contacto','Seguimiento','Cierre','En operación'];
const PH_COLOR=['#12a9bd','#7c5ce6','#ec8a1f','#e33a6f','#1fa971'];
const CRIT={flujo:'Intensidad y sentido de tráfico',visibilidad:'Visibilidad y exposición',electrica:'Factibilidad eléctrica',propietario:'Acceso al propietario',comercial:'Condiciones económicas'};
const DOC_LABEL={foto:'Fotografía del predio',satelital:'Mapa satelital',operacion:'En operación',dron:'Toma con dron',otro:'Imagen adicional'};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pIdx=p=>Math.max(0,PH.indexOf(p.phase));
const corr=id=>(window.VEO_DEMO_CORRIDORS||[]).find(c=>+c.id===+id)||{};
const corrName=id=>corr(id).name||('Corredor '+id);
const fecha=d=>new Date(d).toLocaleDateString('es-MX',{day:'numeric',month:'long',year:'numeric'});
const priority=s=>s>=80?['Alta','#1fa971']:s>=60?['Media','#ec8a1f']:['Baja','#e33a6f'];
const imgUrl=id=>'/api/documents/'+encodeURIComponent(id)+'/content';
const nextStep=p=>{const pend=(p.next_requirements||[]).filter(x=>!x.done);if(p.phase==='EN_OPERACION')return 'Sitio en operación';if(!pend.length)return 'Listo para solicitar avance a '+PH_NAME[pIdx(p)+1];return pend[0].label};
let trazos=null;
async function loadTrazos(){if(trazos)return trazos;try{const r=await fetch('/assets/corredores-trazos.json?v=20261118-barragan');trazos=r.ok?(await r.json()).corridors:{}}catch(_){trazos={}}return trazos}

// ── Mapa vectorial: corredores (OSM) + pines numerados por fase ──
function mapSvg(sites,{w=1000,h=560,labels=true}={}){
  const pts=sites.filter(p=>Number.isFinite(+p.lat)&&Number.isFinite(+p.lng));
  if(!pts.length)return `<div class="rep-nomap">Sin sitios georreferenciados</div>`;
  let s=Math.min(...pts.map(p=>+p.lat)),n=Math.max(...pts.map(p=>+p.lat)),we=Math.min(...pts.map(p=>+p.lng)),e=Math.max(...pts.map(p=>+p.lng));
  const lat0=(s+n)/2,kx=Math.cos(lat0*Math.PI/180);
  let spanX=Math.max((e-we)*kx,0.06),spanY=Math.max(n-s,0.06);
  const pad=1.35;spanX*=pad;spanY*=pad;
  if(spanX/spanY>w/h)spanY=spanX*h/w;else spanX=spanY*w/h;
  const cx=(we+e)/2,cy=lat0;
  const X=lng=>((lng-cx)*kx/spanX+.5)*w, Y=lat=>(.5-(lat-cy)/spanY)*h;
  const used=new Set(pts.map(p=>+p.corridor_id));
  let lines='';
  for(const [id,ls] of Object.entries(trazos||{})){
    const hot=used.has(+id);
    for(const l of ls){if(l.length<2)continue;const d='M'+l.map(q=>X(q[1]).toFixed(1)+' '+Y(q[0]).toFixed(1)).join('L');
      lines+=`<path d="${d}" fill="none" stroke="${hot?'#f5a3bd':'#c9d3e0'}" stroke-width="${hot?5:3}" stroke-linecap="round" stroke-linejoin="round"/>`}
  }
  // etiquetas de corredores con sitios
  let cl='';for(const id of used){const ls=(trazos||{})[id];if(!ls)continue;let best=null;for(const l of ls)for(const q of l){const x=X(q[1]),y=Y(q[0]);if(x>60&&x<w-60&&y>30&&y<h-30){best=[x,y];break}}if(best&&labels)cl+=`<text x="${best[0]+8}" y="${best[1]-8}" class="rep-map-corr">${esc(corrName(id))}</text>`}
  const pins=pts.map(p=>{const x=X(+p.lng),y=Y(+p.lat),c=PH_COLOR[pIdx(p)];return `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)})"><circle r="17" fill="${c}" stroke="#fff" stroke-width="4"/><text y="6" text-anchor="middle" class="rep-map-num">${p._n}</text>${labels?`<text x="24" y="6" class="rep-map-lbl">${esc(p.alias)}</text>`:''}</g>`}).join('');
  return `<svg class="rep-map" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice"><defs><pattern id="repgrid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#e6ecf3" stroke-width="1"/></pattern></defs><rect width="${w}" height="${h}" fill="#f6f8fb"/><rect width="${w}" height="${h}" fill="url(#repgrid)"/>${lines}${cl}${pins}<text x="${w-18}" y="${h-14}" text-anchor="end" class="rep-map-src">Trazos © OpenStreetMap · Monterrey y área metropolitana</text><g transform="translate(${w-40} 44)"><path d="M0 -24 L9 6 L0 0 L-9 6 Z" fill="#e33a6f"/><text y="24" text-anchor="middle" class="rep-map-n">N</text></g></svg>`;
}

// ── Estructura de diapositiva ──
function slide(inner,{title='',sub='',cls='',num,total,date,user}){
  return `<section class="rep-slide ${cls}"><div class="rep-topline"></div><img class="rep-logo" src="/assets/media/logo-veo.png" alt="VEO"/>${title?`<header class="rep-head"><h2>${title}</h2>${sub?`<p>${sub}</p>`:''}<i></i></header>`:''}<div class="rep-body">${inner}</div><footer class="rep-foot"><span>Reporte ejecutivo de sitios · Pantallas LED espectaculares</span><span>${esc(date)}</span><b>${num} / ${total}</b></footer></section>`;
}
const chip=(t,c)=>`<span class="rep-chip" style="background:${c}">${esc(t)}</span>`;

function build(data,opts){
  const phases=opts.phases?.length?opts.phases:PH.slice(0,4);
  let sites=data.predios.filter(p=>phases.includes(p.phase)&&(!opts.corridor||+p.corridor_id===+opts.corridor));
  sites.sort((a,b)=>pIdx(a)-pIdx(b)||String(a.code).localeCompare(String(b.code)));
  sites.forEach((p,i)=>p._n=i+1);
  const date=fecha(data.generated_at||Date.now()),user=opts.user||'';
  const parts=[];
  const phaseList=phases.map(k=>PH_NAME[PH.indexOf(k)]).join(' · ');
  const avg=sites.length?Math.round(sites.reduce((n,p)=>n+(+p.score||0),0)/sites.length):0;
  const ready=sites.filter(p=>p.phase!=='EN_OPERACION'&&(p.next_requirements||[]).length&&p.next_requirements.every(x=>x.done)).length;

  // 1. Portada
  parts.push({cls:'rep-cover',inner:`<div class="rep-cover-l"><small>VEO TERRITORIOS · EXPANSIÓN DOOH</small><h1>Reporte ejecutivo<br/>de sitios</h1><p>Propuesta e instalación de espectaculares y pantallas LED</p><div class="rep-cover-bar"></div><ul><li><b>${sites.length}</b> ${sites.length===1?'sitio':'sitios'} en el reporte</li><li>Fases: ${esc(phaseList)}</li>${opts.corridor?`<li>Corredor: ${esc(corrName(opts.corridor))}</li>`:''}</ul><div class="rep-cover-date">${esc(date)}${user?` · Preparó: ${esc(user)}`:''}</div></div><div class="rep-cover-r">${mapSvg(sites,{w:640,h:720,labels:false})}</div>`});

  // 2. Resumen
  const byPhase=PH.map((k,i)=>({k,i,n:sites.filter(p=>p.phase===k).length})).filter(x=>phases.includes(x.k));
  const byCorr={};for(const p of sites)byCorr[p.corridor_id]=(byCorr[p.corridor_id]||0)+1;
  const corrRows=Object.entries(byCorr).sort((a,b)=>b[1]-a[1]).slice(0,7);const maxC=Math.max(1,...corrRows.map(x=>x[1]));
  parts.push({title:'Resumen ejecutivo',sub:'Estado del portafolio de sitios por fase del proceso de adquisición',inner:`<div class="rep-kpis"><div class="rep-kpi"><small>SITIOS EN EL REPORTE</small><b>${sites.length}</b><em>${esc(phaseList)}</em></div><div class="rep-kpi"><small>SCORE PROMEDIO</small><b>${avg}<span>/100</span></b><em>Calificación interna de factibilidad</em></div><div class="rep-kpi"><small>LISTOS PARA AVANZAR</small><b>${ready}</b><em>Con todos los requisitos de su siguiente fase</em></div><div class="rep-kpi"><small>CORREDORES</small><b>${Object.keys(byCorr).length}</b><em>Con al menos un sitio</em></div></div>
   <div class="rep-two"><div class="rep-card"><h3>Sitios por fase</h3><div class="rep-phases">${byPhase.map(x=>`<div class="rep-phase" style="--c:${PH_COLOR[x.i]}"><span>0${x.i+1}</span><b>${x.n}</b><em>${PH_NAME[x.i]}</em></div>`).join('')}</div></div><div class="rep-card"><h3>Sitios por corredor</h3>${corrRows.length?corrRows.map(([id,n])=>`<div class="rep-bar"><span>${esc(corrName(id))}</span><div><i style="width:${100*n/maxC}%"></i></div><b>${n}</b></div>`).join(''):'<p class="rep-muted">Sin sitios</p>'}</div></div>`});

  // 3. Mapa general
  parts.push({title:'Mapa general de ubicaciones',sub:'Sitios numerados según el índice maestro · color por fase',inner:`<div class="rep-mapwrap">${mapSvg(sites,{w:1180,h:500})}<div class="rep-legend">${byPhase.map(x=>`<span><i style="background:${PH_COLOR[x.i]}"></i>${PH_NAME[x.i]}</span>`).join('')}</div></div>`});

  // 4. Índice maestro (8 filas por diapositiva)
  for(let i=0;i<Math.max(1,sites.length);i+=8){
    const rows=sites.slice(i,i+8);
    parts.push({title:'Índice maestro de sitios',sub:`Ubicación, fase, responsable y siguiente paso${sites.length>8?` · ${Math.floor(i/8)+1} de ${Math.ceil(sites.length/8)}`:''}`,inner:`<table class="rep-table"><thead><tr><th>#</th><th>ID</th><th>Sitio</th><th>Corredor</th><th>Aforo diario*</th><th>Fase</th><th>Score</th><th>Siguiente paso</th></tr></thead><tbody>${rows.map(p=>`<tr><td><span class="rep-n" style="background:${PH_COLOR[pIdx(p)]}">${p._n}</span></td><td class="rep-mono">${esc(p.code)}</td><td><b>${esc(p.alias)}</b><small>${esc(p.municipio||p.direccion||'')}</small></td><td>${esc(corrName(p.corridor_id))}</td><td>${esc(corr(p.corridor_id).aforo_detail||'—')}</td><td>${chip(PH_NAME[pIdx(p)],PH_COLOR[pIdx(p)])}</td><td><b>${p.score??'—'}</b></td><td>${esc(nextStep(p))}</td></tr>`).join('')||'<tr><td colspan="8" class="rep-muted">Sin sitios con los filtros elegidos</td></tr>'}</tbody></table><p class="rep-note">* Aforo de referencia del corredor (estudio VEO, nov. 2026); no es aforo certificado del sitio.</p>`});
  }

  // 5. Ficha por sitio
  for(const p of sites){
    const c=PH_COLOR[pIdx(p)],imgs=(p.images||[]).slice(0,3);
    // Sólo las fotos que existen (1 a 3 recuadros); sin fotos, un aviso a lo ancho.
    const boxes=(imgs.length?imgs.map((_,i)=>i):[0]).map(i=>{const m=imgs[i];return `<figure class="rep-photo"><figcaption>${m?esc(DOC_LABEL[m.type]||'Imagen'):'Sin imagen'}</figcaption>${m?`<img src="${imgUrl(m.id)}" alt="${esc(m.name||'')}"/>`:`<div class="rep-nophoto">Sin fotografía cargada</div>`}</figure>`}).join('');
    let r={};try{r=JSON.parse(p.ratings_json||'{}')}catch(_){}
    const bars=Object.keys(CRIT).map(k=>`<div class="rep-crit"><span>${CRIT[k]} <em>${data.weights?.[k]??''}%</em></span><div><i style="width:${Math.max(0,Math.min(5,+r[k]||0))*20}%;background:${c}"></i></div><b>${+r[k]||0}/5</b></div>`).join('');
    const req=(p.phase==='EN_OPERACION'?p.readiness?.items:p.next_requirements)||[];
    const [prio,pc]=priority(+p.score||0);
    parts.push({title:`Ficha de sitio · ${esc(p.alias)}`,sub:'',cls:'rep-ficha',inner:`<div class="rep-tags"><span class="rep-tag rep-tag-dark">#${p._n} · ${esc(p.code)}</span>${chip('Fase '+(pIdx(p)+1)+' · '+PH_NAME[pIdx(p)],c)}<span class="rep-tag">${esc(corrName(p.corridor_id))}</span><span class="rep-tag" style="border-color:${pc};color:${pc}">Prioridad ${prio}</span></div>
     <div class="rep-photos" style="grid-template-columns:repeat(${Math.max(1,imgs.length)},1fr)">${boxes}</div>
     <div class="rep-three"><div class="rep-box" style="--c:#0f1b4d"><h4>Datos rápidos</h4><ul><li><b>Corredor:</b> ${esc(corrName(p.corridor_id))}</li><li><b>Ubicación:</b> ${esc([p.direccion,p.municipio].filter(Boolean).join(', ')||'Por capturar')}</li><li><b>Coordenadas:</b> ${p.lat!=null?(+p.lat).toFixed(5)+', '+(+p.lng).toFixed(5):'—'}</li><li><b>Aforo corredor:</b> ${esc(corr(p.corridor_id).aforo_detail||'—')} veh/día</li><li><b>Responsable:</b> ${esc(p.broker_name)}</li><li><b>Documentos:</b> ${p.docs_count} · Alta ${esc(fecha(p.created_at))}</li></ul></div>
     <div class="rep-box" style="--c:${c}"><h4>Calificación <span class="rep-score" style="color:${c}">${p.score??0}<small>/100</small></span></h4>${bars}</div>
     <div class="rep-box" style="--c:#ec8a1f"><h4>${p.phase==='EN_OPERACION'?'Expediente para operar':'Siguientes pasos · '+esc(PH_NAME[pIdx(p)+1]||'')}</h4><ul class="rep-check">${req.slice(0,6).map(x=>`<li class="${x.done?'ok':''}">${x.done?'✓':'○'} ${esc(x.label)}</li>`).join('')||'<li class="ok">✓ Sin requisitos pendientes</li>'}</ul>${p.last_comment?`<p class="rep-comment">“${esc(p.last_comment.body)}”<em>— ${esc(p.last_comment.author||'')}</em></p>`:''}</div></div>`});
  }

  // 6. Ranking por prioridad
  const rank=sites.slice().sort((a,b)=>(+b.score||0)-(+a.score||0)).slice(0,10);
  parts.push({title:'Ranking de sitios por prioridad',sub:'Alta ≥ 80 · Media 60–79 · Baja < 60 (score interno de factibilidad)',inner:`<div class="rep-rank">${rank.map((p,i)=>{const [pr,pc]=priority(+p.score||0);return `<div class="rep-rank-row"><span class="rep-rank-pos">${i+1}</span><div class="rep-rank-name"><b>${esc(p.alias)}</b><small>${esc(p.code)} · ${esc(corrName(p.corridor_id))}</small></div>${chip(PH_NAME[pIdx(p)],PH_COLOR[pIdx(p)])}<div class="rep-rank-bar"><i style="width:${+p.score||0}%;background:${pc}"></i></div><b class="rep-rank-score">${p.score??0}</b><span class="rep-prio" style="color:${pc};border-color:${pc}">${pr}</span><span class="rep-rank-next">${esc(nextStep(p))}</span></div>`}).join('')||'<p class="rep-muted">Sin sitios</p>'}</div>`});

  const total=parts.length;
  return {html:parts.map((x,i)=>slide(x.inner,{...x,num:i+1,total,date,user})).join(''),count:total,sites:sites.length};
}

// ── Escalado de las diapositivas a su contenedor ──
function fit(root){root.querySelectorAll('.rep-frame').forEach(f=>{const s=f.firstElementChild;if(s)s.style.transform=`scale(${f.clientWidth/1280})`})}
function framed(html){return html.replace(/<section class="rep-slide/g,'<div class="rep-frame"><section class="rep-slide').replace(/<\/section>/g,'</section></div>')}

async function render(target,data,opts){
  await loadTrazos();
  const out=build(data,opts);
  target.innerHTML=framed(out.html);
  fit(target);
  if(!target._ro&&window.ResizeObserver){target._ro=new ResizeObserver(()=>fit(target));target._ro.observe(target)}
  return out;
}

function waitImages(root,ms=20000){const imgs=[...root.querySelectorAll('img')];return Promise.race([Promise.all(imgs.map(i=>i.complete?1:new Promise(r=>{i.onload=i.onerror=r}))),new Promise(r=>setTimeout(r,ms))])}

async function print(data,opts){
  await loadTrazos();
  let root=document.getElementById('report-print');
  if(!root){root=document.createElement('div');root.id='report-print';document.body.appendChild(root)}
  root.innerHTML=build(data,opts).html;
  await waitImages(root);
  const prev=document.title;document.title='Reporte ejecutivo VEO · '+new Date().toISOString().slice(0,10);
  document.body.classList.add('printing-report');
  const done=()=>{document.body.classList.remove('printing-report');document.title=prev;window.removeEventListener('afterprint',done)};
  window.addEventListener('afterprint',done);
  setTimeout(()=>{window.print();setTimeout(done,1500)},60);
}

function present(data,opts){
  const out=build(data,opts);
  const ov=document.createElement('div');ov.className='rep-present';
  ov.innerHTML=`<div class="rep-stage"></div><div class="rep-ctrl"><button type="button" data-rp="prev" aria-label="Anterior">‹</button><span class="rep-count"></span><button type="button" data-rp="next" aria-label="Siguiente">›</button><button type="button" data-rp="close" aria-label="Salir">✕</button></div>`;
  document.body.appendChild(ov);
  const stage=ov.querySelector('.rep-stage');stage.innerHTML=out.html;
  const slides=[...stage.querySelectorAll('.rep-slide')];let i=0;
  const size=()=>{const k=Math.min(innerWidth/1280,innerHeight/720);slides.forEach(s=>{s.style.transform=`translate(-50%,-50%) scale(${k})`})};
  const show=n=>{i=Math.max(0,Math.min(slides.length-1,n));slides.forEach((s,j)=>s.classList.toggle('is-on',j===i));ov.querySelector('.rep-count').textContent=`${i+1} / ${slides.length}`};
  const close=()=>{document.removeEventListener('keydown',key);removeEventListener('resize',size);if(document.fullscreenElement)document.exitFullscreen?.().catch(()=>{});ov.remove()};
  const key=e=>{if(['ArrowRight','PageDown',' ','Enter'].includes(e.key)){e.preventDefault();show(i+1)}else if(['ArrowLeft','PageUp'].includes(e.key)){e.preventDefault();show(i-1)}else if(e.key==='Escape')close()};
  ov.addEventListener('click',e=>{const b=e.target.closest('[data-rp]');if(b){e.stopPropagation();b.dataset.rp==='prev'?show(i-1):b.dataset.rp==='next'?show(i+1):close();return}if(e.target.closest('.rep-stage'))show(e.clientX<innerWidth/3?i-1:i+1)});
  let x0=null;ov.addEventListener('touchstart',e=>{x0=e.touches[0].clientX},{passive:true});ov.addEventListener('touchend',e=>{if(x0==null)return;const dx=e.changedTouches[0].clientX-x0;if(Math.abs(dx)>40)show(dx<0?i+1:i-1);x0=null},{passive:true});
  document.addEventListener('keydown',key);addEventListener('resize',size);
  ov.requestFullscreen?.().catch(()=>{});
  size();show(0);
}

window.VEOReport={render,print,present,PH,PH_NAME,PH_COLOR};
})();
