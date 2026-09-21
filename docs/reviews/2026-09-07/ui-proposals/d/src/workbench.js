import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { escape,parseCSV,mapObservations,makeMetric,format,estimateTarget,chartSVG,summarize,estimateAICost } from './metric-data.mjs';
export { parseCSV,mapObservations,makeMetric,format,chartSVG,summarize,estimateAICost };
const textDocument=text=>({type:'doc',content:[{type:'paragraph',...(text?{content:[{type:'text',text}]}:{})}]});
const defaults=[['overview','Overview'],['decision','Decision'],['implementation','Implementation Plan'],['measurement','Measurement']];
export function prepareReport(report) {
  report.sections??=defaults.map(([id,title])=>({id,title,document:textDocument(report[id]||'')}));
  report.charts??=[];report.coreMetricIds??=[];report.estimate??=null;
  return report;
}
const button=(label,content=label,extra='')=>`<button type="button" aria-label="${label}" title="${label}" ${extra}>${content}</button>`;
function modal(title,body) {
  const el=document.createElement('dialog');el.className='workbench-dialog';
  const id='dialog-'+crypto.randomUUID();el.setAttribute('aria-labelledby',id);
  el.innerHTML=`<div class="dialog-heading"><h2 id="${id}">${title}</h2>${button('Close','×','data-close')}</div>${body}`;
  document.body.append(el);el.querySelector('[data-close]').onclick=()=>el.close();el.addEventListener('close',()=>el.remove());el.showModal();return el;
}
const safeLink=value=>{try {const url=new URL(value);return ['http:','https:'].includes(url.protocol)?url.href:null;}catch{return null;}};
export function openMetricDialog({onAdd}) {
  const dialog=modal('Add metric',`<form class="metric-import-form">
    <label class="csv-drop">Upload CSV<input type="file" accept=".csv,text/csv" aria-label="Upload CSV"><span>Drop a file or choose one · up to 1 MiB</span></label>
    <p class="small-help">Daily UTC dates and numeric values. One row per date. <a href="assets/metric-template.csv" download>Template ↓</a></p>
    <details class="paste-csv"><summary>Paste CSV</summary><textarea aria-label="CSV data" rows="5" placeholder="date,value&#10;2026-09-01,32.4"></textarea><button class="button" type="button" data-read>Read data</button></details>
    <div class="mapping-fields" hidden><div class="form-grid"><label>Date column<select data-date aria-label="Date column"></select></label><label>Value column<select data-value aria-label="Value column"></select></label></div><p data-file-status class="small-help"></p></div>
    <div class="form-grid"><label>Metric name<input data-name aria-label="Metric name" required maxlength="120" placeholder="Activation rate"></label><label>Unit<select data-unit aria-label="Unit"><option value="percent">Percent</option><option value="number">Number</option><option value="USD">USD</option><option value="minutes">Minutes</option></select></label>
    <label data-scale-label>Percentage scale<select data-scale aria-label="Percentage scale"><option value="points">0.5 means 0.5%</option><option value="ratio">0.5 means 50%</option></select></label><label>Direction<select data-direction aria-label="Direction"><option value="higher">Higher is better</option><option value="lower">Lower is better</option><option value="neutral">No preference</option></select></label>
    <label>Daily measure<select data-aggregation aria-label="Daily measure"><option value="rate">Rate</option><option value="mean">Average</option><option value="sum">Total</option><option value="snapshot">Snapshot</option></select></label><label>Population<input data-population aria-label="Population" required maxlength="300" placeholder="Eligible new workspaces"></label></div>
    <label class="block-label">Definition<textarea data-definition aria-label="Definition" rows="2" placeholder="Activated within 7 days / eligible new workspaces"></textarea></label>
    <div data-import-preview class="import-preview" hidden></div><p data-error class="form-error" role="alert" hidden></p>
    <div class="dialog-footer"><span class="small-help">Imported in this browser only</span><button class="button" type="button" data-preview>Preview</button><button class="button primary compact-primary" type="submit" data-import disabled>Import</button></div></form>`);
  const q=s=>dialog.querySelector(s);let csv=null,preview=null,version=0,filename='Pasted CSV';
  const showError=error=>{q('[data-error]').textContent=error.message;q('[data-error]').hidden=false;};
  const invalidate=()=>{preview=null;q('[data-import]').disabled=true;q('[data-import-preview]').hidden=true;q('[data-error]').hidden=true;};
  function read(text,source) {
    invalidate();csv=null;q('.mapping-fields').hidden=true;
    try {csv=parseCSV(text);filename=source;
      for(const [selector,match] of [['[data-date]',/date|day/i],['[data-value]',/value|rate|count/i]]){q(selector).innerHTML=csv.headers.map(h=>`<option>${escape(h)}</option>`).join('');q(selector).value=csv.headers.find(h=>match.test(h))||csv.headers[selector==='[data-date]'?0:1]||csv.headers[0];}
      q('.mapping-fields').hidden=false;q('[data-file-status]').textContent=`${source} · ${csv.rows.length} rows`;}
    catch(error){showError(error);}
  }
  async function readFile(file) {
    if(!file)return;const current=++version;invalidate();csv=null;q('.mapping-fields').hidden=true;q('[data-read]').disabled=true;
    try {if(file.size>1048576||file.size===0)throw new Error('Choose a non-empty CSV up to 1 MiB.');const text=await file.text();if(current!==version||!dialog.isConnected)return;read(text,file.name);}
    catch(error){if(current===version&&dialog.isConnected)showError(error);}
    finally{if(current===version&&dialog.isConnected)q('[data-read]').disabled=false;}
  }
  q('input[type=file]').onchange=e=>readFile(e.target.files[0]);
  q('.csv-drop').ondragover=e=>{e.preventDefault();e.currentTarget.classList.add('drag-over');};
  q('.csv-drop').ondragleave=e=>e.currentTarget.classList.remove('drag-over');
  q('.csv-drop').ondrop=e=>{e.preventDefault();e.currentTarget.classList.remove('drag-over');readFile(e.dataTransfer.files[0]);};
  q('[data-read]').onclick=()=>{version++;read(q('textarea[aria-label="CSV data"]').value,'Pasted CSV');};
  q('textarea[aria-label="CSV data"]').oninput=()=>{version++;csv=null;invalidate();q('.mapping-fields').hidden=true;q('[data-read]').disabled=false;};
  q('form').addEventListener('input',e=>{if(e.target.type!=='file')invalidate();});
  q('[data-unit]').onchange=()=>{q('[data-scale-label]').hidden=q('[data-unit]').value!=='percent';invalidate();};
  function buildPreview() {
    if(!q('form').reportValidity())return;
    try {if(!csv)throw new Error('Upload or paste a CSV first.');
      const unit=q('[data-unit]').value,observations=mapObservations(csv,q('[data-date]').value,q('[data-value]').value,unit,q('[data-scale]').value);
      preview=makeMetric({name:q('[data-name]').value,unit,observations,better:q('[data-direction]').value,aggregation:q('[data-aggregation]').value,denominator:q('[data-population]').value.trim(),definition:q('[data-definition]').value.trim(),source:filename});
      q('[data-import-preview]').innerHTML=`<strong>${escape(preview.name)}</strong><p>${observations.length} rows · ${observations[0].date} – ${observations.at(-1).date} · Latest ${format(preview,preview.latest)}</p>${chartSVG(preview)}`;
      q('[data-import-preview]').hidden=false;q('[data-import]').disabled=false;q('[data-error]').hidden=true;
    }catch(error){invalidate();showError(error);}
  }
  q('[data-preview]').onclick=buildPreview;
  q('form').onsubmit=e=>{e.preventDefault();if(!preview){buildPreview();return;}const metric=preview;preview=null;onAdd(metric);dialog.close();};
}

