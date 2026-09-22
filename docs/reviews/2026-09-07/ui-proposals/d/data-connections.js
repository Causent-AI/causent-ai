(() => {
  window.createDataConnections=(api,ui)=>{
    const e=ui.escape;
    const providers={
      GitHub:{mark:'GH',description:'Code & PRs',fields:[['repository','Repository','owner/repository']]},
      BigQuery:{mark:'BQ',description:'Data warehouse',fields:[['project','Project ID','your-project'],['dataset','Dataset','analytics']]},
      'Google Analytics':{mark:'GA',description:'Web analytics',fields:[['property','Property ID','123456789']]},
      Custom:{mark:'+',description:'Data source',fields:[['resource','Resource','Account, workspace, or dataset']]}
    };
    const records=['GitHub','BigQuery','Google Analytics'].map(provider=>({id:provider,provider,name:provider,settings:{}}));
    function edit(id){
      const existing=records.find(r=>r.id===id),settings={...existing?.settings};
      const modal=ui.dialog(existing?existing.name:'New connection',`<form><div class="form-grid"><label>Name<input name="name" required maxlength="80" value="${e(existing?.name||'')}" placeholder="Connection name"></label><label>Provider<select name="provider">${Object.keys(providers).map(p=>`<option${p===(existing?.provider||'GitHub')?' selected':''}>${e(p)}</option>`).join('')}</select></label></div><div class="form-grid" data-connection-fields></div><p class="small-help">Local preview · No account is connected or data imported.</p><button type="submit" class="button primary compact-primary">Save</button></form>`);
      const form=modal.querySelector('form'),fields=form.querySelector('[data-connection-fields]');
      function renderFields(){
        fields.innerHTML=providers[form.elements.provider.value].fields.map(([key,label,placeholder])=>`<label>${label}<input name="${key}" required maxlength="160" placeholder="${e(placeholder)}" value="${e(settings[key]||'')}"></label>`).join('');
      }
      form.elements.provider.onchange=()=>{for(const input of fields.querySelectorAll('input'))settings[input.name]=input.value;renderFields();};
      renderFields();
      form.oninput=event=>event.target.setCustomValidity?.('');
      form.onsubmit=event=>{
        event.preventDefault();
        for(const input of form.querySelectorAll('input'))if(!input.value.trim()){input.setCustomValidity('Enter a value.');input.reportValidity();return;}
        const data=new FormData(form),provider=data.get('provider');
        const record={id:existing?.id||crypto.randomUUID(),name:data.get('name').trim(),provider,settings:Object.fromEntries(providers[provider].fields.map(([key])=>[key,data.get(key).trim()]))};
        if(existing)Object.assign(existing,record);else records.push(record);
        modal.close();render();api.toast('Connection settings saved locally.');
      };
    }
    function render(){
      const root=document.getElementById('data-connections');
      root.innerHTML=`<div class="section-heading"><h2>Connections</h2><button class="button primary compact-primary" data-new-connection>＋ Connection</button></div><div class="ai-cards">${records.map(r=>{const p=providers[r.provider];return `<article class="ai-card connection-card"><div class="ai-card-top"><span class="partner-letter">${e(p.mark)}</span><span class="state-chip">Not connected</span></div><h3>${e(r.name)}</h3><p>${e(p.description)}</p><code>${e(Object.values(r.settings).join(' / ')||'Not configured')}</code><div class="ai-card-bottom"><span>${e(r.provider)}</span><button class="text-button" data-configure-connection="${e(r.id)}" aria-label="Configure ${e(r.name)}">Configure ↗</button></div></article>`;}).join('')}</div><p class="footnote">Local preview · Connections are not live.</p>`;
      root.querySelector('[data-new-connection]').onclick=()=>edit();
      root.querySelectorAll('[data-configure-connection]').forEach(button=>button.onclick=()=>edit(button.dataset.configureConnection));
    }
    return {render};
  };
})();
