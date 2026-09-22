(() => {
  'use strict';
  const workbench=window.CausentWorkbench;
  let reportEditor=null,reviewEditor=null;
  let onboardingReport=null,onboardingUploads=[],onboardingActions=null,onboardingActionsGoal=null,onboardingActionsEdited=false;
  const $ = (id) => document.getElementById(id);
  const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const icon = (name, extra = '') => `<svg class="icon ${extra}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const signed = (value, digits = 1) => `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(digits)}`;
  const start = Date.UTC(2026, 6, 26);
  const date = (index) => new Date(start + index * 86400000).toLocaleDateString('en-US', {month:'short', day:'numeric', timeZone:'UTC'});
  const fluctuations = [-0.6, -0.3, 0, 0.4, 0.7, 0.1, -0.3];
  let metrics = [
    {id:'activation', name:'Activation rate', symbol:'%', unit:'%', digits:1, weekly:[28.0,29.0,28.8,30.2,31.1,31.8,33.4,34.6], variance:1, source:'Warehouse · product_events', definition:'Workspaces activated within 7 days / eligible new workspaces.', better:'higher'},
    {id:'workspaces', name:'Active workspaces', symbol:'#', unit:'', digits:0, weekly:[184,191,197,206,217,228,236,251], variance:10, source:'Warehouse · workspace_activity', definition:'Distinct workspaces with a qualifying activity each day.', better:'higher'},
    {id:'setup', name:'Setup time', symbol:'m', unit:' min', digits:1, weekly:[10.5,10.2,9.7,9.3,8.8,8.5,7.9,7.5], variance:0.6, source:'Warehouse · setup_sessions', definition:'Median minutes from setup start to the first useful result.', better:'lower'},
    {id:'support', name:'Setup tickets', symbol:'#', unit:'', digits:0, weekly:[38,37,35,36,33,31,29,27], variance:10, source:'CSV · setup_tickets.csv', definition:'Daily count of support requests tagged as setup-related.', better:'lower'},
  ].map((metric) => {
    const values = metric.weekly.flatMap((level) => fluctuations.map((offset) => Number((level + offset * metric.variance).toFixed(2))));
    const observations=values.map((value,index)=>({date:new Date(start+index*86400000).toISOString().slice(0,10),value}));
    return {...metric,sample:true,observations, values, latest:values.at(-1), l7:mean(values.slice(-7)), l28:mean(values.slice(-28)), wow:(mean(values.slice(-7))/mean(values.slice(-14,-7))-1)*100};
  });
  const format = workbench.format;
  let reports = [
    {id:'first-session', title:'Make the first five minutes simpler.', overview:'New teams should reach a useful workspace before they have to configure one. Today, optional settings interrupt the first session and make the product feel harder to start than it needs to be.', decision:'Show a starter workspace immediately after one goal question. Move optional configuration into the workspace, where each setting has a clear purpose.', implementation:'Trim the setup flow, introduce a ready-to-use starter workspace, and instrument the first-session milestones. Review the experience with new teams before expanding the rollout.', measurement:'Track activation rate as the primary outcome, with setup time and support tickets as guardrails. Record actual exposure separately from completed pull requests. Review the rollout as a whole; changes cannot be attributed to individual tasks.'},
    {id:'starter', title:'A starter workspace for every new team.', overview:'A blank workspace makes the next step difficult to see. A small, relevant example can show new teams what useful work looks like.', decision:'Offer one editable starter workspace based on the goal selected during setup. Let teams replace the example with their own data when they are ready.', implementation:'Prepare a small set of sample tasks and a report, then check that every sample object can be replaced or removed. Keep example content clearly labeled.', measurement:'Compare first-session completion and the time to the first useful result. Check support demand before drawing a conclusion about the rollout.'},
    {id:'support-report', title:'Reduce avoidable setup questions.', overview:'New teams often ask about optional fields before they have seen a result. Those questions signal friction at the wrong point in the workflow.', decision:'Ask for optional details only when they become necessary. Keep brief, contextual explanations beside the fields that remain.', implementation:'Review the most common setup questions, simplify the matching fields, and test the copy in the starter workspace.', measurement:'Monitor setup tickets alongside activation. A reduction in tickets alone does not establish that setup became easier.'},
  ];
  let actions = [
    {id:1,title:'Trim the setup flow',owner:'Design & Engineering',status:'Completed',security:'Standard',harness:'Codex',date:'Sep 9',day:45,pr:41,summary:'Keep the goal question and remove optional setup steps from the first session.',checks:['New teams can reach a workspace after one goal question.','Optional settings remain available inside the workspace.','Existing teams keep their configuration.'],instructions:'Simplify the first-session setup flow. Keep one goal question and move optional settings into the workspace. Preserve existing accounts and configuration. Test the new-team path and the returning-team path. Submit the change for review; do not deploy.'},
    {id:2,title:'Add a starter workspace',owner:'Product & Engineering',status:'Completed',security:'Standard',harness:'Codex',date:'Sep 12',day:48,pr:44,summary:'Give new teams an editable starting point with a small report and a clear next action.',checks:['Sample content is visibly labeled.','Every sample object can be replaced.','The empty-workspace path remains available.'],instructions:'Build an editable starter workspace for the selected setup goal. Include a short sample report and a small action list. Label synthetic content, preserve user edits, and retain the empty-workspace option. Verify creation, editing, and removal. Submit for review.'},
    {id:3,title:'Instrument activation milestones',owner:'Engineering',status:'In progress',security:'Elevated',harness:'Codex',date:null,summary:'Capture the agreed first-use events without collecting report content or free text.',checks:['Event names and eligibility rules are explicit.','Retries do not create duplicate events.','Report text and customer content are excluded.'],instructions:'Instrument setup start, first useful result, and activation using the agreed eligibility rules. Keep events idempotent and scoped to the correct workspace. Exclude free text and report content. Add focused checks for duplicate events and workspace isolation. Require security review before release.'},
    {id:4,title:'Review the first-session experience',owner:'Design',status:'Planned',security:'Standard',harness:'Browser',date:null,summary:'Walk through the complete first session on desktop and phone, including recovery from mistakes.',checks:['The next action is clear at every step.','Keyboard and phone flows remain usable.','Errors explain how to recover.'],instructions:'Review the first-session flow in the browser on desktop and phone. Check keyboard navigation, readable labels, empty states, and error recovery. Record issues with steps to reproduce and screenshots. Do not modify customer data or mark the rollout successful.'},
  ];
  actions.forEach((action,index)=>{action.samplePr=action.pr;action.prUrl='';action.completedOn=action.pr?new Date(start+action.day*86400000).toISOString().slice(0,10):'';action.aiBudget={inputTokens:[40000,80000,60000,20000][index],outputTokens:[12000,24000,18000,6000][index],inputRate:5,outputRate:25,passes:2};});
  const metricCatalog=[...metrics];
  reports.forEach(report=>{workbench.prepareReport(report);report.coreMetricIds=metrics.map(metric=>metric.id);report.charts=[{id:'activation-chart',after:'decision',metricId:metrics[0].id,type:'line',title:'Activation rate'}];});
  const projects = [{id:'first-session',name:'First session',goal:'Help new teams reach their first useful result sooner. Simplify setup, provide a starter workspace, and check that activation improves without increasing support demand.',sample:true,metrics,reports,actions}];
  const onboardingExamples = [
  {
    "id": "gummy-alpha",
    "name": "Gummy Alpha",
    "prompt": "Deploy an AI shopping assistant on the Gummy Alpha website. The product mixer already exists, but customers abandon it while combining flavors. They also ask where to find the mixer and commonly choose only one flavor. Mixed-box unit purchases increased 25% quarter over quarter. The assistant should recommend valid combinations, explain how they taste, clarify product rules, and help shoppers complete the mixer. Gummy Alpha offers strawberry, orange, vanilla, chocolate, blueberry, and hazelnut in spheres, squares, stars, and puppy-face shapes. Each gummy may use one or two flavors. Orders are $15 per pound with a one-pound minimum.",
    "overview": "Shoppers abandon the existing flavor mixer and often choose only one flavor. Help them find the mixer, understand valid combinations, and complete an order.",
    "decision": "Try contextual AI guidance in the existing mixer, with recommendations limited to valid combinations and the stated product rules.",
    "implementation": "Confirm the product rules, instrument mixer milestones, and stage a small guided experience. Review recommendations and the unassisted path before rollout.",
    "measurement": "Track mixer completion and mixed-box purchases, with invalid combinations and support requests as guardrails. Establish a baseline and record actual exposure before interpreting changes."
  },
  {
    "id": "northstar",
    "name": "Support Operations",
    "prompt": "Launch an in-product support assistant for Northstar's workspace setup flow. New self-serve customers open repeated tickets about inviting teammates, configuring permissions, and connecting their first data source. Setup-related tickets represent 31% of first-week support volume, median time to first connected source is 4.2 days, and first-week setup completion is currently 40%. The approved success target is 55% first-week setup completion. Maya Chen, Analytics Lead, will instrument setup starts, milestones, completions, and support handoffs. Jonah Patel, Support Lead, will curate the approved setup knowledge and review escalation rules. Priya Rao, Product Engineering Lead, will build and stage the assistant. The assistant must answer only from approved setup documentation, link users to the exact settings page, and hand uncertain requests to support. Start with new self-serve accounts. Elena Brooks, Security Lead, and Jonah must approve the knowledge sources before launch. Treat setup documentation as organization data and never expose customer workspace content to the assistant.",
    "overview": "New teams repeatedly ask about teammate invitations, permissions, and their first data source. Make setup guidance available at the point of need.",
    "decision": "Try an in-product assistant that answers from approved setup documentation and hands uncertain requests to support.",
    "implementation": "Instrument setup milestones, curate approved knowledge, and stage the assistant for new self-serve teams. Complete the security and support reviews before launch.",
    "measurement": "Track first-week setup completion, time to the first connected source, and support handoffs. Confirm the brief’s baseline and target, then register the measurement plan before exposure."
  }
];
  const state = {project:projects[0],onboardingReturn:'projects',brief:null,exampleId:null,tab:'reports',report:reports[0],metric:metrics[0],drawer:false,assistant:false,model:'causal',preview:null,toastTimer:null,newCount:0,focusTarget:null};
  function toast(message) { clearTimeout(state.toastTimer); $('toast').textContent=message; $('toast').hidden=false; state.toastTimer=setTimeout(()=>$('toast').hidden=true,3500); }

  function lineChart(metric, {flags=false, expected=false, beforeAfter=false, compact=false} = {}) {
    if(!metric.weekly)return workbench.chartSVG(metric);
    const width=760, height=compact?185:225, left=44, right=20, top=flags?45:25, bottom=30;
    const values=beforeAfter?metric.values.slice(-14):metric.values, first=beforeAfter?42:0;
    const min=Math.floor(Math.min(...values)*0.88), max=Math.ceil(Math.max(...values)*1.09);
    const x=(i)=>left+i*(width-left-right)/(values.length-1), y=(v)=>height-bottom-(v-min)/(max-min)*(height-top-bottom);
    const points=values.map((v,i)=>`${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    const grid=[0,.5,1].map((step)=>{const value=min+(max-min)*step;return `<line class="axis" x1="${left}" x2="${width-right}" y1="${y(value)}" y2="${y(value)}"/><text x="${left-10}" y="${y(value)+4}" text-anchor="end">${value.toFixed(metric.digits)}${metric.unit==='%'?'%':''}</text>`;}).join('');
    const dates=(beforeAfter?[0,3,6,9,13]:[0,14,28,42,55]).map((i)=>`<text x="${x(i)}" y="${height-6}" text-anchor="${i===0?'start':i===values.length-1?'end':'middle'}">${date(i+first)}</text>`).join('');
    const markers=flags?actions.filter(a=>a.pr&&a.status==='Completed'&&a.day>=0&&a.day<metric.values.length).map((action,i)=>`<line class="event-line" x1="${x(action.day)}" x2="${x(action.day)}" y1="${top-6}" y2="${height-bottom}"/><rect x="${x(action.day)-(i?0:68)}" y="${i?24:3}" width="68" height="20" rx="4" fill="#e6effd"/><text class="pr-label" x="${x(action.day)+(i?34:-34)}" y="${i?38:17}" text-anchor="middle">PR #${action.pr}</text><circle cx="${x(action.day)}" cy="${y(metric.values[action.day])}" r="4" fill="#377ded"><title>${escape(action.title)} completed ${action.date}; not exposure</title></circle>`).join(''):'';
    const expectedLine=expected?`<polyline class="expected-line" points="${metric.values.map((v,i)=>`${x(i)},${y(i<42?v:31.8+(i-42)*.045)}`).join(' ')}"/>`:'';
    const bands=beforeAfter?`<rect x="${x(0)}" y="${top}" width="${x(6.5)-x(0)}" height="${height-top-bottom}" fill="#e8edf5"/><rect x="${x(6.5)}" y="${top}" width="${x(13)-x(6.5)}" height="${height-top-bottom}" fill="#dbe9ff"/><text x="${x(3)}" y="14" text-anchor="middle">Before</text><text x="${x(10)}" y="14" text-anchor="middle">After</text>`:'';
    return `<svg class="timeline" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escape(metric.name)} sample daily timeline${flags?', with completed PR markers':''}${beforeAfter?', highlighting two seven-day windows':''}"><title>${escape(metric.name)} · synthetic daily observations, ${date(first)} to Sep 19, 2026</title>${bands}${grid}${expectedLine}<polyline class="observed" points="${points.join(' ')}"/>${markers}${dates}</svg>`;
  }
  function barChart(metric) {
    if(!metric.weekly)return workbench.chartSVG(metric,'bar');
    const width=760,height=210,left=42,right=15,top=30,bottom=34,max=Math.max(...metric.weekly)*1.28;
    const plotHeight=height-top-bottom, step=(width-left-right)/8;
    const grid=[0,.5,1].map((n)=>`<line class="axis" x1="${left}" x2="${width-right}" y1="${height-bottom-n*plotHeight}" y2="${height-bottom-n*plotHeight}"/><text x="${left-10}" y="${height-bottom-n*plotHeight+4}" text-anchor="end">${(max*n).toFixed(metric.digits)}</text>`).join('');
    const bars=metric.weekly.map((value,i)=>{const h=value/max*plotHeight,x=left+i*step+step*.2,w=step*.6,y=height-bottom-h,delta=i?((value/metric.weekly[i-1]-1)*100):null;return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${i===7?'#377ded':'#bad0f4'}"><title>Week ending ${date(i*7+6)}: ${format(metric,value)}${delta===null?'':`, ${signed(delta)}% WoW`}</title></rect><text x="${x+w/2}" y="${y-9}" text-anchor="middle">${delta===null?'—':signed(delta)+'%'}</text><text x="${x+w/2}" y="${height-11}" text-anchor="middle">${date(i*7+6)}</text>`;}).join('');
    return `<svg class="bar-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escape(metric.name)} weekly average bars with week-over-week percent change above each bar">${grid}${bars}</svg>`;
  }
  function sparkline(metric) {
    const values=metric.weekly||metric.values.slice(-14),min=Math.min(...values),max=Math.max(...values);
    return `<svg viewBox="0 0 64 24" aria-hidden="true"><polyline points="${values.map((v,i)=>`${i*63/Math.max(values.length-1,1)},${22-(v-min)/Math.max(max-min,1)*18}`).join(' ')}"/></svg>`;
  }
  function renderData() {
    $('metric-table-wrap').hidden=!metrics.length;$('data-empty').hidden=!!metrics.length;
    $('metric-rows').innerHTML=metrics.map(metric=>`<tr data-metric-row="${metric.id}"><td><button class="metric-name" data-metric="${metric.id}" aria-label="Explore ${escape(metric.name)}">${escape(metric.name)}</button></td><td>${format(metric,metric.latest)}</td><td>${format(metric,metric.l28)}</td><td><span class="trend">${sparkline(metric)}${metric.wow===null?'—':signed(metric.wow)+'%'}</span></td><td class="date-range">${metric.observations[0].date} – ${metric.observations.at(-1).date}</td></tr>`).join('');
  }
  function renderLibrary() {
    $('report-library').innerHTML=reports.map(report=>`<button data-report="${report.id}"${state.report.id===report.id?' aria-current="true"':''}>${escape(report.title)}</button>`).join('');
    renderProjects();
  }
  function outline(sections) {
    $('report-outline').innerHTML=sections.map(section=>`<a href="#${section.id}">${escape(section.title)}</a>`).join('');
  }
  function reportChanged(){renderLibrary();renderDrawer();renderImpact();}
  function renderReport() {
    reportEditor?.destroy();$('report-title').textContent=state.report.title;
    renderEvidence('report',state.report.sources||[]);
    reportEditor=new workbench.DocumentWorkbench($('report-editor'),state.report,{getMetrics:()=>metrics,onChange:reportChanged,onOutline:outline,onAddMetric:after=>addMetric('report',after)});
    renderLibrary();renderDrawer();
  }
  function ensureOnboardingReport(){return onboardingReport??=workbench.prepareReport({id:'onboarding-draft',title:'Project brief'});}
  function renderReview(){
    renderActionList('review-action-list',onboardingActions||[]);updateReviewCount();
    reviewEditor?.destroy();reviewEditor=new workbench.DocumentWorkbench($('review-editor'),ensureOnboardingReport(),{getMetrics:()=>metricCatalog,onAddMetric:after=>addMetric('onboarding',after)});
  }
  function addMetric(context=state.tab==='onboarding'?'onboarding':'report',after) {
    closePopovers();
    workbench.openMetricDialog({onAdd:metric=>{
      metricCatalog.push(metric);
      if(context==='onboarding'){
        const report=ensureOnboardingReport();report.coreMetricIds.push(metric.id);onboardingUploads.push(metric.id);
        $('brief-metric-count').textContent=`${report.coreMetricIds.length} selected`;reviewEditor?.refreshMetrics();
      }else{
        metrics.push(metric);state.metric=metric;state.report.coreMetricIds.push(metric.id);renderData();reportEditor?.refreshMetrics();renderDrawer();renderImpact();
      }
      toast('Metric imported.');if(after)queueMicrotask(after);
    }});
  }
  function githubPR(value) {
    try {const url=new URL(value);if(url.protocol!=='https:'||url.hostname!=='github.com'||url.port||url.username||url.password)return null;const match=url.pathname.match(/^\/[a-z0-9_.-]+\/[a-z0-9_.-]+\/pull\/([1-9]\d*)\/?$/i);return match?{url:url.href,number:match[1]}:null;}catch{return null;}
  }
  function actionReference(action) {
    const pr=githubPR(action.prUrl);
    return pr?`<a href="${escape(pr.url)}" target="_blank" rel="noopener noreferrer">Open PR #${pr.number} ↗</a>`:action.prUrl?'Enter a GitHub pull request URL.':action.samplePr?`Sample PR #${action.samplePr} · No linked repository`:'No linked PR';
  }
  function newAction(id,title='New action',summary='',owner='Unassigned',harness='Codex') {
    return {id,title,summary,owner,harness,status:'Planned',security:'Standard',completedOn:'',date:null,day:null,pr:null,prUrl:'',checks:[],instructions:summary,aiBudget:{inputTokens:60000,outputTokens:18000,inputRate:5,outputRate:25,passes:2}};
  }
  function draftActions(example,report) {
    const plans=example?.id==='gummy-alpha'?[
      ['Confirm mixer rules','Document valid flavors, shapes, combinations, pricing, and minimum order rules.','Product','Codex'],
      ['Build mixer guidance','Stage guidance in the existing mixer. Keep recommendations within the confirmed product rules.','Engineering','Codex'],
      ['Verify the shopping flow','Check valid and invalid combinations, the unassisted path, mobile checkout, and support handoff.','Design & QA','Browser']
    ]:example?.id==='northstar'?[
      ['Instrument setup milestones','Capture setup starts, milestones, completions, and support handoffs without collecting workspace content.','Maya Chen','Codex'],
      ['Approve setup knowledge','Curate setup documentation and escalation rules. Obtain security and support approval before launch.','Jonah Patel & Elena Brooks','Manual'],
      ['Build the setup assistant','Stage guidance for new self-serve teams using approved documentation, exact settings links, and support handoff.','Priya Rao','Codex'],
      ['Verify the setup experience','Check workspace isolation, uncertain requests, settings links, and the returning-customer path.','Product & QA','Browser']
    ]:[
      ['Define the first change',report.decision,'Product','Codex'],
      ['Build the first change',report.implementation,'Engineering','Codex'],
      ['Verify the experience',report.measurement,'Design & QA','Browser']
    ];
    return plans.map(([title,summary,owner,harness],index)=>({...newAction(index+1,title,summary,owner,harness),checks:['Confirm the scope and acceptance criteria before starting.','Record the review and verification results.']}));
  }
  function updateReviewCount(){const items=onboardingActions||[],changed=onboardingActionsGoal&&state.brief?.goal!==onboardingActionsGoal;$('review-action-count').textContent=`${items.length} draft action${items.length===1?'':'s'} · ${changed?'Review against the updated brief':'Review before starting'}`;}
  function completed(action){return action.status==='Completed';}
  function aiCostLabel(action){
    if(action.harness==='Manual')return 'No AI';
    const cost=workbench.estimateAICost(action.aiBudget);return cost?`$${cost.minimum.toFixed(2)}–$${cost.maximum.toFixed(2)}`:'—';
  }
  function actionOptions(values,current){return values.map(value=>`<option${current===value?' selected':''}>${value}</option>`).join('');}
  function renderActions() {
    $('actions-title').textContent=state.project.name+': Implementation Plan';
    $('action-count').textContent=actions.length?`${actions.filter(completed).length} of ${actions.length} completed`:'0 actions';
    $('action-footnote').hidden=!actions.length;
    if(!actions.length){$('action-list').innerHTML='<div class="empty-state"><h2>From brief to plan.</h2><p>Review your first step in Reports. No actions have been created yet.</p></div>';return;}
    renderActionList('action-list',actions);
  }
  function renderActionList(listId,items) {
    const review=listId==='review-action-list';
    $(listId).innerHTML=items.map(action=>`<details class="action" id="${review?'review-':''}action-${action.id}" data-action="${action.id}"><summary><span class="action-indicator ${completed(action)?'done':''}">${completed(action)?icon('check'):String(action.id).padStart(2,'0')}</span><span class="action-title"><strong>${escape(action.title)}</strong><span class="action-tags"><span class="tag security-tag">${escape(action.security)} security</span><span class="tag harness" title="Recommended harness">${escape(action.harness)}</span><span class="tag owner-tag">${escape(action.owner)}</span><span class="tag ai-cost" title="Illustrative AI usage estimate; edit the assumptions below">${action.harness==='Manual'?'No AI':'AI '+aiCostLabel(action)}</span></span></span><span class="status ${completed(action)?'done':''}">${action.status}</span>${icon('chevron','action-chevron')}</summary>
      <div class="action-detail"><div class="action-form form-grid">
      <label class="full-field">Title<input data-edit="title" aria-label="Action title" value="${escape(action.title)}" maxlength="160"></label>
      <label>Owner<input data-edit="owner" aria-label="Owner" value="${escape(action.owner)}" maxlength="100"></label>
      <label>Status<select data-edit="status" aria-label="Status">${actionOptions(['Planned','In progress','Completed'],action.status)}</select></label>
      <label>Recommended harness<select data-edit="harness" aria-label="Recommended harness">${actionOptions(['Codex','Claude Code','Cursor','Browser','Manual'],action.harness)}</select></label>
      <label>Security<select data-edit="security" aria-label="Security">${actionOptions(['Standard','Elevated'],action.security)}</select></label>
      <label>Completed<input type="date" data-edit="completedOn" aria-label="Completion date" value="${action.completedOn||''}"></label>
      <label>GitHub PR<input type="url" data-edit="prUrl" aria-label="GitHub PR URL" value="${escape(action.prUrl||'')}" placeholder="https://github.com/owner/repo/pull/123"></label><div class="action-reference full-field">${actionReference(action)}</div></div>
      <label class="block-label">Summary<textarea data-edit="summary" aria-label="Action summary" rows="3">${escape(action.summary)}</textarea></label>
      <label class="block-label">Acceptance<textarea data-edit="checks" aria-label="Acceptance criteria" rows="3">${escape(action.checks.join('\n'))}</textarea></label>
      <div class="instructions"><div class="instructions-top"><strong>Instructions</strong><button class="button copy-button" data-copy="${action.id}" aria-label="Copy instructions for ${escape(action.title)}">${icon('copy')}Copy</button></div><textarea id="${review?'review-':''}instructions-${action.id}" data-edit="instructions" aria-label="Action instructions" rows="5">${escape(action.instructions)}</textarea></div>
      <details class="ai-budget"><summary><span>Estimated AI cost</span><strong>${aiCostLabel(action)}</strong></summary><p class="small-help">Illustrative usage, not a quote. Replace the example rates with your model’s rates. Subscription charges and engineering time are excluded.</p><div class="form-grid">
      ${[['inputTokens','Input tokens'],['outputTokens','Output tokens'],['inputRate','Input $ / 1M'],['outputRate','Output $ / 1M'],['passes','Max passes']].map(([key,label])=>`<label>${label}<input type="number" min="${key==='passes'?1:0}" step="${key.includes('Rate')?'any':1}" data-budget="${key}" aria-label="${label}" value="${action.aiBudget[key]}"></label>`).join('')}</div><p class="small-help">One pass to the chosen maximum, at the same token budget per pass.</p></details>${review?`<button type="button" class="text-button remove-action" data-remove="${action.id}" aria-label="Remove action ${escape(action.title)}">Remove action</button>`:''}</div></details>`).join('');
  }
  function updateActionSummary(action,row,review){
    window.CausentD?.syncAction(action);
    row.querySelector('.action-reference').innerHTML=actionReference(action);row.querySelector('.action-title strong').textContent=action.title||'Untitled action';row.querySelector('.owner-tag').textContent=action.owner||'Unassigned';row.querySelector('.harness').textContent=action.harness;row.querySelector('.security-tag').textContent=action.security+' security';row.querySelector('.ai-cost').textContent=action.harness==='Manual'?'No AI':'AI '+aiCostLabel(action);row.querySelector('.ai-budget summary strong').textContent=aiCostLabel(action);
    const status=row.querySelector('.status');status.textContent=action.status;status.classList.toggle('done',completed(action));const indicator=row.querySelector('.action-indicator');indicator.classList.toggle('done',completed(action));indicator.innerHTML=completed(action)?icon('check'):String(action.id).padStart(2,'0');
    const copy=row.querySelector('[data-copy]');copy.setAttribute('aria-label','Copy instructions for '+(action.title||'Untitled action'));
    row.querySelector('[data-remove]')?.setAttribute('aria-label','Remove action '+(action.title||'Untitled action'));
    if(review){updateReviewCount();return;}
    $('action-count').textContent=`${actions.filter(completed).length} of ${actions.length} completed`;renderImpact();renderDrawer();
  }
  function usesSampleImpact(){return state.project.id==='first-session'&&(state.report.estimate?.metricId||state.report.coreMetricIds[0]||metrics[0]?.id)==='activation';}
  function renderImpact() {
    const primary=metrics.find(m=>m.id===state.report.estimate?.metricId)||metrics.find(m=>state.report.coreMetricIds.includes(m.id))||metrics[0];
    const sampleReadout=state.project.id==='first-session'&&primary?.id==='activation';
    $('impact-subtitle').textContent=state.project.name+(primary?' · '+primary.name:'');
    $('impact-empty').hidden=!!metrics.length; $('impact-results').hidden=!metrics.length; $('model-picker').hidden=!metrics.length||!sampleReadout;
    if(!metrics.length)return;
    $('impact-table-body').closest('.table-scroll').hidden=!actions.length;
    if(!sampleReadout){
      const metric=primary;
      const estimate=state.report.estimate,target=estimate&&estimate.metricId===metric.id?(estimate.mode==='points'?metric.latest+estimate.change:metric.latest*(1+estimate.change/100)):null;
      $('impact-tiles').innerHTML=[['Latest',format(metric,metric.latest)],['L7 Avg',format(metric,metric.l7)],['Target',format(metric,target)],['Readout','Pending']].map(([label,value])=>`<section class="hero-tile"><span class="label">${label}</span><strong>${value}</strong></section>`).join('');
      $('impact-chart-title').textContent=metric.name;$('impact-period').textContent=metric.observations[0].date+' – '+metric.observations.at(-1).date;
      $('impact-chart').innerHTML=workbench.chartSVG(metric);$('expected-legend').hidden=true;
      $('impact-note').textContent=(metric.sample?'Sample observations. ':'Imported observations. ')+(estimate?'Target is your estimate, not a measured effect.':'No impact estimate yet.');
      $('action-result-scope').textContent=actions.length?'No measured action effects':'No completed actions';
      $('impact-table-head').innerHTML='<tr><th>Action</th><th>Completed</th><th>Status</th></tr>';
      $('impact-table-body').innerHTML=actions.map(action=>`<tr><td>${escape(action.title)}</td><td>${completed(action)?action.date||'—':'—'}</td><td>${action.status}</td></tr>`).join('');return;
    }
    const metric=primary, before=mean(metric.values.slice(-14,-7)), after=metric.l7;
    const causal=state.model==='causal';
    const tiles=causal?[
      ['Estimated lift','+2.1 pp','Synthetic model estimate'],['95% interval','−0.8 to +5.0','Percentage points'],['Readout','Inconclusive','Interval includes no change'],['Actions complete',`${actions.filter(completed).length} / ${actions.length}`,'Completion ≠ exposure']
    ]:[['Before · L7',format(metric,before),'Sep 6 – Sep 12'],['After · L7',format(metric,after),'Sep 13 – Sep 19'],['Change',signed(after-before)+' pp',signed((after/before-1)*100)+'% relative'],['Actions complete',`${actions.filter(completed).length} / ${actions.length}`,'Completion ≠ exposure']];
    $('impact-tiles').innerHTML=tiles.map(([label,value,note])=>`<section class="hero-tile"><span class="label">${label}</span><strong${value.length>9?' class="text-value"':''}>${value}</strong><small>${note}</small></section>`).join('');
    $('impact-chart-title').textContent=causal?'Observed & expected':'Before / after · 7 days';
    $('impact-period').textContent=causal?'Activation rate · Jul 26 – Sep 19':'Activation rate · Sep 6 – Sep 19';
    $('impact-chart').innerHTML=lineChart(metric,{expected:causal,beforeAfter:!causal});
    $('expected-legend').hidden=!causal;
    $('impact-note').textContent=causal?'Synthetic model output, not a fitted result. A production causal readout requires sufficient history and a valid measurement plan.':'Two adjacent 7-day averages from the sample series. This is a descriptive comparison, not a causal estimate.';
    $('action-result-scope').textContent=causal?'Shared rollout · no individual attribution':'7 days before / after each completion';
    $('impact-table-head').innerHTML=`<tr><th scope="col">Action</th><th scope="col">Completed</th><th scope="col">${causal?'Individual lift':'7d change'}</th><th scope="col">Result</th></tr>`;
    $('impact-table-body').innerHTML=actions.map(action=>{
      const enough=completed(action)&&Number.isFinite(action.day)&&action.day>=7&&action.day+7<metric.values.length;
      const change=enough?mean(metric.values.slice(action.day+1,action.day+8))-mean(metric.values.slice(action.day-7,action.day)):null;
      return `<tr><td>${escape(action.title)}</td><td>${completed(action)?action.date||'—':'—'}</td><td>${!causal&&change!==null?signed(change)+' pp':'—'}</td><td>${causal?(completed(action)?'Not attributable':action.status):(change!==null?'Descriptive only':completed(action)?'Awaiting 7 days':action.status)}</td></tr>`;
    }).join('');
  }
  function renderDrawer() {
    const detail=state.tab==='data',core=metrics.filter(m=>state.report.coreMetricIds.includes(m.id));
    const metric=detail?state.metric:(core.find(m=>m.id===state.metric?.id)||core[0]||null);
    if(metric)state.metric=metric;
    $('drawer-content').classList.toggle('empty',!metric);
    $('drawer-content').querySelector('.drawer-chart').hidden=!metric;
    $('drawer-panel').hidden=!state.drawer;
    $('drawer-toggle').setAttribute('aria-expanded',String(state.drawer));
    if(!metric) {
      $('drawer').classList.remove('data-detail'); $('drawer').setAttribute('aria-label','Core Metrics');
      $('drawer-label').textContent='Core Metrics'; $('drawer-count').textContent='0 metrics'; $('drawer-hint').textContent='Add your first metric';
      $('drawer-metric-tabs').hidden=true; $('drawer-metric-tabs').replaceChildren();
      $('metric-summary').innerHTML='<p class="metric-definition">Select core metrics in Reports, or add a metric from Data.</p>';
      $('drawer-chart').replaceChildren(); return;
    }
    $('drawer').classList.toggle('data-detail',detail);
    $('drawer').setAttribute('aria-label',detail?'Metric details':'Core Metrics');
    $('drawer-label').textContent=detail?metric.name:'Core Metrics';
    $('drawer-count').textContent=detail?'Metric details':`${core.length} metrics`;
    $('drawer-hint').textContent=detail?(metric.weekly?'Weekly averages · WoW change':'Daily observations'):state.tab==='actions'?'PR flags mark completion, not exposure':'Project timeline';
    $('drawer-metric-tabs').hidden=detail;
    $('drawer-metric-tabs').innerHTML=core.map(m=>`<button data-metric="${m.id}" aria-pressed="${m.id===metric.id}">${escape(m.name)}</button>`).join('');
    $('metric-summary').innerHTML=`<h3>${escape(metric.name)}</h3><dl><dt>Latest</dt><dd>${format(metric,metric.latest)}</dd><dt>L7 Avg</dt><dd>${format(metric,metric.l7)}</dd><dt>L28 Avg</dt><dd>${format(metric,metric.l28)}</dd></dl>${detail?`<div class="source-row"><small>Source</small><span class="muted">${escape(metric.source)}</span><small>${metric.sample?'Sample':'Latest'} · ${metric.observations.at(-1).date}</small><button class="button" id="reconnect-source">Reconnect</button></div>`:''}<p class="metric-definition">${escape(metric.definition)}</p>`;
    $('drawer-chart-title').textContent=detail?(metric.weekly?'Weekly history':'Daily history'):metric.name;
    $('drawer-chart-subtitle').textContent=detail&&metric.sample?'WoW % above bars · weekly mean':'Daily · '+metric.observations[0].date+' – '+metric.observations.at(-1).date;
    $('drawer-chart').innerHTML=detail?barChart(metric):lineChart(metric,{flags:state.tab==='actions',compact:true});
    $('drawer-panel').hidden=!state.drawer;
    $('drawer-toggle').setAttribute('aria-expanded',String(state.drawer));
    document.querySelectorAll('[data-metric-row]').forEach(row=>row.classList.toggle('selected',detail&&state.drawer&&row.dataset.metricRow===metric.id));
  }
  function setDrawer(open) { state.drawer=open; renderDrawer(); }
  function selectMetric(id) { const metric=metrics.find(m=>m.id===id); if(!metric)return; state.metric=metric;setDrawer(true); if(state.tab!=='data')$('drawer-metric-tabs').querySelector('[aria-pressed="true"]').focus(); if(state.assistant)updateAIContext(); }
  function closePopovers() {
    for(const id of ['create','profile']) {$(id+'-menu').hidden=true;$(id+'-button').setAttribute('aria-expanded','false');}
  }
  function switchTab(tab) {
    if(!['data','reports','actions','impact','graph','projects','onboarding'].includes(tab))return;
    if(tab==='graph')closeAI();
    state.tab=tab;closePopovers();
    $('preview-note').textContent='Proposal D · '+(tab==='onboarding'?'Local preview':state.project.sample?'Sample data':'Local project')+' · Edits stay until reload';
    document.querySelectorAll('.view').forEach(view=>view.hidden=view.id!=='view-'+tab);
    document.querySelectorAll('[data-tab]').forEach(button=>{const active=button.dataset.tab===tab;button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;});
    if(['projects','onboarding'].includes(tab))$('tab-reports').tabIndex=0;
    $('project-button').setAttribute('aria-expanded',String(tab==='projects'));
    $('drawer').hidden=['projects','onboarding'].includes(tab);
    $('ask-button').hidden=state.assistant||['projects','onboarding'].includes(tab);
    $('page-scroll').scrollTop=0;
    renderDrawer();
    if(state.assistant)updateAIContext();
    if(tab==='impact')renderImpact();
    window.CausentD?.onTab(tab);
  }

  function updateAIContext() {
    const labels={reports:'Report',data:'Metric Library',actions:'Implementation Plan',impact:'Impact',projects:'Projects'};
    $('ask-context').textContent=state.project.name+' · '+labels[state.tab];
    $('ask-heading').textContent={reports:'A little help with your report.',data:'Make sense of your metrics.',actions:'Move the plan forward.',impact:'Understand the result.',projects:'Find your next project.'}[state.tab];
    $('ask-description').textContent={reports:'Draft a paragraph, refine the plan, or explain a metric.',data:'Explore a trend or review how a metric is defined.',actions:'Draft instructions or review the next action.',impact:'Compare the models and their limitations.',projects:'Open a project to start working.'}[state.tab];
    const prompts={reports:['Shorten overview','Draft a report'],data:['Explain this metric','Compare recent weeks'],actions:['Summarize the plan','Review next action'],impact:['Explain this result','Compare models'],projects:[]};
    $('suggested-prompts').innerHTML=prompts[state.tab].map(prompt=>`<button data-prompt="${prompt}">${prompt}</button>`).join('');
    $('ai-preview').hidden=true;state.preview=null;
    $('conversation').replaceChildren();
  }
  function openAI(prompt='') {
    closePopovers();state.focusTarget=document.activeElement;state.assistant=true;
    $('middle').classList.add('ai-open');$('assistant').hidden=false;$('ask-button').hidden=true;
    $('ask-button').setAttribute('aria-expanded','true');updateAIContext();
    $('ask-input').value=prompt;
    // Narrow screens keep the page visible as context without off-screen tab stops.
    $('page-scroll').inert=window.matchMedia('(max-width:650px)').matches;
    $('ask-input').focus();
  }
  function closeAI() {
    state.assistant=false;$('assistant').hidden=true;$('middle').classList.remove('ai-open');
    $('ask-button').hidden=['projects','onboarding'].includes(state.tab);$('ask-button').setAttribute('aria-expanded','false');$('page-scroll').inert=false;
    if(state.focusTarget?.isConnected&&!state.focusTarget.closest('[hidden]'))state.focusTarget.focus();else if(!$('ask-button').hidden)$('ask-button').focus();
  }
  function submitAsk(event) {
    event.preventDefault();const prompt=$('ask-input').value.trim();if(!prompt)return;
    const user=document.createElement('p');user.className='chat-message user';user.textContent=prompt;$('conversation').append(user);
    const response=document.createElement('p');response.className='chat-message';
    if(state.tab==='reports') {
      const draft=/draft|create|write|new report/i.test(prompt);
      const text=state.project.id!=='first-session'?state.project.goal:draft?'Help new teams reach a useful result sooner. Start with one goal question, show an editable starter workspace, and ask for optional settings when they become relevant.':'Show new teams a useful workspace first. Ask for optional settings only when they help the next step.';
      state.preview={reportId:state.report.id,before:state.report.overview,text,draft};
      $('preview-text').textContent=text;$('ai-preview').hidden=false;
      response.textContent='Here is a prepared example for the Overview. Review it before keeping it.';
    } else if(state.tab==='data') {
      const m=state.metric;
      response.textContent=m?`${m.name}: the last 7-day average is ${format(m,m.l7)}, ${m.wow===null?'without enough daily history for a week-over-week comparison':signed(m.wow)+'% versus the previous week'}. ${m.definition} This describes the sample series, not the effect of an action.`:'Start with an outcome, a definition, and a source. Metric creation is a design preview here; no metric or connection has been created.';
    } else if(state.tab==='actions') response.textContent=!actions.length?'Your project brief is ready. Review its first step in Reports before creating an implementation plan. No actions have been generated in this preview.':`${actions.filter(completed).length} of ${actions.length} actions are complete. Expand an action to edit its instructions, acceptance criteria, recommended harness, and AI cost assumptions.`;
    else if(state.tab==='impact') response.textContent=!usesSampleImpact()?'This project has no measured impact result yet. The target is your estimate; imported observations alone do not establish an effect.':!metrics.length?'This project has no observations yet. Add a primary metric and agree on a measurement plan before reviewing impact.':state.model==='causal'?'The sample causal-lift estimate is +2.1 percentage points, with a 95% interval from −0.8 to +5.0. The interval includes zero, so the example is inconclusive. It does not identify individual action effects.':'The sample activation average rises from 33.4% to 34.6% across adjacent 7-day windows: +1.2 percentage points, or +3.6% relative. Before/after describes a change; it does not establish a cause.';
    else response.textContent='Open First session to review its reports, actions, and metrics.';
    $('conversation').append(response);$('ask-input').value='';
    $('ai-preview').scrollIntoView({block:'nearest'});
  }
  function createReport() {
    state.newCount+=1;
    state.report={id:'draft-'+state.newCount,title:'Untitled report',overview:'Describe the decision you want to make, or ask Causent to draft an overview.',decision:'What should change, and why?',implementation:'Outline the actions needed to carry out the decision.',measurement:'Choose the primary outcome and describe how the rollout will be evaluated.',edited:true};
    workbench.prepareReport(state.report);reports.push(state.report);renderReport();switchTab('reports');setDrawer(false);openAI('Draft a report about '+state.project.name+'.');
  }

  function renderProjects() {
    $('project-count').textContent=`${projects.length} project${projects.length===1?'':'s'}`;
    $('project-list').innerHTML=projects.map(project=>`<button class="project-card" data-project="${project.id}"${project.id===state.project.id?' aria-current="true"':''}><span class="folder-mark">${icon('folder')}</span><span><strong>${escape(project.name)}</strong><small>${project.reports.length} report${project.reports.length===1?'':'s'} · ${project.actions.length} actions${project.sample?' · Sample':''}</small></span>${icon('chevron')}</button>`).join('');
  }
  function renderProjectName() {
    $('current-project').textContent=state.project.name;
    $('project-button').title=state.project.name;
    $('actions-title').textContent=state.project.name+': Implementation Plan';
  }
  function activateProject(id) {
    const project=projects.find(project=>project.id===id);if(!project)return;
    window.CausentD?.beforeActivate(project);
    closeAI();state.project=project;reports=project.reports;metrics=project.metrics;actions=project.actions;
    state.report=reports[0];state.metric=metrics[0]||null;state.drawer=false;state.preview=null;
    $('profile-context').textContent='Proposal D · '+(project.sample?'Sample workspace':'Local workspace');
    renderProjectName();
    $('preview-note').textContent='Proposal D · '+(project.sample?'Sample data':'Local project')+' · Edits stay until reload';
    renderData();renderReport();renderActions();renderImpact();switchTab('reports');
  }
  function startProject() {
    if(state.tab!=='onboarding')state.onboardingReturn=state.tab;
    closeAI();setDrawer(false);switchTab('onboarding');
    if($('project-form').hidden)$('project-review-title').focus();else $('project-goal').focus();
    ensureOnboardingReport();
  }
  function showBriefStep(review) {
    $('project-form').hidden=review; $('project-review').hidden=!review;
    $('view-onboarding').setAttribute('aria-labelledby',review?'project-review-title':'onboarding-title');
    $('step-brief').toggleAttribute('aria-current',!review); $('step-review').toggleAttribute('aria-current',review);
    (review?$('step-review'):$('step-brief')).setAttribute('aria-current','step');
    $('page-scroll').scrollTop=0;
    (review?$('project-review-title'):$('onboarding-title')).focus();
  }
  for(const id of ['create-project','new-project'])$(id).addEventListener('click',startProject);
  $('cancel-project').addEventListener('click',()=>{switchTab(state.onboardingReturn);$('create-button').focus();});
  $('back-project').addEventListener('click',()=>showBriefStep(false));
  function renderEvidence(prefix,sources) {
    $(prefix+'-evidence').hidden=!sources.length;
    $(prefix+'-evidence-list').textContent=sources.join('\n');
  }
  $('onboarding-examples').addEventListener('click',event=>{
    const button=event.target.closest('[data-example]');if(!button)return;
    const example=onboardingExamples.find(example=>example.id===button.dataset.example);if(!example)return;
    state.exampleId=example.id;$('project-goal').value=example.prompt;$('project-name').value=example.name;
    $('project-goal').setCustomValidity('');$('onboarding-error').hidden=true;
    document.querySelectorAll('[data-example]').forEach(option=>option.setAttribute('aria-pressed',String(option===button)));
  });
  $('project-goal').addEventListener('input',()=>{
    $('project-goal').setCustomValidity('');state.exampleId=null;
    document.querySelectorAll('[data-example]').forEach(option=>option.setAttribute('aria-pressed','false'));
  });
  function updateContextCount(){
    const count=Number(!!$('project-source-url').value.trim())+Number(!!$('project-source-pdf').files.length)+Number(!!$('project-source-text').value.trim());
    $('project-context-count').textContent=count?`${count} added`:'';
  }
  function openProjectContext(){if(!$('project-context-dialog').open)$('project-context-dialog').showModal();}
  function validateProjectContext(){
    const url=$('project-source-url').value.trim(),pdf=$('project-source-pdf').files[0];let message='',field=null;
    if(url){try{if(!['http:','https:'].includes(new URL(url).protocol))throw new Error();}catch{message='Enter a website beginning with https:// or http://.';field=$('project-source-url');}}
    if(!message&&pdf&&(pdf.size===0||pdf.size>5*1024*1024||(!/\.pdf$/i.test(pdf.name)&&pdf.type!=='application/pdf'))){message='Choose a non-empty PDF up to 5 MiB, or remove it to continue.';field=$('project-source-pdf');}
    $('project-context-error').textContent=message;$('project-context-error').hidden=!message;
    if(message){openProjectContext();field.focus();return false;}return true;
  }
  $('add-project-context').addEventListener('click',openProjectContext);
  $('close-project-context').addEventListener('click',()=>$('project-context-dialog').close());
  $('project-context-dialog').addEventListener('close',updateContextCount);
  $('done-project-context').addEventListener('click',()=>{if(validateProjectContext())$('project-context-dialog').close();});
  for(const id of ['project-source-url','project-source-text'])$(id).addEventListener('input',()=>{$('project-context-error').hidden=true;});
  $('project-source-pdf').addEventListener('change',()=>{
    $('remove-project-pdf').hidden=!$('project-source-pdf').files.length;$('project-context-error').hidden=true;
  });
  $('remove-project-pdf').addEventListener('click',()=>{
    $('project-source-pdf').value='';$('remove-project-pdf').hidden=true;$('project-context-error').hidden=true;$('project-source-pdf').focus();
  });
  $('project-form').addEventListener('submit',event=>{
    event.preventDefault();const goal=$('project-goal').value.trim();
    const name=$('project-name').value.trim()||goal.split(/\s+/).slice(0,7).join(' ').replace(/[.!?]+$/,'').slice(0,60);
    if(goal.length<20) {$('project-goal').setCustomValidity('Describe the challenge in at least 20 characters.');$('project-goal').reportValidity();return;}
    if(!validateProjectContext())return;
    const pdf=$('project-source-pdf').files[0];
    $('onboarding-error').hidden=true;
    const url=$('project-source-url').value.trim(),sources=[];
    if(url)sources.push('URL · '+url);
    if(pdf)sources.push('PDF · '+pdf.name);
    const context=$('project-source-text').value.trim();if(context)sources.push('Text · '+context);
    if(!state.brief||state.brief.goal!==goal) {
      const example=onboardingExamples.find(example=>example.id===state.exampleId&&example.prompt===goal);
      const previous=ensureOnboardingReport();
      onboardingReport=workbench.prepareReport({...previous,sections:undefined,overview:example?.overview||goal,decision:example?.decision||'Choose the first change after reviewing the current experience and available evidence.',implementation:example?.implementation||'Confirm the current experience and choose one change to try. Turn that change into a small, reviewable implementation plan.',measurement:example?.measurement||'Choose a primary outcome, connect its source, and establish a baseline. Record when the change reaches users before assessing its impact.'});
    }
    if(onboardingActions===null||(!onboardingActionsEdited&&onboardingActionsGoal!==goal)){onboardingActions=draftActions(onboardingExamples.find(example=>example.id===state.exampleId&&example.prompt===goal),ensureOnboardingReport());onboardingActionsGoal=goal;}
    state.brief={name,goal,sources};renderEvidence('review',sources);$('project-review-title').textContent=name;renderReview();showBriefStep(true);
  });
  $('finish-project').addEventListener('click',()=>{
    if(!state.brief)return;
    const {name,goal,sources}=state.brief,id='project-'+(projects.length+1);
    const report={...ensureOnboardingReport(),id:id+'-brief',title:name+': Project brief',sources,edited:true};
    const metricIds=new Set([...report.coreMetricIds,...report.charts.map(chart=>chart.metricId),...onboardingUploads]);
    projects.push({id,name,goal:report.overview||goal,sample:false,metrics:metricCatalog.filter(metric=>metricIds.has(metric.id)),actions:onboardingActions||[],reports:[report]});
    state.brief=null;state.exampleId=null;onboardingReport=null;onboardingUploads=[];onboardingActions=null;onboardingActionsGoal=null;onboardingActionsEdited=false;reviewEditor?.destroy();reviewEditor=null;
    $('project-form').reset();for(const id of ['project-source-url','project-source-pdf','project-source-text'])$(id).value='';updateContextCount();$('remove-project-pdf').hidden=true;$('brief-metric-count').textContent='';
    document.querySelectorAll('[data-example]').forEach(option=>option.setAttribute('aria-pressed','false'));
    showBriefStep(false);activateProject(id);
    $('report-title').focus();toast('Project created locally. Your brief is ready.');
  });

  document.querySelectorAll('[data-tab]').forEach(button=>{
    button.addEventListener('click',()=>switchTab(button.dataset.tab));
    button.addEventListener('keydown',event=>{
      const tabs=[...document.querySelectorAll('[data-tab]')];let i=tabs.indexOf(button);
      if(event.key==='ArrowRight')i=(i+1)%tabs.length;else if(event.key==='ArrowLeft')i=(i+tabs.length-1)%tabs.length;else if(event.key==='Home')i=0;else if(event.key==='End')i=tabs.length-1;else return;
      event.preventDefault();switchTab(tabs[i].dataset.tab);tabs[i].focus();
    });
  });
  $('project-button').addEventListener('click',()=>{closeAI();setDrawer(false);switchTab(state.tab==='projects'?'reports':'projects');});
  $('project-list').addEventListener('click',event=>{const button=event.target.closest('[data-project]');if(button)activateProject(button.dataset.project);});
  for(const id of ['create','profile'])$(id+'-button').addEventListener('click',()=>{const open=$(id+'-menu').hidden;closePopovers();$(id+'-menu').hidden=!open;$(id+'-button').setAttribute('aria-expanded',String(open));});
  document.addEventListener('click',event=>{if(!event.target.closest('.popover-anchor'))closePopovers();});
  $('create-report').addEventListener('click',createReport);
  for(const id of ['create-metric','data-add-metric','add-first-metric','impact-add-metric','brief-add-metric'])$(id).addEventListener('click',()=>addMetric());
  $('metric-rows').addEventListener('click',event=>{const button=event.target.closest('[data-metric]');if(button)selectMetric(button.dataset.metric);});
  $('drawer-metric-tabs').addEventListener('click',event=>{const button=event.target.closest('[data-metric]');if(button)selectMetric(button.dataset.metric);});
  $('drawer-toggle').addEventListener('click',()=>setDrawer(!state.drawer));
  $('metric-summary').addEventListener('click',event=>{if(event.target.closest('#reconnect-source')){$('source-dialog-copy').textContent=`${state.metric.name} uses ${state.metric.source}. In the connected app, this step would let you review and restore that source.`;$('source-dialog').showModal();}});
  for(const id of ['close-source','done-source'])$(id).addEventListener('click',()=>$('source-dialog').close());
  $('report-library').addEventListener('click',event=>{const button=event.target.closest('[data-report]');if(!button)return;state.report=reports.find(report=>report.id===button.dataset.report);renderReport();$('page-scroll').scrollTop=0;if(state.assistant)updateAIContext();});
  $('report-title').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();event.currentTarget.blur();}});
  $('report-title').addEventListener('input',()=>{
    state.report.title=$('report-title').textContent.trim()||'Untitled report';
    state.report.edited=true;state.project.name=state.report.title;
    renderProjectName();renderLibrary();renderImpact();
    if(state.assistant)$('ask-context').textContent=state.project.name+' · Report';
  });
  $('report-title').addEventListener('blur',()=>{if(!$('report-title').textContent.trim())$('report-title').textContent='Untitled report';});
  for(const listId of ['action-list','review-action-list']) {
    const list=$(listId),review=listId==='review-action-list';
    const findAction=field=>(review?onboardingActions:actions)?.find(action=>String(action.id)===field.closest('.action').dataset.action);
    list.addEventListener('input',event=>{
      const field=event.target.closest('[data-edit],[data-budget]');if(!field)return;
      const action=findAction(field);if(!action)return;if(review)onboardingActionsEdited=true;
      if(field.dataset.budget)action.aiBudget[field.dataset.budget]=field.value;
      else if(field.dataset.edit==='checks')action.checks=field.value.split('\n').map(text=>text.trim()).filter(Boolean);
      else {action[field.dataset.edit]=field.value;if(field.dataset.edit==='completedOn'){action.day=field.value?(Date.parse(field.value)-start)/86400000:null;action.date=field.value?new Date(field.value+'T00:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'}):null;}if(field.dataset.edit==='prUrl')action.pr=githubPR(field.value)?.number||action.samplePr||null;}
      updateActionSummary(action,field.closest('.action'),review);
    });
    list.addEventListener('click',async event=>{
      const button=event.target.closest('[data-copy],[data-remove]');if(!button)return;
      const action=findAction(button);if(!action)return;
      if(button.hasAttribute('data-remove')){onboardingActionsEdited=true;onboardingActions=onboardingActions.filter(item=>item!==action);renderActionList(listId,onboardingActions);updateReviewCount();$('add-review-action').focus();return;}
      try {await navigator.clipboard.writeText(`Causent proposal C · Draft task\n${action.title}\nRecommended security: ${action.security}\nRecommended harness: ${action.harness}\nOwner: ${action.owner}\nEstimated AI cost: ${aiCostLabel(action)} (illustrative assumptions)${githubPR(action.prUrl)?'\nGitHub PR: '+action.prUrl:''}\n\n${action.instructions}\n\nAcceptance:\n${action.checks.map(check=>'- '+check).join('\n')}`);toast('Task instructions copied.');}
      catch {button.closest('.action').querySelector('[data-edit="instructions"]').select();toast('Instructions selected. Use your browser’s Copy command.');}
    });
  }
  $('add-review-action').addEventListener('click',()=>{
    onboardingActions??=[];onboardingActionsEdited=true;const id=Math.max(0,...onboardingActions.map(action=>action.id))+1;
    onboardingActions.push(newAction(id));renderActionList('review-action-list',onboardingActions);updateReviewCount();
    const row=$('review-action-'+id);row.open=true;row.querySelector('[data-edit="title"]').focus();
  });
  $('model-select').addEventListener('change',event=>{state.model=event.target.value;renderImpact();if(state.assistant)updateAIContext();});
  $('ask-button').addEventListener('click',()=>openAI());$('close-assistant').addEventListener('click',closeAI);
  $('ask-form').addEventListener('submit',submitAsk);
  $('suggested-prompts').addEventListener('click',event=>{const button=event.target.closest('[data-prompt]');if(button){$('ask-input').value=button.dataset.prompt;$('ask-input').focus();}});
  $('keep-preview').addEventListener('click',()=>{
    const preview=state.preview;if(!preview)return;
    if(state.report.id!==preview.reportId||state.report.overview!==preview.before){toast('The report changed. Request a new preview to keep your edits.');$('ai-preview').hidden=true;state.preview=null;return;}
    reportEditor.setSectionText('overview',preview.text);state.report.overview=preview.text;state.report.edited=true;
    if(preview.draft&&state.report.title==='Untitled report')state.report.title=state.project.id==='first-session'?'A simpler first session.':state.project.name+': Overview';
    renderReport();$('ai-preview').hidden=true;state.preview=null;toast('Overview kept in this local draft.');
  });
  $('discard-preview').addEventListener('click',()=>{$('ai-preview').hidden=true;state.preview=null;toast('Proposed edit discarded.');});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!document.querySelector('dialog[open]')){closePopovers();if(state.drawer){setDrawer(false);$('drawer-toggle').focus();}else if(state.assistant)closeAI();}});
  window.matchMedia('(max-width:650px)').addEventListener('change',event=>{$('page-scroll').inert=state.assistant&&event.matches;});
  window.CausentProposal={get state(){return state;},projects,metricCatalog,workbench,activateProject,switchTab,renderProjects,renderActions,renderReport,renderData,renderImpact,closeAI,toast,refresh:()=>{renderData();renderReport();renderActions();renderImpact();renderProjects();}};
  renderData();renderReport();renderActions();renderImpact();renderDrawer();
})();