export class DocumentWorkbench {
  constructor(element,report,{getMetrics,onChange=()=>{},onOutline=()=>{},onAddMetric=()=>{}}={}) {
    this.root=element;this.report=prepareReport(report);this.options={getMetrics,onChange,onOutline,onAddMetric};this.editors=new Map();this.active=null;this.render();
  }
  destroy(){for(const editor of this.editors.values())editor.destroy();this.editors.clear();this.root.replaceChildren();}
  changed(){this.report.edited=true;this.options.onChange(this.report);}
  render(){
    this.destroy();
    this.root.innerHTML=`<div class="editor-tools" role="toolbar" aria-label="Report editing"><select aria-label="Text style"><option value="paragraph">Paragraph</option><option value="heading">Heading</option><option value="subheading">Subheading</option></select>${[['bold','Bold','<b>B</b>'],['italic','Italic','<i>I</i>'],['underline','Underline','<u>U</u>'],['strike','Strikethrough','<s>S</s>'],['bulletList','Bulleted list','• List'],['orderedList','Numbered list','1. List'],['blockquote','Quote','“'],['link','Link','↗'],['clear','Clear formatting','Tx'],['undo','Undo','↶'],['redo','Redo','↷']].map(([cmd,label,content])=>button(label,content,`data-command="${cmd}"`)).join('')}<span class="tool-spacer"></span>${button('Chart','Chart','data-chart')}${button('Rewrite','Rewrite','data-rewrite')}</div><div class="document-sections"></div><button class="add-section" type="button">＋ Section</button><section class="report-metrics"></section><section class="report-estimate"></section>`;
    const tools=this.root.querySelector('.editor-tools'),formats=document.createElement('div'),inserts=document.createElement('div');
    formats.className='format-tools';inserts.className='insert-tools';
    while(tools.firstElementChild&&!tools.firstElementChild.classList.contains('tool-spacer'))formats.append(tools.firstElementChild);
    tools.querySelector('.tool-spacer').remove();
    inserts.append(tools.querySelector('[data-chart]'),tools.querySelector('[data-rewrite]'));tools.append(formats,inserts);
    this.report.sections.forEach(section=>this.mountSection(section));
    this.root.querySelector('.editor-tools').addEventListener('mousedown',e=>{if(e.target.closest('button'))e.preventDefault();});
    this.root.querySelectorAll('[data-command]').forEach(b=>b.onclick=()=>this.command(b.dataset.command));
    this.root.querySelector('[aria-label="Text style"]').onchange=e=>{const editor=this.current();if(!editor)return;const chain=editor.chain().focus();(e.target.value==='paragraph'?chain.setParagraph():chain.setHeading({level:e.target.value==='heading'?2:3})).run();};
    this.root.querySelector('[data-chart]').onclick=()=>this.openChart();
    this.root.querySelector('[data-rewrite]').onclick=()=>this.openRewrite();
    this.root.querySelector('.add-section').onclick=()=>{const section={id:'section-'+crypto.randomUUID(),title:'New section',document:textDocument('')};this.report.sections.push(section);this.mountSection(section);this.outline();this.changed();const title=this.root.querySelector(`[data-section-title="${section.id}"]`);title.focus();const range=document.createRange();range.selectNodeContents(title);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);};
    this.renderMetrics();this.renderEstimate();this.outline();
  }
  mountSection(section) {
    const wrapper=document.createElement('section');wrapper.className='editable-section';wrapper.id=(this.root.id==='report-editor'?'':'review-')+section.id;
    wrapper.innerHTML=`<h2 contenteditable="plaintext-only" role="textbox" aria-label="Section title: ${escape(section.title)}" aria-multiline="false" title="Rename section" data-section-title="${section.id}">${escape(section.title)}</h2><div class="rich-body"></div><div class="section-charts"></div>`;
    this.root.querySelector('.document-sections').append(wrapper);
    const title=wrapper.querySelector('h2');title.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();title.blur();}};
    title.oninput=()=>{section.title=title.textContent.trim()||'Untitled section';this.outline();this.changed();};
    title.onblur=()=>{title.textContent=section.title;title.setAttribute('aria-label','Section title: '+section.title);editor.view.dom.setAttribute('aria-label',section.title+' text');};
    const editor=new Editor({element:wrapper.querySelector('.rich-body'),injectCSS:false,extensions:[StarterKit.configure({heading:{levels:[2,3]},codeBlock:false,code:false,horizontalRule:false,dropcursor:false,link:{openOnClick:false,autolink:false,isAllowedUri:uri=>!!safeLink(uri)}})],content:section.document,editorProps:{attributes:{role:'textbox','aria-label':section.title+' text','aria-multiline':'true',spellcheck:'true'}},onFocus:()=>{this.active=section.id;this.syncToolbar();},onSelectionUpdate:()=>this.syncToolbar(),onUpdate:()=>{section.document=editor.getJSON();if(defaults.some(([id])=>id===section.id))this.report[section.id]=editor.getText();this.changed();this.syncToolbar();}});
    this.editors.set(section.id,editor);this.active??=section.id;this.renderSectionCharts(section.id);
  }
  current(){return this.editors.get(this.active)||this.editors.values().next().value;}
  outline(){this.options.onOutline(this.report.sections.map(s=>({id:s.id,title:s.title})));}
  syncToolbar(){const editor=this.current();if(!editor)return;this.root.querySelectorAll('[data-command]').forEach(b=>{if(['bold','italic','underline','strike','bulletList','orderedList','blockquote','link'].includes(b.dataset.command))b.setAttribute('aria-pressed',String(editor.isActive(b.dataset.command)));});this.root.querySelector('[aria-label="Text style"]').value=editor.isActive('heading',{level:2})?'heading':editor.isActive('heading',{level:3})?'subheading':'paragraph';}
  command(command){const editor=this.current();if(!editor)return;
    if(command==='link'){const dialog=modal('Link',`<form><label class="block-label">Address<input type="url" aria-label="Link address" placeholder="https://" value="${escape(editor.getAttributes('link').href||'')}"></label><p class="form-error" role="alert" hidden></p><div class="dialog-footer"><button class="button" type="button" data-remove>Remove</button><button class="button primary compact-primary">Apply</button></div></form>`);dialog.querySelector('[data-remove]').onclick=()=>{editor.chain().focus().unsetLink().run();dialog.close();};dialog.querySelector('form').onsubmit=e=>{e.preventDefault();const href=safeLink(dialog.querySelector('input').value);if(!href){const error=dialog.querySelector('[role=alert]');error.textContent='Use an http or https address.';error.hidden=false;return;}dialog.close();editor.chain().focus().extendMarkRange('link').setLink({href}).run();};return;}
    const chain=editor.chain().focus(),commands={bold:'toggleBold',italic:'toggleItalic',underline:'toggleUnderline',strike:'toggleStrike',bulletList:'toggleBulletList',orderedList:'toggleOrderedList',blockquote:'toggleBlockquote',undo:'undo',redo:'redo'};
    if(command==='clear')chain.unsetAllMarks().clearNodes().run();else chain[commands[command]]().run();this.syncToolbar();
  }
  setSectionText(id,text){const editor=this.editors.get(id);if(editor)editor.commands.setContent(textDocument(text));}
  openRewrite(){
    const editor=this.current();if(!editor)return;const {from,to}=editor.state.selection,before=JSON.stringify(editor.getJSON()),selected=from!==to,original=selected?editor.state.doc.textBetween(from,to,' '):editor.getText();
    const dialog=modal('Rewrite',`<form><label class="block-label">Request<input aria-label="Rewrite request" value="Make this shorter and clearer"></label><p class="small-help">Prepared local preview · No AI connected</p><div class="rewrite-result" hidden><p data-rewrite-preview></p><button class="button" type="button" data-discard>Discard</button><button class="button primary compact-primary" type="button" data-keep>Keep</button></div><p class="form-error" role="alert" hidden></p><div class="dialog-footer"><button class="button" type="submit">Preview</button></div></form>`);
    let proposed='';dialog.querySelector('form').onsubmit=e=>{e.preventDefault();proposed=(original.match(/[^.!?]+[.!?]+/)?.[0]||original).trim();if(proposed.split(/\s+/).length>35)proposed=proposed.split(/\s+/).slice(0,35).join(' ')+'…';dialog.querySelector('[data-rewrite-preview]').textContent=proposed||'Add a paragraph first.';dialog.querySelector('.rewrite-result').hidden=false;dialog.querySelector('[data-keep]').disabled=!proposed;};
    dialog.querySelector('[data-discard]').onclick=()=>dialog.close();dialog.querySelector('[data-keep]').onclick=()=>{if(editor.isDestroyed||JSON.stringify(editor.getJSON())!==before){const error=dialog.querySelector('[role=alert]');error.textContent='The paragraph changed. Request a new preview.';error.hidden=false;return;}dialog.close();if(selected)editor.chain().focus().insertContentAt({from,to},{type:'text',text:proposed}).run();else editor.commands.setContent(textDocument(proposed));};
  }
  openChart(existing=null){
    const metrics=this.options.getMetrics(),target=existing?.after||this.active||this.report.sections[0].id;
    const dialog=modal('Chart',`<form><div class="form-grid"><label>Metric<select aria-label="Chart metric" data-metric>${metrics.map(m=>`<option value="${m.id}">${escape(m.name)}${m.sample?' · Sample':''}</option>`).join('')}</select></label><label>Type<select aria-label="Chart type" data-type><option value="line">Line</option><option value="bar">Bar</option></select></label></div><label class="block-label">Title<input aria-label="Chart title" data-title placeholder="Metric name"></label><div class="chart-preview" hidden></div><p class="form-error" role="alert" hidden></p><div class="dialog-footer"><button class="button" type="button" data-add-metric>Add metric</button><button class="button" type="submit" ${metrics.length?'':'disabled'}>Generate</button><button class="button primary compact-primary" type="button" data-insert disabled>${existing?'Update':'Insert'}</button></div></form>`);
    let preview=null;const q=s=>dialog.querySelector(s);
    if(existing){q('[data-metric]').value=existing.metricId;q('[data-type]').value=existing.type;q('[data-title]').value=existing.title;}
    q('[data-add-metric]').onclick=()=>{dialog.close();this.options.onAddMetric(()=>this.openChart(existing));};
    q('form').oninput=()=>{preview=null;q('[data-insert]').disabled=true;q('.chart-preview').hidden=true;};
    q('form').onsubmit=e=>{e.preventDefault();const metric=this.options.getMetrics().find(m=>m.id===q('[data-metric]').value);if(!metric)return;preview={id:existing?.id||crypto.randomUUID(),metricId:metric.id,type:q('[data-type]').value,title:q('[data-title]').value.trim()||metric.name,after:target};q('.chart-preview').innerHTML=chartSVG(metric,preview.type)+`<p class="small-help">${escape(metric.source)} · ${metric.sample?'Sample data':'Imported data'}</p>`;q('.chart-preview').hidden=false;q('[data-insert]').disabled=false;};
    q('[data-insert]').onclick=()=>{if(!preview)return;if(existing)this.report.charts=this.report.charts.map(c=>c.id===existing.id?preview:c);else this.report.charts.push(preview);this.renderSectionCharts(target);this.changed();dialog.close();};
  }
  renderSectionCharts(id){
    const node=this.root.querySelector(`[data-section-title="${id}"]`).closest('section').querySelector('.section-charts');node.replaceChildren();
    for(const chart of this.report.charts.filter(chart=>chart.after===id)){const metric=this.options.getMetrics().find(m=>m.id===chart.metricId);if(!metric)continue;const figure=document.createElement('figure');figure.className='report-chart';figure.innerHTML=`<figcaption><strong>${escape(chart.title)}</strong><div>${button('Edit chart','Edit')}${button('Remove chart','×')}</div></figcaption>${chartSVG(metric,chart.type)}<p class="chart-note">${escape(metric.source)} · ${metric.sample?'Sample data':'Imported data'} · ${escape(metric.definition)}</p>`;figure.querySelector('[aria-label="Edit chart"]').onclick=()=>this.openChart(chart);figure.querySelector('[aria-label="Remove chart"]').onclick=()=>{this.report.charts=this.report.charts.filter(c=>c.id!==chart.id);this.renderSectionCharts(id);this.changed();};node.append(figure);}
  }
  renderMetrics(){
    const root=this.root.querySelector('.report-metrics'),metrics=this.options.getMetrics();
    root.innerHTML=`<div class="section-heading"><h2>Select core metrics</h2><button class="button" type="button">＋ Metric</button></div><fieldset class="core-options"><legend class="sr-only">Core metrics</legend>${metrics.length?metrics.map(m=>`<label><input type="checkbox" value="${m.id}" ${this.report.coreMetricIds.includes(m.id)?'checked':''}><span>${escape(m.name)}<small>${m.sample?'Sample · ':''}${escape(m.source)}</small></span><strong>${format(m,m.latest)}</strong></label>`).join(''):'<p class="muted">Add a metric to begin.</p>'}</fieldset>`;
    root.querySelector('button').onclick=()=>this.options.onAddMetric();
    root.querySelectorAll('input').forEach(input=>input.onchange=()=>{this.report.coreMetricIds=input.checked?[...new Set([...this.report.coreMetricIds,input.value])]:this.report.coreMetricIds.filter(id=>id!==input.value);if(this.report.estimate&&!this.report.coreMetricIds.includes(this.report.estimate.metricId))this.report.estimate=null;this.changed();this.renderEstimate();});
  }
  renderEstimate(){
    const root=this.root.querySelector('.report-estimate'),metrics=this.options.getMetrics().filter(m=>this.report.coreMetricIds.includes(m.id)),saved=this.report.estimate;
    root.innerHTML=`<h2>Estimate impact</h2>${metrics.length?`<form><div class="form-grid"><label>Primary metric<select aria-label="Primary metric" data-primary>${metrics.map(m=>`<option value="${m.id}">${escape(m.name)}</option>`).join('')}</select></label><label>Expected change<input type="number" step="any" aria-label="Expected change" data-change placeholder="e.g. 10 or −5" required></label><label>Change unit<select aria-label="Change unit" data-mode><option value="relative">Relative %</option><option value="points">Percentage points</option></select></label><label>Review date<input type="date" aria-label="Review date" data-date required></label></div><p class="form-error" role="alert" hidden></p><div class="estimate-output" hidden></div><div class="dialog-footer"><button class="button" type="submit">Estimate</button></div></form>`:'<p class="muted">Select a core metric first.</p>'}`;
    if(!metrics.length)return;
    const q=s=>root.querySelector(s);if(saved&&metrics.some(m=>m.id===saved.metricId)){q('[data-primary]').value=saved.metricId;q('[data-change]').value=saved.change;q('[data-mode]').value=saved.mode;q('[data-date]').value=saved.date;}
    const constrain=()=>{const metric=metrics.find(m=>m.id===q('[data-primary]').value);q('option[value="points"]').disabled=metric.unit!=='%';if(metric.unit!=='%')q('[data-mode]').value='relative';};constrain();
    const show=estimate=>{const metric=metrics.find(m=>m.id===estimate.metricId),target=estimateTarget(metric,estimate.change,estimate.mode);q('.estimate-output').innerHTML=`<div><span>Baseline</span><strong>${format(metric,metric.latest)}</strong></div><span aria-hidden="true">→</span><div><span>Target</span><strong>${format(metric,target)}</strong></div><p>Your estimate · Not measured · ${escape(estimate.date)}</p>`;q('.estimate-output').hidden=false;};
    if(saved)show(saved);
    q('form').oninput=()=>{constrain();this.report.estimate=null;q('.estimate-output').hidden=true;q('[role=alert]').hidden=true;this.changed();};
    q('form').onsubmit=e=>{e.preventDefault();try{const metric=metrics.find(m=>m.id===q('[data-primary]').value),change=q('[data-change]').value,mode=q('[data-mode]').value,date=q('[data-date]').value;if(date<=metric.observations.at(-1).date)throw new Error('Choose a review date after the latest observation.');estimateTarget(metric,change,mode);this.report.estimate={metricId:metric.id,change:Number(change),mode,date};show(this.report.estimate);q('[role=alert]').hidden=true;this.changed();}catch(error){q('[role=alert]').textContent=error.message;q('[role=alert]').hidden=false;}};
  }
  refreshMetrics(){this.renderMetrics();this.renderEstimate();this.report.sections.forEach(s=>this.renderSectionCharts(s.id));}
}
