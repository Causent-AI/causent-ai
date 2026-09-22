(() => {
  'use strict';
  const api=window.CausentProposal,$=id=>document.getElementById(id);
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function dialog(title,body){const node=document.createElement('dialog');node.className='workbench-dialog extension-dialog';node.setAttribute('aria-label',title);node.innerHTML=`<div class="dialog-heading"><h2>${escape(title)}</h2><button class="icon-button" aria-label="Close ${escape(title)}">×</button></div>${body}`;node.querySelector('.icon-button').onclick=()=>node.close();node.addEventListener('close',()=>node.remove(),{once:true});document.body.append(node);node.showModal();return node;}
  function tabKeys(root){root.addEventListener('keydown',event=>{const buttons=[...root.querySelectorAll('[role="tab"]')],index=buttons.indexOf(event.target);if(index<0)return;let next=index;if(event.key==='ArrowRight')next=(index+1)%buttons.length;else if(event.key==='ArrowLeft')next=(index+buttons.length-1)%buttons.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=buttons.length-1;else return;event.preventDefault();buttons[next].click();buttons[next].focus();});}
  const first=api.projects[0];
  first.reports.forEach((r,i)=>Object.assign(r,{graphDate:['2026-07-08','2026-08-15','2026-09-10'][i],graphLabel:['Simplify setup','Starter workspace','Setup support'][i],graphStatus:i===2?'Planned':'Reviewed',coreMetricIds:i===2?['setup','support']:i===1?['activation','workspaces']:['activation','setup']}));
  first.reports[0].graphReadout={metricId:'activation',label:'Inconclusive',note:'Sample rollout estimate: +2.1 pp; interval −0.8 to +5.0 pp. Shared rollout, not an individual decision effect.'};
  function seedProject(id,name,goal,items){
    const core=[...new Set(items.flatMap(i=>i.metrics))];
    const reports=items.map((item,index)=>api.workbench.prepareReport({id:id+'-decision-'+(index+1),title:item.title,overview:item.summary,decision:item.summary,implementation:'Review the scope, build the smallest useful change, and verify it before rollout.',measurement:'Register the selected outcome and actual exposure. Review the result when sufficient observations are available.',coreMetricIds:item.metrics,graphDate:item.date,graphStatus:item.status,graphLabel:item.title}));
    const actions=items.map((item,index)=>({id:index+1,title:item.title,owner:'Product & Engineering',status:'Planned',security:'Standard',harness:'Codex',completedOn:'',date:null,day:null,pr:null,prUrl:'',summary:item.summary,checks:['Review the proposed scope.','Verify the experience before rollout.'],instructions:'Implement the reviewed change. Test the affected flow and submit a PR for review.',aiBudget:{inputTokens:40000,outputTokens:12000,inputRate:5,outputRate:25,passes:2}}));
    api.projects.push({id,name,goal,sample:true,metrics:api.metricCatalog.filter(m=>core.includes(m.id)),reports,actions});
  }
  seedProject('team-adoption','Team adoption','Help more invited teams reach a useful shared workspace.',[
    {title:'Simplify invitations',summary:'Offer one clear invitation step and show whether teammates have joined.',metrics:['activation','workspaces'],date:'2026-07-28',status:'Reviewed'},
    {title:'Shared starter template',summary:'Give invited teammates a shared starting point they can edit together.',metrics:['activation','workspaces'],date:'2026-09-05',status:'Planned'}
  ]);
  seedProject('self-service','Self service','Make setup guidance available in the moment.',[
    {title:'Contextual guidance',summary:'Show concise guidance beside the setup settings that repeatedly prompt questions.',metrics:['activation','support'],date:'2026-08-02',status:'Reviewed'},
    {title:'Guided checklist',summary:'Offer an optional checklist with direct links to the next useful setup task.',metrics:['activation','setup','support'],date:'2026-09-20',status:'Planned'}
  ]);
  let dataSection='metrics',pendingGraphScope=null;
  function beforeActivate(project){if(!project.isPortfolio)return;const members=api.projects.filter(p=>project.memberIds.includes(p.id));project.actions=members.flatMap(p=>p.actions.map(a=>({...structuredClone(a),_source:{projectId:p.id,actionId:a.id}}))).map((a,index)=>({...a,id:index+1}));project.metrics=api.metricCatalog.filter(m=>members.some(p=>p.metrics.some(metric=>metric.id===m.id)));pendingGraphScope=project.id;}
  function syncAction(action){if(!action._source)return;const source=api.projects.find(p=>p.id===action._source.projectId)?.actions.find(a=>a.id===action._source.actionId);if(!source)return;const changes=structuredClone(action);delete changes.id;delete changes._source;Object.assign(source,changes);}
  function makePortfolio(name,memberIds,metricId,period){
    const members=api.projects.filter(p=>memberIds.includes(p.id)),id='portfolio-'+crypto.randomUUID();
    const report=api.workbench.prepareReport({id:id+'-report',title:name,overview:`${name} brings together ${members.map(p=>p.name).join(', ')} for ${period}.`,decision:'Review the connected decisions and choose the next changes using their evidence and shared core metric.',implementation:`Coordinate ${members.reduce((n,p)=>n+p.actions.length,0)} actions across ${members.length} projects. Keep owners, harnesses, and PRs attached to each action.`,measurement:'Use the existing default models for individual readouts. A combined effect has not been evaluated; separate lifts are not added together.',coreMetricIds:[metricId]});
    const project={id,name,goal:report.overview,isPortfolio:true,memberIds,period,sample:true,metrics:[],actions:[],reports:[report]};beforeActivate(project);api.projects.push(project);return project;
  }
  makePortfolio('Q3 growth',['first-session','team-adoption','self-service'],'activation','Q3 2026');pendingGraphScope=null;
  const graph=window.createDecisionGraph(api),ai=window.createAIWorkshop(api,{escape,dialog,tabKeys});
  const connections=window.createDataConnections(api,{escape,dialog});
  function setDataSection(value){dataSection=value;document.querySelectorAll('[data-workshop]').forEach(b=>{const current=b.dataset.workshop===value;b.setAttribute('aria-selected',String(current));b.tabIndex=current?0:-1;});for(const key of ['metrics','connections','ai'])$('data-'+key).hidden=key!==value;if(value==='connections'){api.closeAI();connections.render();}if(value==='ai'){api.closeAI();ai.render();}applyLayout();}
  function applyLayout(){const tab=api.state.tab,dark=tab==='graph',noDrawer=dark||tab==='data'&&dataSection!=='metrics'||['projects','onboarding'].includes(tab);$('middle').classList.toggle('graph-open',dark);$('middle').classList.toggle('no-drawer',noDrawer);$('drawer').hidden=noDrawer;$('preview-note').hidden=dark;$('ask-button').hidden=dark||tab==='data'&&dataSection!=='metrics'||api.state.assistant||['projects','onboarding'].includes(tab);}
  function onTab(tab){applyLayout();if(tab==='graph'){if(pendingGraphScope){graph.openScope(pendingGraphScope);pendingGraphScope=null;}else graph.render();}if(tab==='data')setDataSection(dataSection);if(tab==='actions')ai.decorateActions(true);if(tab==='projects')renderPortfolios();$('portfolio-impact-note').hidden=!api.state.project.isPortfolio;}
  const notice=document.createElement('p');notice.id='portfolio-impact-note';notice.className='portfolio-notice';notice.hidden=true;notice.textContent='Portfolio view · Combined impact is not evaluated. Default models are unchanged.';$('view-impact').querySelector('.page-heading').after(notice);
  function renderPortfolios(){
    let root=$('portfolio-library');if(!root){root=document.createElement('section');root.id='portfolio-library';root.className='organization';$('view-projects').append(root);}
    for(const button of $('project-list').querySelectorAll('[data-project]'))button.hidden=!!api.projects.find(p=>p.id===button.dataset.project)?.isPortfolio;
    $('project-count').textContent=api.projects.filter(p=>!p.isPortfolio).length+' projects';
    root.innerHTML=`<div class="section-heading"><h2>Portfolios</h2><button class="text-button" id="new-portfolio">＋ Portfolio</button></div><div class="portfolio-cards">${api.projects.filter(p=>p.isPortfolio).map(p=>`<article class="portfolio-card"><div class="portfolio-symbol">◈</div><h3>${escape(p.name)}</h3><p>${p.memberIds.length} projects · ${escape(p.period)}</p><div><button class="text-button" data-portfolio-open="${p.id}">Open ↗</button><button class="text-button" data-portfolio-graph="${p.id}">Graph ↗</button></div></article>`).join('')}</div>`;
    root.querySelector('#new-portfolio').onclick=createPortfolio;root.querySelectorAll('[data-portfolio-open]').forEach(b=>b.onclick=()=>api.activateProject(b.dataset.portfolioOpen));root.querySelectorAll('[data-portfolio-graph]').forEach(b=>b.onclick=()=>{api.activateProject(b.dataset.portfolioGraph);api.switchTab('graph');});
  }
  function createPortfolio(){
    const members=api.projects.filter(p=>!p.isPortfolio),modal=dialog('New portfolio',`<form id="portfolio-form"><div class="form-grid"><label>Name<input name="name" required maxlength="100" placeholder="Q4 growth"></label><label>Period<select name="period"><option>Q3 2026</option><option>Q4 2026</option><option>2026</option></select></label><label>Core metric<select name="metric" required>${api.metricCatalog.map(m=>`<option value="${escape(m.id)}">${escape(m.name)}</option>`).join('')}</select></label></div><fieldset class="portfolio-members"><legend>Projects</legend>${members.map(p=>`<label><input type="checkbox" name="member" value="${escape(p.id)}">${escape(p.name)}</label>`).join('')}</fieldset><p class="form-error" id="portfolio-error" hidden></p><p class="small-help">Groups existing projects and their decisions. Individual estimates stay separate.</p><button class="button primary compact-primary" type="submit">Create portfolio</button></form>`);
    modal.querySelector('form').onsubmit=event=>{event.preventDefault();const form=new FormData(event.currentTarget),ids=form.getAll('member'),name=form.get('name').trim();if(!name||!ids.length){const error=modal.querySelector('#portfolio-error');error.textContent='Enter a name and select at least one project.';error.hidden=false;return;}const metricId=form.get('metric');if(!members.some(p=>ids.includes(p.id)&&p.metrics.some(m=>m.id===metricId))){const error=modal.querySelector('#portfolio-error');error.textContent='Choose a core metric used by one of the selected projects.';error.hidden=false;return;}const p=makePortfolio(name,ids,metricId,form.get('period'));modal.close();api.activateProject(p.id);api.toast('Portfolio created locally.');};
  }
  $('create-portfolio').onclick=createPortfolio;
  document.querySelectorAll('[data-workshop]').forEach(b=>b.onclick=()=>setDataSection(b.dataset.workshop));tabKeys(document.querySelector('[aria-label="Data sections"]'));
  api.onActionConfig=syncAction;
  window.CausentD={onTab,beforeActivate,syncAction};
  api.refresh();renderPortfolios();applyLayout();ai.decorateActions();
  // A shared link can open either addition without altering another proposal tab.
  function openLinkedSection(){
    if(location.hash==='#graph')api.switchTab('graph');
    if(location.hash==='#connections'){api.switchTab('data');setDataSection('connections');}
    if(location.hash==='#ai'){api.switchTab('data');setDataSection('ai');}
  }
  window.addEventListener('hashchange',openLinkedSection);
  openLinkedSection();
})();
