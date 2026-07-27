(()=>{
  const config=window.STUDY_APP_CONFIG||{};
  if(!window.supabase||!config.supabaseUrl||!config.supabasePublishableKey)return;

  const client=window.supabase.createClient(
    config.supabaseUrl,
    config.supabasePublishableKey,
    {auth:{persistSession:true,autoRefreshToken:true}}
  );

  const reasons=['未完成任务','未按计划完成学习','学习记录不符合要求','违规使用奖励','其他原因'];
  let profile=null;
  let ledger=[];
  let redemptions=[];
  let channel=null;
  let observer=null;
  let timer=null;
  let toastTimer=null;

  const q=id=>document.getElementById(id);
  const isOwner=()=>profile?.role==='owner';
  const setText=(element,text)=>{if(element&&element.textContent!==text)element.textContent=text};
  const formatTime=value=>value?new Intl.DateTimeFormat('zh-CN',{
    year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'
  }).format(new Date(value)):'—';

  function notify(message){
    let toast=q('pointsDeductionToast');
    if(!toast){
      toast=document.createElement('div');
      toast.id='pointsDeductionToast';
      toast.className='task-review-toast';
      toast.setAttribute('role','status');
      toast.setAttribute('aria-live','polite');
      document.body.appendChild(toast);
    }
    clearTimeout(toastTimer);
    toast.textContent=message;
    toast.classList.add('show');
    toastTimer=setTimeout(()=>toast.classList.remove('show'),2800);
  }

  const userLedger=()=>ledger.filter(item=>item.username==='user_1');
  const availablePoints=()=>Math.max(0,userLedger().reduce((sum,item)=>sum+Number(item.amount||0),0));
  const deductedPoints=()=>userLedger()
    .filter(item=>item.entry_type==='deduction'&&Number(item.amount)<0)
    .reduce((sum,item)=>sum+Math.abs(Number(item.amount||0)),0);
  const pendingPoints=()=>redemptions
    .filter(item=>item.username==='user_1'&&item.status==='pending')
    .reduce((sum,item)=>sum+Number(item.points_cost||0),0);
  const deductiblePoints=()=>Math.max(0,availablePoints()-pendingPoints());

  function mount(){
    const center=q('pointsCenterSection');
    if(!center)return;

    const balanceGrid=center.querySelector('.points-balance-grid');
    if(balanceGrid&&!q('deductedPointValue')){
      const metric=document.createElement('div');
      metric.className='points-deduction-metric';
      metric.innerHTML='<span>管理员扣除</span><strong id="deductedPointValue">0</strong>';
      balanceGrid.appendChild(metric);
    }

    const adminCard=q('manualGrantCard');
    if(adminCard&&!q('manualDeductionPanel')){
      const panel=document.createElement('section');
      panel.id='manualDeductionPanel';
      panel.className='points-deduction-panel hidden';
      panel.innerHTML=`
        <div class="points-deduction-head">
          <div>
            <h4>管理员扣除积分</h4>
            <p id="manualDeductionHint">默认原因为“未完成任务”。</p>
          </div>
        </div>
        <div class="points-deduction-form">
          <label>扣除积分
            <input id="manualDeductionAmount" type="number" min="1" max="1" step="1" value="1">
          </label>
          <label>扣除原因
            <select id="manualDeductionReason">
              ${reasons.map(reason=>`<option value="${reason}">${reason}</option>`).join('')}
            </select>
          </label>
          <label>补充说明
            <input id="manualDeductionDetail" maxlength="400" placeholder="可选：填写具体日期或情况">
          </label>
          <button id="manualDeductionButton" class="task-review-danger" type="button">扣除积分</button>
        </div>`;
      adminCard.appendChild(panel);
      q('manualDeductionButton')?.addEventListener('click',deductPoints);
    }

    const historyGrid=center.querySelector('.points-history-grid');
    if(historyGrid&&!q('pointDeductionHistory')){
      const section=document.createElement('section');
      section.className='points-deduction-history-section';
      section.innerHTML='<h4>管理员扣除记录</h4><div id="pointDeductionHistory" class="points-history-list"></div>';
      historyGrid.appendChild(section);
    }
  }

  function historyRow(item){
    const row=document.createElement('article');
    row.className='points-history-item';
    const main=document.createElement('div');
    const title=document.createElement('strong');
    title.textContent=item.note||'管理员扣除积分';
    const meta=document.createElement('span');
    meta.textContent=`管理员扣除 · ${formatTime(item.created_at)}`;
    main.append(title,meta);
    const amount=document.createElement('b');
    amount.className='points-negative';
    amount.textContent=`−${Math.abs(Number(item.amount||0))}`;
    row.append(main,amount);
    return row;
  }

  function render(){
    observer?.disconnect();
    mount();
    q('manualDeductionPanel')?.classList.toggle('hidden',!isOwner());

    const deducted=deductedPoints();
    const deductible=deductiblePoints();
    const pending=pendingPoints();
    setText(q('deductedPointValue'),String(deducted));
    const totalDeductionMetric=q('redeemedPointValue')?.closest('div');
    setText(totalDeductionMetric?.querySelector('span'),'总扣除');
    if(totalDeductionMetric)totalDeductionMetric.title='包含管理员扣除和已批准的积分兑换';

    const input=q('manualDeductionAmount');
    const button=q('manualDeductionButton');
    if(input){
      input.max=String(Math.max(1,deductible));
      if(Number(input.value)>deductible)input.value=String(Math.max(1,deductible));
      input.disabled=!isOwner()||deductible<1;
    }
    if(button)button.disabled=!isOwner()||deductible<1;

    const hint=q('manualDeductionHint');
    if(hint){
      setText(hint,deductible>0
        ?`当前最多可扣除 ${deductible} 分；默认原因为“未完成任务”。${pending?` 待审核兑换已预留 ${pending} 分。`:''}`
        :pending>0
          ?'当前积分已全部被待审核兑换占用，请先处理兑换申请。'
          :'当前没有可扣除积分。');
    }

    const list=q('pointDeductionHistory');
    if(list){
      const entries=userLedger()
        .filter(item=>item.entry_type==='deduction'&&Number(item.amount)<0)
        .sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
      if(entries.length)list.replaceChildren(...entries.map(historyRow));
      else list.innerHTML='<div class="task-review-empty">暂无管理员扣除记录。</div>';
    }

    observe();
  }

  async function deductPoints(){
    if(!isOwner())return;
    const amount=Number(q('manualDeductionAmount')?.value||0);
    const reason=q('manualDeductionReason')?.value||'未完成任务';
    const detail=q('manualDeductionDetail')?.value.trim()||'';
    const maximum=deductiblePoints();

    if(!Number.isInteger(amount)||amount<1||amount>9999){
      notify('请输入 1 到 9999 的整数积分');
      return;
    }
    if(amount>maximum){
      notify(`当前最多可扣除 ${maximum} 积分`);
      return;
    }

    const finalReason=detail?`${reason}：${detail}`:reason;
    if(!window.confirm(`确认从 user_1 扣除 ${amount} 积分？\n原因：${finalReason}`))return;

    const button=q('manualDeductionButton');
    button.disabled=true;
    const {error}=await client.rpc('deduct_user_points',{
      p_points:amount,
      p_reason:finalReason
    });
    button.disabled=false;

    if(error){notify(error.message);return;}
    q('manualDeductionAmount').value='1';
    q('manualDeductionReason').value='未完成任务';
    q('manualDeductionDetail').value='';
    notify(`已从 user_1 扣除 ${amount} 积分`);
    await loadData();
  }

  async function loadData(){
    if(!profile)return;
    const [ledgerResult,redemptionResult]=await Promise.all([
      client.from('point_ledger')
        .select('id,username,amount,entry_type,note,created_at')
        .order('created_at',{ascending:false})
        .limit(1000),
      client.from('point_redemptions')
        .select('id,username,points_cost,status')
        .order('submitted_at',{ascending:false})
        .limit(500)
    ]);

    if(ledgerResult.error){notify(ledgerResult.error.message);return;}
    if(redemptionResult.error){notify(redemptionResult.error.message);return;}
    ledger=ledgerResult.data||[];
    redemptions=redemptionResult.data||[];
    render();
  }

  function observe(){
    if(!observer)observer=new MutationObserver(schedule);
    observer.disconnect();
    observer.observe(document.body,{childList:true,subtree:true,characterData:true});
  }

  function schedule(){
    clearTimeout(timer);
    timer=setTimeout(()=>{
      mount();
      render();
    },100);
  }

  async function initialize(session){
    profile=null;
    ledger=[];
    redemptions=[];
    if(channel){client.removeChannel(channel);channel=null;}

    if(!session){
      q('manualDeductionPanel')?.classList.add('hidden');
      return;
    }

    const {data,error}=await client.from('profiles')
      .select('role,username,display_name')
      .eq('id',session.user.id)
      .single();
    if(error){notify(error.message);return;}
    profile=data;
    mount();
    await loadData();

    channel=client.channel('manual-points-deduction-ui')
      .on('postgres_changes',{event:'*',schema:'public',table:'point_ledger'},loadData)
      .on('postgres_changes',{event:'*',schema:'public',table:'point_redemptions'},loadData)
      .subscribe();
  }

  function start(){
    observe();
    client.auth.getSession().then(({data})=>initialize(data.session));
    client.auth.onAuthStateChange((event,session)=>{
      if(event==='SIGNED_IN'||event==='SIGNED_OUT')setTimeout(()=>initialize(session),0);
    });
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();
