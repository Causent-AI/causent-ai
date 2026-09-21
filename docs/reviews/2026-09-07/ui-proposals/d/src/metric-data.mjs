export const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const day = 86400000;
const average = values => values.reduce((sum,value)=>sum+value,0)/values.length;
export const isoDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value;
export const displayDate = value => new Date(value+'T00:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'});
export function parseCSV(text) {
  if(new TextEncoder().encode(text).length>1048576)throw new Error('Use a CSV up to 1 MiB.');
  const rows=[];let row=[],value='',quoted=false,closed=false;
  text=text.replace(/^\uFEFF/,'');
  for(let i=0;i<=text.length;i++) {
    const c=text[i];
    if(quoted) {if(c===undefined)throw new Error('A quoted field is incomplete.');if(c==='"'){if(text[i+1]==='"'){value+='"';i++;}else {quoted=false;closed=true;}}else value+=c;continue;}
    if(c==='"') {if(value!==''||closed)throw new Error('Check the CSV quoting.');quoted=true;continue;}
    if(c===','||c==='\n'||c==='\r'||c===undefined) {
      row.push(value.trim());value='';closed=false;
      if(c!==',') {if(row.some(cell=>cell!==''))rows.push(row);row=[];if(c==='\r'&&text[i+1]==='\n')i++;}
    } else {if(closed&&c.trim())throw new Error('Unexpected text after a quoted field.');if(!closed)value+=c;}
    if(rows.length>10001)throw new Error('Use up to 10,000 daily observations.');
  }
  if(rows.length<2)throw new Error('Include column headers and at least one data row.');
  const headers=rows.shift();
  if(headers.some(h=>!h)||new Set(headers.map(h=>h.toLowerCase())).size!==headers.length)throw new Error('Column headers must be non-empty and unique.');
  if(rows.some(row=>row.length!==headers.length))throw new Error('Every row must have the same number of columns as the header.');
  return {headers,rows};
}
export function mapObservations(csv,dateColumn,valueColumn,unit='number',scale='points') {
  const di=csv.headers.indexOf(dateColumn),vi=csv.headers.indexOf(valueColumn),seen=new Set();
  if(di<0||vi<0||di===vi)throw new Error('Choose separate date and value columns.');
  return csv.rows.map((row,index)=>{
    const date=row[di],raw=row[vi];
    if(!isoDate(date))throw new Error(`Row ${index+2}: use a valid YYYY-MM-DD date.`);
    if(seen.has(date))throw new Error(`Row ${index+2}: ${date} appears more than once.`);seen.add(date);
    if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw))throw new Error(`Row ${index+2}: enter a numeric value without symbols.`);
    let value=Number(raw);if(!Number.isFinite(value))throw new Error(`Row ${index+2}: value is outside the supported range.`);
    if(unit==='percent'){if(!['points','ratio'].includes(scale))throw new Error('Choose the percentage scale.');if(scale==='ratio')value*=100;if(value<0||value>100)throw new Error(`Row ${index+2}: percentage is outside 0–100%.`);}
    return {date,value};
  }).sort((a,b)=>a.date.localeCompare(b.date));
}
export function summarize(observations) {
  const last=observations.at(-1),lookup=new Map(observations.map(o=>[o.date,o.value]));
  const windowMean=(count,offset=0)=>{
    const values=[];
    for(let i=offset;i<offset+count;i++){const date=new Date(Date.parse(last.date)-i*day).toISOString().slice(0,10);if(!lookup.has(date))return null;values.push(lookup.get(date));}
    return average(values);
  };
  const l7=windowMean(7),previous=windowMean(7,7);
  return {latest:last.value,l7,l28:windowMean(28),wow:l7!==null&&previous!==null&&previous!==0?(l7/previous-1)*100:null};
}
export function makeMetric({name,unit='number',better='higher',aggregation='mean',denominator='',definition='',source='CSV',observations,sample=false,id=crypto.randomUUID()}) {
  if(!name.trim())throw new Error('Name the metric.');
  if(!observations.length)throw new Error('Add at least one observation.');
  return {id,name:name.trim(),unit:unit==='percent'?'%':unit==='minutes'?' min':unit==='USD'?' USD':'',kind:unit,symbol:unit==='percent'?'%':unit==='minutes'?'m':'#',digits:unit==='number'?0:1,better,aggregation,denominator,definition:definition||`${aggregation} · ${denominator}`,source,observations,sample,values:observations.map(o=>o.value),...summarize(observations)};
}
export function format(metric,value) {return value===null||value===undefined||!Number.isFinite(value)?'—':value.toLocaleString('en-US',{minimumFractionDigits:metric.digits,maximumFractionDigits:metric.digits})+metric.unit;}
export function estimateTarget(metric,change,mode) {
  if(change===''||!Number.isFinite(Number(change)))throw new Error('Enter an expected change.');
  if(mode==='points'&&metric.unit!=='%')throw new Error('Percentage points apply to percentage metrics.');
  if(mode!=='points'&&metric.latest===0)throw new Error('A relative change needs a non-zero baseline.');
  const target=mode==='points'?metric.latest+Number(change):metric.latest*(1+Number(change)/100);
  if(!Number.isFinite(target)||(metric.unit==='%'&&(target<0||target>100)))throw new Error('The target is outside the metric’s range.');
  return target;
}
export function chartSVG(metric,type='line') {
  const observations=metric.observations||[],width=760,height=230,left=58,right=20,top=24,bottom=38;
  if(!observations.length)return '<p class="muted">No observations yet.</p>';
  let points=observations;
  if(type==='bar'&&points.length>28)points=points.slice(-28);
  const values=points.map(p=>p.value),low=Math.min(...values),high=Math.max(...values),padding=Math.max((high-low)*.15,Math.abs(high)*.05,1);
  const min=type==='bar'?Math.min(0,low-padding):low-padding,max=high+padding;
  const first=Date.parse(points[0].date),last=Date.parse(points.at(-1).date);
  const x=(i)=>left+(last===first?.5:(Date.parse(points[i].date)-first)/(last-first))*(width-left-right),y=v=>height-bottom-(v-min)/(max-min)*(height-top-bottom);
  const grid=[0,.5,1].map(n=>{const v=min+(max-min)*n;return `<line class="axis" x1="${left}" x2="${width-right}" y1="${y(v)}" y2="${y(v)}"/><text x="${left-9}" y="${y(v)+4}" text-anchor="end">${escape(format(metric,v))}</text>`;}).join('');
  const indices=[...new Set([0,Math.floor((points.length-1)/2),points.length-1])];
  const dates=indices.map(i=>`<text x="${x(i)}" y="${height-10}" text-anchor="${i===0?'start':i===points.length-1?'end':'middle'}">${displayDate(points[i].date)}</text>`).join('');
  const marks=type==='bar'?points.map((p,i)=>{const w=Math.max(2,Math.min(40,(width-left-right)/points.length*.65));return `<rect x="${Math.min(width-right-w,Math.max(left,x(i)-w/2))}" y="${Math.min(y(0),y(p.value))}" width="${w}" height="${Math.max(1,Math.abs(y(0)-y(p.value)))}" rx="3" fill="#377ded"><title>${p.date}: ${escape(format(metric,p.value))}</title></rect>`;}).join(''):`<polyline class="observed" points="${points.map((p,i)=>`${x(i)},${y(p.value)}`).join(' ')}"/>${points.length===1?`<circle cx="${x(0)}" cy="${y(points[0].value)}" r="4" fill="#377ded"/>`:''}`;
  return `<svg class="timeline" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escape(metric.name)} ${type} chart"><title>${escape(metric.source)} · ${points[0].date} to ${points.at(-1).date}</title>${grid}${marks}${dates}</svg>`;
}
export function estimateAICost({inputTokens,outputTokens,inputRate,outputRate,passes}) {
  const inputs=[inputTokens,outputTokens,inputRate,outputRate,passes];
  if(inputs.some(v=>v===''||!Number.isFinite(Number(v))||Number(v)<0)||Number(passes)<1)return null;
  const minimum=(Number(inputTokens)*Number(inputRate)+Number(outputTokens)*Number(outputRate))/1e6;
  const maximum=minimum*Number(passes);
  return Number.isFinite(maximum)?{minimum,maximum}:null;
}
