/* VEO · Reporte ejecutivo de sitios (presentación 16:9 para junta directiva).
 * Diapositivas HTML de 1280×720 px (formato panorámico de PowerPoint): se previsualizan escaladas,
 * se presentan a pantalla completa y se exportan a PDF HORIZONTAL con html2canvas + jsPDF
 * (no depende de la configuración de impresión del navegador).
 * Datos: GET /api/report (sólo admin, supervisor y legal).
 * Nota: los SVG llevan estilos en atributos (no en CSS) para que html2canvas los dibuje igual. */
(function(){
'use strict';
const PH=['BUSQUEDA_FACTIBILIDAD','PRIMER_CONTACTO','SEGUIMIENTO','CIERRE','EN_OPERACION'];
const PH_NAME=['Búsqueda / Factibilidad','Primer contacto','Seguimiento','Cierre','En operación'];
const PH_SHORT=['Factibilidad','Contacto','Seguimiento','Cierre','Operación'];
const PH_COLOR=['#12a9bd','#7c5ce6','#ec8a1f','#e33a6f','#1fa971'];
const CRIT={flujo:'Tráfico',visibilidad:'Visibilidad',electrica:'Factibilidad eléctrica',propietario:'Acceso al propietario',comercial:'Condiciones económicas'};
const DOC_LABEL={foto:'Fotografía del predio',satelital:'Mapa satelital',operacion:'En operación',dron:'Toma con dron',otro:'Imagen adicional'};
const FONT="'DM Sans',Arial,sans-serif",FONT_H="'Space Grotesk','DM Sans',Arial,sans-serif";
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rgba=(hex,a)=>{const n=parseInt(hex.slice(1),16);return `rgba(${n>>16&255},${n>>8&255},${n&255},${a})`};
const pIdx=p=>Math.max(0,PH.indexOf(p.phase));
const corr=id=>(window.VEO_DEMO_CORRIDORS||[]).find(c=>+c.id===+id)||{};
const corrName=id=>corr(id).name||('Corredor '+id);
const fecha=d=>new Date(d).toLocaleDateString('es-MX',{day:'numeric',month:'long',year:'numeric'});
const priority=s=>s>=80?['Alta','#1fa971']:s>=60?['Media','#ec8a1f']:['Baja','#e33a6f'];
const imgUrl=id=>'/api/documents/'+encodeURIComponent(id)+'/content';
const pendientes=p=>(p.phase==='EN_OPERACION'?[]:(p.next_requirements||[]).filter(x=>!x.done));
const nextStep=p=>{if(p.phase==='EN_OPERACION')return 'Sitio en operación';const pend=pendientes(p);if(!pend.length)return 'Listo para avanzar a '+PH_NAME[pIdx(p)+1];return pend[0].label};
let trazos=null;
async function loadTrazos(){if(trazos)return trazos;try{const r=await fetch('/assets/corredores-trazos.json?v=20261118-barragan');trazos=r.ok?(await r.json()).corridors:{}}catch(_){trazos={}}return trazos}

// ── Gráficos SVG ──
function mapSvg(sites,{w=1000,h=560,labels=true,dark=false,minSpan=0.06}={}){
  const pts=sites.filter(p=>Number.isFinite(+p.lat)&&Number.isFinite(+p.lng));
  if(!pts.length)return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="100%"><rect width="${w}" height="${h}" fill="${dark?'#141a4a':'#f3f5fa'}"/><text x="${w/2}" y="${h/2}" text-anchor="middle" font-family="${FONT}" font-size="18" font-weight="700" fill="#8a93a8">Sin ubicación georreferenciada</text></svg>`;
  const s=Math.min(...pts.map(p=>+p.lat)),n=Math.max(...pts.map(p=>+p.lat)),we=Math.min(...pts.map(p=>+p.lng)),e=Math.max(...pts.map(p=>+p.lng));
  const lat0=(s+n)/2,kx=Math.cos(lat0*Math.PI/180);
  let spanX=Math.max((e-we)*kx,minSpan)*1.4,spanY=Math.max(n-s,minSpan)*1.4;
  if(spanX/spanY>w/h)spanY=spanX*h/w;else spanX=spanY*w/h;
  const cx=(we+e)/2,X=lng=>((lng-cx)*kx/spanX+.5)*w,Y=lat=>(.5-(lat-lat0)/spanY)*h;
  const used=new Set(pts.map(p=>+p.corridor_id));
  const bg=dark?'#141a4a':'#f3f5fa',grid=dark?'#1e2560':'#e4e9f2',cold=dark?'#2c3478':'#cdd5e2',hot=dark?'#ff6b96':'#f29bb8';
  let g='';for(let x=0;x<w;x+=48)g+=`<line x1="${x}" y1="0" x2="${x}" y2="${h}" stroke="${grid}" stroke-width="1"/>`;for(let y=0;y<h;y+=48)g+=`<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="${grid}" stroke-width="1"/>`;
  let lines='';
  for(const [id,ls] of Object.entries(trazos||{})){const on=used.has(+id);for(const l of ls){if(l.length<2)continue;lines+=`<path d="M${l.map(q=>X(q[1]).toFixed(1)+' '+Y(q[0]).toFixed(1)).join('L')}" fill="none" stroke="${on?hot:cold}" stroke-width="${on?6:3}" stroke-linecap="round" stroke-linejoin="round" opacity="${on?1:.8}"/>`}}
  let cl='';const taken=pts.map(p=>[X(+p.lng),Y(+p.lat)]);if(labels)for(const id of used){const ls=(trazos||{})[id];if(!ls)continue;let best=null;const free=(x,y)=>taken.every(([a,b])=>Math.abs(a-x)>150||Math.abs(b-y)>34);for(const l of ls){for(const q of l){const x=X(q[1]),y=Y(q[0]);if(x>60&&x<w-200&&y>40&&y<h-40&&free(x,y)){best=[x,y];break}}if(best)break}if(best)taken.push(best);
    if(best)cl+=`<text x="${(best[0]+10).toFixed(0)}" y="${(best[1]-10).toFixed(0)}" font-family="${FONT}" font-size="12" font-weight="800" letter-spacing="1" fill="${dark?'#ff9ab7':'#c2185b'}" stroke="${bg}" stroke-width="4" paint-order="stroke">${esc(corrName(id).toUpperCase())}</text>`}
  // Separar pines que se enciman: se desplazan en espiral y se dibuja una línea guía al punto real.
  const R=17,pos=pts.map(p=>({p,x0:X(+p.lng),y0:Y(+p.lat)}));pos.forEach(a=>{a.x=a.x0;a.y=a.y0});
  for(let it=0;it<60;it++){let moved=false;for(let a=0;a<pos.length;a++)for(let b=a+1;b<pos.length;b++){const A=pos[a],B=pos[b];let dx=B.x-A.x,dy=B.y-A.y,d=Math.hypot(dx,dy);const min=2*R+8;if(d<min){if(d<.01){dx=Math.cos(b*2.4);dy=Math.sin(b*2.4);d=1}const k=(min-d)/2/d;A.x-=dx*k;A.y-=dy*k;B.x+=dx*k;B.y+=dy*k;moved=true}}if(!moved)break}
  for(const a of pos){a.x=Math.max(R+4,Math.min(w-R-4,a.x));a.y=Math.max(R+4,Math.min(h-R-4,a.y))}
  const pins=pos.map(({p,x0,y0,x,y})=>{const c=PH_COLOR[pIdx(p)],off=Math.hypot(x-x0,y-y0)>4;return `${off?`<line x1="${x0.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${c}" stroke-width="2"/><circle cx="${x0.toFixed(1)}" cy="${y0.toFixed(1)}" r="4" fill="${c}"/>`:`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="26" fill="${c}" opacity=".18"/>`}<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${R-1}" fill="${c}" stroke="#fff" stroke-width="3.5"/><text x="${x.toFixed(1)}" y="${(y+5.5).toFixed(1)}" text-anchor="middle" font-family="${FONT}" font-size="15" font-weight="800" fill="#fff">${p._n}</text>`}).join('');
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="100%" preserveAspectRatio="xMidYMid slice"><rect width="${w}" height="${h}" fill="${bg}"/>${g}${lines}${cl}${pins}<g transform="translate(${w-34} 40)"><circle r="20" fill="${dark?'#0b1240':'#fff'}" stroke="${dark?'#2c3478':'#dfe4ee'}"/><path d="M0 -13 L7 7 L0 3 L-7 7 Z" fill="#ef3b6e"/></g>${w>=400&&h>=300?`<text x="${w-14}" y="${h-12}" text-anchor="end" font-family="${FONT}" font-size="10.5" font-weight="600" fill="${dark?'#7a82c0':'#8a93a8'}">Trazos de corredores © OpenStreetMap</text>`:''}</svg>`;
}
function donut(parts,{size=200,stroke=34,center='',sub=''}={}){
  const total=parts.reduce((n,x)=>n+x.n,0)||1,r=(size-stroke)/2,C=2*Math.PI*r;let off=0,arcs='';
  for(const x of parts){if(!x.n)continue;const len=C*x.n/total;arcs+=`<circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${x.c}" stroke-width="${stroke}" stroke-dasharray="${len.toFixed(2)} ${(C-len).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 ${size/2} ${size/2})"/>`;off+=len}
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="#edf0f6" stroke-width="${stroke}"/>${arcs}<text x="${size/2}" y="${size/2+8}" text-anchor="middle" font-family="${FONT_H}" font-size="44" font-weight="800" fill="#141a4a">${center}</text><text x="${size/2}" y="${size/2+32}" text-anchor="middle" font-family="${FONT}" font-size="13" font-weight="700" fill="#7a809c">${sub}</text></svg>`;
}
function gauge(score,color,size=150){
  const st=14,r=(size-st)/2,C=2*Math.PI*r,len=C*Math.max(0,Math.min(100,+score||0))/100;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="#edf0f6" stroke-width="${st}"/><circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${color}" stroke-width="${st}" stroke-linecap="round" stroke-dasharray="${len.toFixed(2)} ${(C-len).toFixed(2)}" transform="rotate(-90 ${size/2} ${size/2})"/><text x="${size/2}" y="${size/2+10}" text-anchor="middle" font-family="${FONT_H}" font-size="40" font-weight="800" fill="#141a4a">${score??0}</text><text x="${size/2}" y="${size/2+32}" text-anchor="middle" font-family="${FONT}" font-size="12" font-weight="700" fill="#7a809c">de 100</text></svg>`;
}
function chevrons(items,w=1160,h=108){
  const n=items.length||1,gap=10,cw=(w-gap*(n-1))/n,tip=26;
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${items.map((x,i)=>{const x0=i*(cw+gap),first=i===0,last=i===n-1;const pts=[[x0,0],[x0+cw-(last?0:tip),0],[x0+cw+(last?0:0),h/2],[x0+cw-(last?0:tip),h],[x0,h],[x0+(first?0:tip),h/2]];if(last){pts[1]=[x0+cw,0];pts[2]=[x0+cw,h/2];pts[3]=[x0+cw,h]}
    const tx=x0+(first?22:tip+18);return `<polygon points="${pts.map(p=>p[0].toFixed(1)+','+p[1]).join(' ')}" fill="${x.c}"/><text x="${tx}" y="34" font-family="${FONT}" font-size="13" font-weight="800" letter-spacing="1.2" fill="#ffffff" opacity=".9">FASE 0${x.i+1}</text><text x="${tx}" y="78" font-family="${FONT_H}" font-size="44" font-weight="800" fill="#ffffff">${x.n}</text><text x="${tx+(String(x.n).length*26)+12}" y="76" font-family="${FONT}" font-size="15" font-weight="700" fill="#ffffff">${esc(PH_NAME[x.i])}</text>`}).join('')}</svg>`;
}

// ── Estructura común ──
function slide(inner,{kicker='',title='',cls='',num,total,date}){
  const head=title?`<header class="rs-head"><div class="rs-kicker">${kicker}</div><h2>${title}</h2></header>`:'';
  return `<section class="rep-slide ${cls}"><div class="rs-accent"></div><img class="rs-logo" src="/assets/media/logo-veo.png" alt="VEO" crossorigin="anonymous"/>${head}<div class="rs-body">${inner}</div><footer class="rs-foot"><span>VEO TERRITORIOS · Reporte ejecutivo de sitios</span><span>${esc(date)}</span><b>${String(num).padStart(2,'0')}<em>/${String(total).padStart(2,'0')}</em></b></footer></section>`;
}
const pill=(t,c,solid=true)=>`<span class="rs-pill" style="${solid?`background:${c};color:#fff`:`background:${rgba(c,.12)};color:${c}`}">${esc(t)}</span>`;
const photo=(m,cls='')=>m?`<div class="rs-ph ${cls}"><img src="${imgUrl(m.id)}" alt="" crossorigin="anonymous"/><span>${esc(DOC_LABEL[m.type]||'Imagen')}</span></div>`:'';

function build(data,opts){
  const phases=opts.phases?.length?opts.phases:PH.slice(0,4);
  const sites=data.predios.filter(p=>phases.includes(p.phase)&&(!opts.corridor||+p.corridor_id===+opts.corridor)).map(p=>({...p}));
  sites.sort((a,b)=>pIdx(a)-pIdx(b)||String(a.code).localeCompare(String(b.code)));
  sites.forEach((p,i)=>p._n=i+1);
  const date=fecha(data.generated_at||Date.now()),user=opts.user||'';
  const phaseItems=PH.map((k,i)=>({k,i,c:PH_COLOR[i],n:sites.filter(p=>p.phase===k).length})).filter(x=>phases.includes(x.k));
  const avg=sites.length?Math.round(sites.reduce((n,p)=>n+(+p.score||0),0)/sites.length):0;
  const ready=sites.filter(p=>p.phase!=='EN_OPERACION'&&(p.next_requirements||[]).length&&!pendientes(p).length);
  const byCorr={};for(const p of sites)byCorr[p.corridor_id]=(byCorr[p.corridor_id]||0)+1;
  const prio={Alta:0,Media:0,Baja:0};for(const p of sites)prio[priority(+p.score||0)[0]]++;
  const S=[];

  // 1 · Portada (blanca, moderna)
  const maxPh=Math.max(1,...phaseItems.map(x=>x.n));
  S.push({cls:'rs-cover',inner:`<div class="rc-band"></div>
   <div class="rc-l"><div class="rc-k"><span></span>VEO TERRITORIOS · EXPANSIÓN DOOH</div><h1>Reporte<br/>ejecutivo <em>de sitios</em></h1><p>Pantallas LED y espectaculares · Pipeline de adquisición</p>
    <div class="rc-kpis"><div><b>${sites.length}</b><span>${sites.length===1?'Sitio':'Sitios'}</span></div><div><b>${avg}<i>/100</i></b><span>Score promedio</span></div><div><b>${Object.keys(byCorr).length}</b><span>Corredores</span></div></div>
    <div class="rc-meta"><b>${esc(date)}</b>${user?`<span>Preparó: ${esc(user)}</span>`:''}${opts.corridor?`<span>${esc(corrName(opts.corridor))}</span>`:''}</div></div>
   <div class="rc-r"><svg class="rc-art" width="560" height="600" viewBox="0 0 560 600"><defs><linearGradient id="rcg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#21c4d9"/><stop offset=".5" stop-color="#6a3df0"/><stop offset="1" stop-color="#ef3b6e"/></linearGradient></defs><rect x="40" y="0" width="520" height="600" rx="40" fill="url(#rcg)"/><circle cx="470" cy="90" r="160" fill="#fff" opacity=".10"/><circle cx="470" cy="90" r="100" fill="#fff" opacity=".10"/><circle cx="120" cy="560" r="130" fill="#fff" opacity=".08"/></svg>
    <div class="rc-card"><div class="rc-card-h">Pipeline del reporte</div>${phaseItems.map(x=>`<div class="rc-ph"><span><i style="background:${x.c}"></i>${PH_NAME[x.i]}</span><div><em style="width:${(100*x.n/maxPh).toFixed(0)}%;background:${x.c}"></em></div><b>${x.n}</b></div>`).join('')}<div class="rc-card-f"><b>${sites.length}</b> sitios · ${phaseItems.length} fases</div></div></div>`});

  // 2 · Panorama
  const corrRows=Object.entries(byCorr).sort((a,b)=>b[1]-a[1]).slice(0,6),maxC=Math.max(1,...corrRows.map(x=>x[1]));
  const kpi=(ico,c,label,val,sub)=>`<div class="rs-kpi"><span class="rs-kpi-ico" style="background:${rgba(c,.12)};color:${c}">${ico}</span><div><small>${label}</small><b>${val}</b><em>${sub}</em></div></div>`;
  S.push({kicker:'01 · PANORAMA DEL PORTAFOLIO',title:'Resumen ejecutivo',inner:`<div class="rs-kpis">${kpi('◎','#1b1a8c','SITIOS EN EL REPORTE',sites.length,phaseItems.length+' fases')}${kpi('★','#ec8a1f','SCORE PROMEDIO',avg+'<i>/100</i>','Factibilidad interna')}${kpi('➜','#1fa971','LISTOS PARA AVANZAR',ready.length,'Requisitos completos')}${kpi('⌁','#e33a6f','CORREDORES',Object.keys(byCorr).length,'Con al menos un sitio')}</div>
   <div class="rs-flow">${chevrons(phaseItems)}</div>
   <div class="rs-row2"><div class="rs-card rs-donut"><h3>Prioridad del portafolio</h3><div class="rs-donut-in">${donut([{n:prio.Alta,c:'#1fa971'},{n:prio.Media,c:'#ec8a1f'},{n:prio.Baja,c:'#e33a6f'}],{size:180,stroke:30,center:sites.length,sub:'sitios'})}<ul>${[['Alta','#1fa971','Score ≥ 80'],['Media','#ec8a1f','Score 60 – 79'],['Baja','#e33a6f','Score < 60']].map(([k,c,t])=>`<li><i style="background:${c}"></i><b>${prio[k]}</b> Prioridad ${k}<small>${t}</small></li>`).join('')}</ul></div></div>
   <div class="rs-card"><h3>Sitios por corredor</h3>${corrRows.map(([id,n])=>`<div class="rs-hbar"><span>${esc(corrName(id))}</span><div><i style="width:${(100*n/maxC).toFixed(0)}%"></i></div><b>${n}</b></div>`).join('')||'<p class="rs-muted">Sin sitios</p>'}</div></div>`});

  // 3 · Mapas por corredor (cada uno con su propio encuadre; 4 por diapositiva)
  const groups=Object.entries(byCorr).sort((a,b)=>b[1]-a[1]).map(([id])=>({id,ps:sites.filter(p=>String(p.corridor_id)===String(id))}));
  for(let g=0;g<Math.max(1,groups.length);g+=4){
    const chunk=groups.slice(g,g+4),pages=Math.ceil(groups.length/4);
    S.push({kicker:'02 · UBICACIÓN POR CORREDOR'+(pages>1?` · ${g/4+1} DE ${pages}`:''),title:'Mapas de sitios por corredor',inner:`<div class="rs-cmaps n${chunk.length}">${chunk.map(({id,ps})=>`<div class="rs-cmap"><div class="rs-cmap-h"><b>${esc(corrName(id))}</b><span>${ps.length} ${ps.length===1?'sitio':'sitios'}</span></div><div class="rs-cmap-b"><div class="rs-cmap-map">${mapSvg(ps,{w:chunk.length===1?760:chunk.length===2?560:330,h:chunk.length===1?400:chunk.length===2?300:190,labels:false,minSpan:.018})}</div><div class="rs-cmap-list">${ps.slice(0,chunk.length<=2?9:4).map(p=>`<div><span class="rs-num" style="background:${PH_COLOR[pIdx(p)]}">${p._n}</span><b>${esc(p.alias)}</b><small>${PH_SHORT[pIdx(p)]} · ${p.score??'—'} pts</small></div>`).join('')}${ps.length>(chunk.length<=2?9:4)?`<p class="rs-muted">+ ${ps.length-(chunk.length<=2?9:4)} más</p>`:''}</div></div></div>`).join('')||'<p class="rs-muted">Sin sitios georreferenciados</p>'}</div><div class="rs-maplegend2">${phaseItems.map(x=>`<span><i style="background:${x.c}"></i>${PH_NAME[x.i]}</span>`).join('')}</div>`});
  }

  // 4 · Índice maestro (9 por diapositiva)
  for(let i=0;i<Math.max(1,sites.length);i+=9){
    const rows=sites.slice(i,i+9),pages=Math.ceil(sites.length/9);
    S.push({kicker:'03 · ÍNDICE MAESTRO'+(pages>1?` · ${i/9+1} DE ${pages}`:''),title:'Índice maestro de sitios',inner:`<div class="rs-table"><div class="rs-tr rs-th"><span>#</span><span>Sitio</span><span>Corredor</span><span>Aforo diario*</span><span>Fase</span><span>Score</span><span>Siguiente paso</span></div>${rows.map(p=>{const c=PH_COLOR[pIdx(p)],[pr,pc]=priority(+p.score||0);return `<div class="rs-tr"><span><i class="rs-num" style="background:${c}">${p._n}</i></span><span><b>${esc(p.alias)}</b><small>${esc(p.code)}${p.municipio?' · '+esc(p.municipio):''}</small></span><span>${esc(corrName(p.corridor_id))}</span><span>${esc(corr(p.corridor_id).aforo_detail||'—')}</span><span>${pill(PH_SHORT[pIdx(p)],c,false)}</span><span class="rs-sc"><b style="color:${pc}">${p.score??'—'}</b><i><em style="width:${+p.score||0}%;background:${pc}"></em></i></span><span>${esc(nextStep(p))}</span></div>`}).join('')||'<p class="rs-muted">Sin sitios con los filtros elegidos</p>'}</div><p class="rs-note">* Aforo de referencia del corredor · estudio VEO nov. 2026 · no es aforo certificado del sitio.</p>`});
  }

  // 5 · Ficha por sitio
  for(const p of sites){
    const c=PH_COLOR[pIdx(p)],[pr,pc]=priority(+p.score||0),imgs=p.images||[];
    let r={};try{r=JSON.parse(p.ratings_json||'{}')}catch(_){}
    const req=(p.phase==='EN_OPERACION'?p.readiness?.items:p.next_requirements)||[];
    const thumbs=imgs.slice(1,3);
    const second=thumbs.length===2?thumbs.map(m=>photo(m,'rs-ph-sm')).join(''):`${thumbs.length?photo(thumbs[0],'rs-ph-sm'):''}<div class="rs-minimap">${mapSvg([p],{w:thumbs.length?280:580,h:150,labels:false,minSpan:.03})}<span>Ubicación</span></div>`;
    const fact=(k,v)=>`<div><small>${k}</small><b>${v}</b></div>`;
    S.push({kicker:`FICHA DE SITIO · #${p._n} · ${esc(p.code)}`,title:esc(p.alias),cls:'rs-ficha',inner:`<div class="rs-tags">${pill('Fase '+(pIdx(p)+1)+' · '+PH_NAME[pIdx(p)],c)}${pill(corrName(p.corridor_id),'#1b1a8c',false)}${pill('Prioridad '+pr,pc,false)}</div>
     <div class="rs-ficha-grid"><div class="rs-ficha-l">${imgs[0]?photo(imgs[0],'rs-ph-main'):`<div class="rs-ph rs-ph-main rs-ph-empty"><span>Sin fotografía cargada</span></div>`}<div class="rs-ficha-thumbs">${second}</div></div>
     <div class="rs-ficha-r"><div class="rs-ficha-top"><div class="rs-gauge">${gauge(p.score,c,132)}<span style="color:${pc}">Prioridad ${pr}</span></div><div class="rs-facts">${fact('Aforo del corredor',esc(corr(p.corridor_id).aforo_detail||'—'))}${fact('Responsable',esc(p.broker_name))}${fact('Ubicación',esc([p.direccion,p.municipio].filter(Boolean).join(', ')||'Por capturar'))}${fact('Coordenadas',p.lat!=null?(+p.lat).toFixed(5)+', '+(+p.lng).toFixed(5):'—')}${fact('Documentos',p.docs_count+' en expediente')}${fact('Alta',esc(fecha(p.created_at)))}</div></div>
     <div class="rs-card rs-crit"><h3>Calificación por criterio</h3>${Object.keys(CRIT).map(k=>`<div class="rs-crit-row"><span>${CRIT[k]} <em>${data.weights?.[k]??''}%</em></span><i><em style="width:${Math.max(0,Math.min(5,+r[k]||0))*20}%;background:${c}"></em></i><b>${+r[k]||0}/5</b></div>`).join('')}</div>
     <div class="rs-card rs-avance"><div class="rs-steps">${PH.map((k,i)=>`<div class="${i<pIdx(p)?'done':i===pIdx(p)?'now':''}" style="--c:${PH_COLOR[i]}"><i style="${i<=pIdx(p)?`background:${PH_COLOR[i]};border-color:${PH_COLOR[i]}`:''}"></i><span>${PH_SHORT[i]}</span></div>`).join('')}</div>
      <h3>${p.phase==='EN_OPERACION'?'Expediente para operar':'Para avanzar a '+esc(PH_NAME[pIdx(p)+1]||'')}</h3><div class="rs-req">${req.slice(0,6).map(x=>`<span class="${x.done?'ok':''}">${x.done?'✓':'•'} ${esc(x.label)}</span>`).join('')||'<span class="ok">✓ Sin pendientes</span>'}</div>${p.last_comment?`<p class="rs-comment">“${esc(p.last_comment.body)}” <em>— ${esc(p.last_comment.author||'')}</em></p>`:''}</div></div></div>`});
  }

  // 6 · Ranking
  const rank=sites.slice().sort((a,b)=>(+b.score||0)-(+a.score||0)).slice(0,9);
  S.push({kicker:'04 · PRIORIZACIÓN',title:'Ranking de sitios por prioridad',inner:`<div class="rs-rank">${rank.map((p,i)=>{const [pr,pc]=priority(+p.score||0);return `<div class="rs-rank-row"><span class="rs-rank-pos">${i+1}</span><div class="rs-rank-name"><b>${esc(p.alias)}</b><small>${esc(corrName(p.corridor_id))} · ${PH_SHORT[pIdx(p)]}</small></div><div class="rs-rank-bar"><i style="width:${Math.max(8,+p.score||0)}%;background:linear-gradient(90deg,${rgba(pc,.55)},${pc})"><b>${p.score??0}</b></i></div>${pill(pr,pc,false)}<span class="rs-rank-next">${esc(nextStep(p))}</span></div>`}).join('')||'<p class="rs-muted">Sin sitios</p>'}</div><p class="rs-note">Prioridad: Alta ≥ 80 · Media 60–79 · Baja &lt; 60 (score interno de factibilidad).</p>`});

  // 7 · Siguientes acciones
  const agg={};for(const p of sites)for(const x of pendientes(p))(agg[x.label]=agg[x.label]||[]).push(p);
  const aggRows=Object.entries(agg).sort((a,b)=>b[1].length-a[1].length).slice(0,8),maxA=Math.max(1,...aggRows.map(x=>x[1].length));
  S.push({kicker:'05 · PLAN DE ACCIÓN',title:'Siguientes acciones',inner:`<div class="rs-row2 rs-actions"><div class="rs-card"><h3>Requisitos pendientes más frecuentes</h3>${aggRows.map(([k,ps])=>`<div class="rs-hbar rs-hbar-a"><span>${esc(k)}</span><div><i style="width:${(100*ps.length/maxA).toFixed(0)}%"></i></div><b>${ps.length}</b></div><small class="rs-hbar-sites">${ps.slice(0,4).map(p=>'#'+p._n+' '+esc(p.alias)).join(' · ')}${ps.length>4?' …':''}</small>`).join('')||'<p class="rs-muted">Sin requisitos pendientes.</p>'}</div>
   <div class="rs-card rs-ready"><h3>Listos para solicitar avance</h3>${ready.length?ready.slice(0,6).map(p=>`<div><span class="rs-num" style="background:${PH_COLOR[pIdx(p)]}">${p._n}</span><b>${esc(p.alias)}</b><small>→ ${esc(PH_NAME[pIdx(p)+1])}</small></div>`).join(''):`<p class="rs-muted">Ningún sitio tiene completos los requisitos de su siguiente fase.</p><div class="rs-ready-phases">${phaseItems.filter(x=>x.i<4).map(x=>{const ps=sites.filter(p=>p.phase===x.k);const done=ps.reduce((n,p)=>n+(p.next_requirements||[]).filter(y=>y.done).length,0),all=ps.reduce((n,p)=>n+(p.next_requirements||[]).length,0);const pct=all?Math.round(100*done/all):0;return `<div><span style="color:${x.c}">${PH_SHORT[x.i]} → ${PH_SHORT[x.i+1]}</span><i><em style="width:${pct}%;background:${x.c}"></em></i><b>${pct}%</b></div>`}).join('')}<small>Avance promedio de requisitos para la siguiente fase</small></div>`}<div class="rs-ready-k"><b>${ready.length}</b><span>de ${sites.length} sitios pueden avanzar hoy</span></div></div></div>`});

  const total=S.length;
  return {html:S.map((x,i)=>slide(x.inner,{...x,num:i+1,total,date})).join(''),count:total,sites:sites.length};
}

// ── Vista previa escalada ──
function fit(root){root.querySelectorAll('.rep-frame').forEach(f=>{const s=f.firstElementChild;if(s)s.style.transform=`scale(${f.clientWidth/1280})`})}
const framed=html=>html.replace(/<section class="rep-slide/g,'<div class="rep-frame"><section class="rep-slide').replace(/<\/section>/g,'</section></div>');
async function render(target,data,opts){
  await loadTrazos();const out=build(data,opts);
  target.innerHTML=framed(out.html);fit(target);
  if(!target._ro&&window.ResizeObserver){target._ro=new ResizeObserver(()=>fit(target));target._ro.observe(target)}
  return out;
}

// ── PDF horizontal (16:9) ──
function loadScript(src){return new Promise((ok,ko)=>{if([...document.scripts].some(s=>s.src.endsWith(src)))return ok();const s=document.createElement('script');s.src=src;s.onload=ok;s.onerror=()=>ko(new Error('No se pudo cargar '+src));document.head.appendChild(s)})}
function waitImages(root,ms=25000){const imgs=[...root.querySelectorAll('img')];return Promise.race([Promise.all(imgs.map(i=>i.complete?1:new Promise(r=>{i.onload=i.onerror=r}))),new Promise(r=>setTimeout(r,ms))])}
async function pdf(data,opts,onProgress=()=>{}){
  await Promise.all([loadTrazos(),loadScript('/assets/vendor/html2canvas-1.4.1.min.js'),loadScript('/assets/vendor/jspdf-2.5.1.umd.min.js')]);
  const out=build(data,opts);
  const host=document.createElement('div');host.className='rep-capture';host.innerHTML=out.html;document.body.appendChild(host);
  try{
    await waitImages(host);if(document.fonts?.ready)await document.fonts.ready;
    const {jsPDF}=window.jspdf;const doc=new jsPDF({orientation:'landscape',unit:'pt',format:[960,540],compress:true});
    const slides=[...host.querySelectorAll('.rep-slide')];
    for(let i=0;i<slides.length;i++){
      onProgress(i+1,slides.length);
      const canvas=await window.html2canvas(slides[i],{scale:2,useCORS:true,backgroundColor:'#ffffff',logging:false,width:1280,height:720,windowWidth:1280,windowHeight:720});
      if(i)doc.addPage([960,540],'landscape');
      doc.addImage(canvas.toDataURL('image/jpeg',.9),'JPEG',0,0,960,540,undefined,'FAST');
    }
    doc.save(`Reporte ejecutivo VEO ${new Date().toISOString().slice(0,10)}.pdf`);
    return out;
  }finally{host.remove()}
}

// ── Modo presentación ──
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

window.VEOReport={render,pdf,present,PH,PH_NAME,PH_COLOR};
})();
