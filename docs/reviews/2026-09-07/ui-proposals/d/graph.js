(() => {
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  window.createDecisionGraph=(api)=>{
    const $=id=>document.getElementById(id),svg=$('decision-network');
    let selectedMetric='activation',scope='workspace',period='q3',selected=null,zoom=1,box={x:0,y:0,width:1400,height:660},pan=null,visible=[];
    const realProjects=()=>api.projects.filter(p=>!p.isPortfolio);
    function scopedProjects(){const p=api.projects.find(p=>p.id===scope);return !p?realProjects():p.isPortfolio?realProjects().filter(x=>p.memberIds.includes(x.id)):[p];}
    function options(){
      $('graph-scope').innerHTML='<option value="workspace">All projects</option>'+api.projects.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}${p.isPortfolio?' · Portfolio':''}</option>`).join('');
      if(!api.projects.some(p=>p.id===scope))scope='workspace';$('graph-scope').value=scope;
      $('graph-metric').innerHTML=api.metricCatalog.map(m=>`<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('');
      if(!api.metricCatalog.some(m=>m.id===selectedMetric))selectedMetric=api.metricCatalog[0]?.id||'';$('graph-metric').value=selectedMetric;
    }
    const stamp=d=>Date.parse(d+'T00:00:00Z');
    function dates(){
      if(period==='q3')return [stamp('2026-07-01'),stamp('2026-09-30')];
      if(period==='q4')return [stamp('2026-10-01'),stamp('2026-12-31')];
      if(period==='year')return [stamp('2026-01-01'),stamp('2026-12-31')];
      const ds=scopedProjects().flatMap(p=>p.reports.map(r=>stamp(r.graphDate||'2026-09-21')));return [Math.min(stamp('2026-07-01'),...ds)-7*86400000,Math.max(stamp('2026-09-30'),...ds)+7*86400000];
    }
    function label(text,x,y){const words=String(text).split(/\s+/),lines=[''];for(const word of words){if((lines.at(-1)+' '+word).trim().length>24&&lines.at(-1))lines.push(word);else lines[lines.length-1]=(lines.at(-1)+' '+word).trim();}return `<text class="node-label" x="${x}" y="${y}" text-anchor="middle">${lines.slice(0,3).map((line,i)=>`<tspan x="${x}" dy="${i?21:0}">${esc(line)}${i===2&&lines.length>3?'…':''}</tspan>`).join('')}</text>`;}
    function node(kind,key,title,x,y,reviewed=false){const chosen=selected===key;return `<g class="graph-node ${kind} ${reviewed?'reviewed':''} ${chosen?'selected':''}" data-node="${esc(key)}" role="button" aria-label="${esc(kind==='project'?'Project: '+title:'Decision: '+title)}" aria-pressed="${chosen}" tabindex="0"><title>${esc(title)}</title><circle class="node-halo" cx="${x}" cy="${y}" r="${kind==='project'?34:41}"/>${kind==='project'?`<rect class="node-core" x="${x-15}" y="${y-15}" width="30" height="30" rx="7" transform="rotate(45 ${x} ${y})"/>`:`<circle class="node-orbit" cx="${x}" cy="${y}" r="25"/><circle class="node-core" cx="${x}" cy="${y}" r="12"/>`}${label(title,x,kind==='project'?y-40:y+57)}</g>`;}
    function render({reset=true}={}){
      options();const metric=api.metricCatalog.find(m=>m.id===selectedMetric),[from,to]=dates(),days=(to-from)/86400000;
      const width=Math.max(1100,days*8+340),height=690,groups=scopedProjects().map(p=>({project:p,reports:p.reports.filter(r=>r.coreMetricIds?.includes(selectedMetric)&&stamp(r.graphDate||'2026-09-21')>=from&&stamp(r.graphDate||'2026-09-21')<=to)})).filter(g=>g.reports.length);
      visible=groups.flatMap(g=>g.reports.map(r=>({key:g.project.id+':'+r.id,project:g.project,report:r})));
      if(!visible.some(n=>n.key===selected)&&!groups.some(g=>'project:'+g.project.id===selected))selected=null;
      const x=date=>330+(stamp(date)-from)/(to-from)*(width-450),projectYs=groups.map((_,i)=>groups.length===1?height/2:150+i*(height-290)/Math.max(1,groups.length-1));
      let grid='',edges='',nodes='';
      for(let time=new Date(from);time.getTime()<=to;time.setUTCDate(time.getUTCDate()+Math.max(7,Math.round(days/6)))){const pos=330+(time.getTime()-from)/(to-from)*(width-450);grid+=`<line class="time-grid" x1="${pos}" x2="${pos}" y1="42" y2="${height-55}"/><text class="time-label" x="${pos}" y="${height-20}" text-anchor="middle">${time.toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'})}</text>`;}
      const metricY=height/2;
      for(const [i,{project,reports}] of groups.entries()){
        const py=projectYs[i],px=215;edges+=`<path class="metric-edge" d="M100 ${metricY} C160 ${metricY} 160 ${py} ${px} ${py}"/>`;nodes+=node('project','project:'+project.id,project.name,px,py);
        const sorted=[...reports].sort((a,b)=>stamp(a.graphDate||'2026-09-21')-stamp(b.graphDate||'2026-09-21'));
        let previous={x:px,y:py};
        sorted.forEach((r,j)=>{const nx=x(r.graphDate||'2026-09-21'),ny=py+(j%2?44:-44),key=project.id+':'+r.id;edges+=`<path class="decision-edge" d="M${previous.x+20} ${previous.y} C${(previous.x+nx)/2} ${previous.y} ${(previous.x+nx)/2} ${ny} ${nx-25} ${ny}" marker-end="url(#edge-arrow)"/>`;nodes+=node('decision',key,r.graphLabel||r.title,nx,ny,r.graphStatus==='Reviewed');previous={x:nx,y:ny};});
      }
      svg.innerHTML=`<defs><pattern id="stars" width="101" height="87" patternUnits="userSpaceOnUse"><circle cx="13" cy="24" r=".8" fill="#a0b3cc" opacity=".3"/><circle cx="68" cy="66" r=".6" fill="#a0b3cc" opacity=".25"/></pattern><radialGradient id="metric-glow"><stop stop-color="#7cddd0" stop-opacity=".2"/><stop offset="1" stop-color="#7cddd0" stop-opacity="0"/></radialGradient><marker id="edge-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 10 5 0 10" fill="#526679"/></marker></defs><rect width="${width}" height="${height}" fill="url(#stars)"/>${grid}${edges}<g class="metric-node" role="img" aria-label="Core metric: ${esc(metric?.name||'No metric')}"><circle cx="81" cy="${metricY}" r="90" fill="url(#metric-glow)"/><circle cx="81" cy="${metricY}" r="26" fill="#132e2b" stroke="#7cddd0"/><path d="m69 ${metricY+3} 8-9 6 3 9-11" fill="none" stroke="#7cddd0" stroke-width="2"/>${label(metric?.name||'No metric',81,metricY+55)}</g>${nodes}`;
      $('graph-count').textContent=`${visible.length} decision${visible.length===1?'':'s'} · ${groups.length} project${groups.length===1?'':'s'}`;
      $('graph-empty').hidden=visible.length>0;
      if(reset){box={x:0,y:0,width,height};zoom=1;}applyBox();renderInspector();
    }
    function applyBox(){svg.setAttribute('viewBox',`${box.x} ${box.y} ${box.width/zoom} ${box.height/zoom}`);$('graph-zoom-label').textContent=Math.round(zoom*100)+'%';$('graph-zoom-out').disabled=zoom<=.5;$('graph-zoom-in').disabled=zoom>=4;}
    function changeZoom(factor){const old=zoom;zoom=Math.max(.5,Math.min(4,zoom*factor));box.x+=box.width/old/2-box.width/zoom/2;box.y+=box.height/old/2-box.height/zoom/2;applyBox();}
    function renderInspector(){const panel=$('graph-inspector');panel.hidden=!selected;if(!selected)return;
      const item=visible.find(n=>n.key===selected),project=item?.project||api.projects.find(p=>'project:'+p.id===selected),r=item?.report,metric=api.metricCatalog.find(m=>m.id===selectedMetric);
      if(!project){panel.hidden=true;return;}
      const estimate=r?.estimate?.metricId===selectedMetric?r.estimate:null;
      let result='Pending',detail='No measured effect yet.';
      if(r?.graphReadout?.metricId===selectedMetric){result=r.graphReadout.label;detail=r.graphReadout.note;}
      const target=estimate?api.workbench.format(metric,estimate.mode==='points'?metric.latest+estimate.change:metric.latest*(1+estimate.change/100)):'—';
      panel.innerHTML=`<div class="inspector-top"><span>${r?'Decision':'Project'}</span><button id="close-node" aria-label="Close decision details">×</button></div><span class="graph-status">${esc(r?.graphStatus||'Project')}</span><h2>${esc(r?.title||project.name)}</h2><p>${esc(r?.overview||project.goal)}</p><div class="node-result"><span>Impact</span><strong>${esc(result)}</strong><p>${esc(detail)}</p>${estimate?`<p>Target: ${esc(target)} · User estimate</p>`:''}</div><dl><dt>Project</dt><dd>${esc(project.name)}</dd><dt>Core metric</dt><dd>${esc(metric?.name)}</dd>${r?`<dt>Decision date</dt><dd>${esc(r.graphDate||'2026-09-21')}</dd>`:''}</dl><button class="button" id="open-graph-report">${r?'Open report':'Open project'} ↗</button><p class="graph-small">${project.sample?'Sample decision and observations.':'Local draft.'} Links show recorded relationships, not proof of causation.</p>`;
      $('close-node').onclick=()=>{selected=null;render({reset:false});};
      $('open-graph-report').onclick=()=>{api.activateProject(project.id);if(r){api.state.report=r;api.renderReport();}api.switchTab('reports');};
    }
    function selectNode(e){const n=e.target.closest('[data-node]');if(!n)return;selected=n.dataset.node;render({reset:false});[...svg.querySelectorAll('[data-node]')].find(node=>node.dataset.node===selected)?.focus({preventScroll:true});if(matchMedia('(max-width:650px)').matches)$('graph-inspector').scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth'});}
    svg.addEventListener('click',selectNode);
    svg.addEventListener('keydown',e=>{if(['Enter',' '].includes(e.key)&&e.target.closest('[data-node]')){e.preventDefault();selectNode(e);}else if(['+','=','-','Home','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();if(e.key==='Home')render();else if(['+','=','-'].includes(e.key))changeZoom(e.key==='-'?1/1.25:1.25);else{box.x+=(e.key==='ArrowLeft'?-90:e.key==='ArrowRight'?90:0)/zoom;box.y+=(e.key==='ArrowUp'?-90:e.key==='ArrowDown'?90:0)/zoom;applyBox();}}});
    svg.addEventListener('wheel',e=>{e.preventDefault();changeZoom(e.deltaY<0?1.1:1/1.1);},{passive:false});
    svg.addEventListener('pointerdown',e=>{if(e.target.closest('[data-node]'))return;pan={x:e.clientX,y:e.clientY,bx:box.x,by:box.y};svg.setPointerCapture(e.pointerId);});
    svg.addEventListener('pointermove',e=>{if(!pan)return;const rect=svg.getBoundingClientRect(),scale=Math.max(box.width/zoom/rect.width,box.height/zoom/rect.height);box.x=pan.bx-(e.clientX-pan.x)*scale;box.y=pan.by-(e.clientY-pan.y)*scale;applyBox();});
    for(const event of ['pointerup','pointercancel','lostpointercapture'])svg.addEventListener(event,()=>pan=null);
    $('graph-zoom-in').onclick=()=>changeZoom(1.25);$('graph-zoom-out').onclick=()=>changeZoom(1/1.25);$('graph-fit').onclick=()=>render();
    function openScope(id){scope=id;selected=null;const project=api.projects.find(p=>p.id===id);if(project?.isPortfolio){selectedMetric=project.reports[0].coreMetricIds[0]||selectedMetric;period=({'Q3 2026':'q3','Q4 2026':'q4','2026':'year'})[project.period]||period;$('graph-period').value=period;}render();}
    $('graph-metric').onchange=e=>{selectedMetric=e.target.value;selected=null;render();};$('graph-scope').onchange=e=>openScope(e.target.value);$('graph-period').onchange=e=>{period=e.target.value;selected=null;render();};
    return {render,openScope,get scope(){return scope;}};
  };
})();
