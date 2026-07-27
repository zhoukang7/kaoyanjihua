(()=>{
  const config=window.STUDY_APP_CONFIG||{};
  if(!window.supabase||!config.supabaseUrl||!config.supabasePublishableKey)return;

  const client=window.supabase.createClient(
    config.supabaseUrl,
    config.supabasePublishableKey,
    {auth:{persistSession:true,autoRefreshToken:true}}
  );

  const dailyTasks=[
    {key:'d_words',label:'背诵 50 个新词并复习旧词'},
    {key:'d_math',label:'660题完成 25 题并标记错因'},
    {key:'d_read',label:'精读 1 篇真题阅读'},
    {key:'d_ctl',label:'学习教材 18 页并完成 5 道题'},
    {key:'d_pol',label:'听 1 节课程并做 20 道选择题'},
    {key:'d_review',label:'整理错题与明日计划'}
  ];
  const redemptionStatus={pending:'待审核',approved:'已兑换',rejected:'未通过'};

  let profile=null;
  let submissions=[];
  let redemptions=[];
  let realtimeChannel=null;
  let observer=null;
  let patchTimer=null;
  let toastTimer=null;

  const q=id=>document.getElementById(id);
  const isOwner=()=>profile?.role==='owner';
  const isUser1=()=>profile?.username==='user_1';
  const formatTime=value=>value?new Intl.DateTimeFormat('zh-CN',{
    year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'
  }).format(new Date(value)):'—';
  const taskLabel=key=>dailyTasks.find(task=>task.key===key)?.label||key;
  const setText=(element,text)=>{if(element&&element.textContent!==text)element.textContent=text};
  const awardedTotal=()=>submissions
    .filter(item=>item.username==='user_1'&&item.task_type==='daily')
    .reduce((sum,item)=>sum+Number(item.points_awarded||0),0);
  const redeemedTotal=()=>redemptions
    .filter(item=>item.username==='user_1'&&item.status==='approved')
    .reduce((sum,item)=>sum+Number(item.points_cost||0),0);
  const pendingRedemptionTotal=()=>redemptions
    .filter(item=>item.username==='user_1'&&item.status==='pending')
    .reduce((sum,item)=>sum+Number(item.points_cost||0),0);
  const availablePoints=()=>Math.max(0,awardedTotal()-redeemedTotal());

  function notify(message){
    let toast=q('pointsControlToast');
    if(!toast){
      toast=document.createElement('div');
      toast.id='pointsControlToast';
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

  function mountPointsUi(){
    const section=q('taskReviewSection');
    if(!section)return;

    if(!q('pointAwardCard')){
      const card=document.createElement('article');
      card.id='pointAwardCard';
      card.className='task-review-card hidden';
      card.innerHTML=`
        <div class="task-review-card-head">
          <div><h3>积分发放</h3><p>仅审核通过的每日任务可由管理员单独发放 1 积分。</p></div>
          <button id="refreshPointAwards" class="task-review-ghost" type="button">刷新</button>
        </div>
        <div id="pendingPointList" class="task-review-list"></div>`;
      const adminCard=q('adminReviewCard');
      if(adminCard)adminCard.insertAdjacentElement('afterend',card);else section.appendChild(card);
      q('refreshPointAwards')?.addEventListener('click',loadData);
    }

    if(!q('pointExchangeCard')){
      const card=document.createElement('article');
      card.id='pointExchangeCard';
      card.className='task-review-card points-exchange-card';
      card.innerHTML=`
        <div class="task-review-card-head">
          <div><h3>积分兑换与流水</h3><p>user_1 提交兑换申请，管理员审核通过后才扣减积分。</p></div>
          <button id="refreshPointExchange" class="task-review-ghost" type="button">刷新</button>
        </div>
        <div class="points-balance-grid">
          <div><span>可用积分</span><strong id="availablePointValue">0</strong></div>
          <div><span>累计发放</span><strong id="awardedPointValue">0</strong></div>
          <div><span>已兑换</span><strong id="redeemedPointValue">0</strong></div>
          <div><span>待审核占用</span><strong id="pendingPointValue">0</strong></div>
        </div>
        <div id="redemptionRequestArea" class="points-redemption-form hidden">
          <label>兑换内容<input id="redemptionItem" maxlength="120" placeholder="例如：周末休息半天"></label>
          <label>使用积分<input id="redemptionCost" type="number" min="1" max="999" step="1" value="1"></label>
          <button id="submitRedemption" class="task-review-primary" type="button">提交兑换申请</button>
          <p>提交时会校验余额；管理员审核通过后才正式扣分。</p>
        </div>
        <div id="redemptionReviewArea" class="hidden">
          <h4>待审核兑换</h4>
          <div id="pendingRedemptionList" class="task-review-list"></div>
        </div>
        <div class="points-history-grid">
          <section><h4>积分发放记录</h4><div id="pointAwardHistory" class="points-history-list"></div></section>
          <section><h4>积分兑换记录</h4><div id="pointRedemptionHistory" class="points-history-list"></div></section>
        </div>`;
      q('pointAwardCard')?.insertAdjacentElement('afterend',card) || section.appendChild(card);
      q('refreshPointExchange')?.addEventListener('click',loadData);
      q('submitRedemption')?.addEventListener('click',submitRedemption);
    }
  }

  function patchStaticText(){
    const description=q('taskReviewDescription');
    const adminCard=q('adminReviewCard');
    const notice=q('taskReviewNotice');
    if(isOwner()){
      setText(description,'user_1 的所有任务必须审核；任务完成、积分发放和积分兑换分别处理。');
      setText(notice,'每日任务审核通过后计入学习进度；积分发放与兑换审核均由管理员单独操作。');
    }else if(isUser1()){
      setText(description,'你可以提交任务和积分兑换申请；只有管理员审核通过后才生效。');
      setText(notice,'可用积分等于管理员已发放积分减去已审核兑换积分。');
    }
    const adminHelp=adminCard?.querySelector('.task-review-card-head p');
    setText(adminHelp,'审核通过会同步主看板；每日任务计入学习进度，但不会自动增加积分。');
    document.querySelectorAll('#pendingReviewList .task-review-primary').forEach(button=>{
      if(button.textContent.includes('+1'))button.textContent='审核通过';
    });
    const metric=q('user1Points')?.closest('.task-review-metric');
    setText(metric?.querySelector('span'),'user_1 可用积分');
    setText(metric?.querySelector('small'),'累计发放减去已审核兑换');
  }

  function renderPointAwards(){
    const card=q('pointAwardCard');
    const list=q('pendingPointList');
    if(!card||!list)return;
    card.classList.toggle('hidden',!isOwner());
    if(!isOwner())return;
    const waiting=submissions.filter(item=>
      item.username==='user_1'&&item.task_type==='daily'&&item.status==='approved'&&Number(item.points_awarded||0)===0
    ).sort((a,b)=>new Date(a.reviewed_at||a.submitted_at)-new Date(b.reviewed_at||b.submitted_at));
    if(!waiting.length){list.innerHTML='<div class="task-review-empty">目前没有待发放积分的每日任务。</div>';return}
    list.replaceChildren(...waiting.map(item=>{
      const row=document.createElement('article');row.className='task-review-item';
      const main=document.createElement('div');main.className='task-review-item-main';
      const title=document.createElement('strong');title.textContent=taskLabel(item.task_key);
      const meta=document.createElement('span');meta.textContent=`${item.period_key} · 审核通过于 ${formatTime(item.reviewed_at||item.updated_at)}`;
      main.append(title,meta);
      const actions=document.createElement('div');actions.className='task-review-actions';
      const button=document.createElement('button');button.type='button';button.className='task-review-primary';button.textContent='发放 1 积分';
      button.addEventListener('click',()=>awardPoint(item,button));actions.appendChild(button);row.append(main,actions);return row;
    }));
  }

  function renderBalances(){
    const available=availablePoints(),awarded=awardedTotal(),redeemed=redeemedTotal(),pending=pendingRedemptionTotal();
    setText(q('availablePointValue'),String(available));
    setText(q('awardedPointValue'),String(awarded));
    setText(q('redeemedPointValue'),String(redeemed));
    setText(q('pendingPointValue'),String(pending));
    setText(q('user1Points'),String(available));
    q('redemptionRequestArea')?.classList.toggle('hidden',!isUser1());
    q('redemptionReviewArea')?.classList.toggle('hidden',!isOwner());
    const cost=q('redemptionCost');if(cost)cost.max=String(Math.max(1,available-pending));
  }

  function renderRedemptionReviews(){
    const list=q('pendingRedemptionList');if(!list||!isOwner())return;
    const pending=redemptions.filter(item=>item.status==='pending').sort((a,b)=>new Date(a.submitted_at)-new Date(b.submitted_at));
    if(!pending.length){list.innerHTML='<div class="task-review-empty">目前没有待审核兑换。</div>';return}
    list.replaceChildren(...pending.map(item=>{
      const row=document.createElement('article');row.className='task-review-item';
      const main=document.createElement('div');main.className='task-review-item-main';
      const title=document.createElement('strong');title.textContent=`${item.item_name} · ${item.points_cost} 积分`;
      const meta=document.createElement('span');meta.textContent=`${item.display_name||item.username} · ${formatTime(item.submitted_at)}`;main.append(title,meta);
      const actions=document.createElement('div');actions.className='task-review-actions';
      const reject=document.createElement('button');reject.type='button';reject.className='task-review-danger';reject.textContent='不通过';reject.addEventListener('click',()=>reviewRedemption(item,'rejected'));
      const approve=document.createElement('button');approve.type='button';approve.className='task-review-primary';approve.textContent=`批准并扣 ${item.points_cost} 分`;approve.addEventListener('click',()=>reviewRedemption(item,'approved'));
      actions.append(reject,approve);row.append(main,actions);return row;
    }));
  }

  function makeHistoryRow(title,meta,badge,badgeClass=''){
    const row=document.createElement('article');row.className='points-history-item';
    const main=document.createElement('div');const strong=document.createElement('strong');strong.textContent=title;
    const small=document.createElement('span');small.textContent=meta;main.append(strong,small);
    const status=document.createElement('b');status.className=badgeClass;status.textContent=badge;row.append(main,status);return row;
  }

  function renderHistories(){
    const awardList=q('pointAwardHistory'),redemptionList=q('pointRedemptionHistory');if(!awardList||!redemptionList)return;
    const awards=submissions.filter(item=>item.username==='user_1'&&Number(item.points_awarded||0)===1)
      .sort((a,b)=>new Date(b.points_awarded_at||b.updated_at)-new Date(a.points_awarded_at||a.updated_at));
    awardList.replaceChildren(...(awards.length?awards.map(item=>makeHistoryRow(
      taskLabel(item.task_key),`${item.period_key} · ${formatTime(item.points_awarded_at||item.updated_at)}`,'+1','points-positive'
    )):[makeHistoryRow('暂无积分发放记录','管理员发放后将在这里显示','—')]));

    const history=[...redemptions].sort((a,b)=>new Date(b.submitted_at)-new Date(a.submitted_at));
    redemptionList.replaceChildren(...(history.length?history.map(item=>{
      const status=redemptionStatus[item.status]||item.status;
      const row=makeHistoryRow(item.item_name,`${item.points_cost} 积分 · ${formatTime(item.submitted_at)}`,status,item.status==='approved'?'points-negative':`status-${item.status}`);
      if(item.status==='pending'&&isUser1()){
        const button=document.createElement('button');button.type='button';button.className='task-review-ghost';button.textContent='撤回';button.addEventListener('click',()=>withdrawRedemption(item));row.appendChild(button);
      }
      if(item.review_note){const note=document.createElement('p');note.className='points-history-note';note.textContent=`管理员说明：${item.review_note}`;row.appendChild(note)}
      return row;
    }):[makeHistoryRow('暂无兑换记录','user_1 提交兑换后将在这里显示','—')]));
  }

  function patchTaskBadges(){
    const rows=[...(q('daily')?.querySelectorAll('.task')||[])];
    const now=new Date(),today=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    dailyTasks.forEach((task,index)=>{
      const row=rows[index];if(!row)return;
      const item=submissions.find(record=>record.username==='user_1'&&record.task_type==='daily'&&record.task_key===task.key&&record.period_key===today);
      if(!item||item.status!=='approved')return;
      const content=row.children[1];if(!content)return;
      let badge=row.querySelector('.task-submission-state');if(!badge){badge=document.createElement('span');content.appendChild(badge)}
      badge.className='task-submission-state status-approved';
      setText(badge,Number(item.points_awarded||0)===1?'已通过 · +1积分':'已通过 · 待发积分');
    });
  }

  function observePage(){if(!profile)return;if(!observer)observer=new MutationObserver(schedulePatch);observer.observe(document.body,{childList:true,subtree:true,characterData:true})}
  function applyUi(){observer?.disconnect();mountPointsUi();patchStaticText();renderPointAwards();renderBalances();renderRedemptionReviews();renderHistories();patchTaskBadges();observePage()}
  function schedulePatch(){clearTimeout(patchTimer);patchTimer=setTimeout(applyUi,60)}

  async function awardPoint(item,button){
    if(!window.confirm(`确认给“${taskLabel(item.task_key)}”发放 1 积分？`))return;
    button.disabled=true;const {error}=await client.rpc('award_task_point',{p_submission_id:item.id});button.disabled=false;
    if(error){notify(error.message);return}notify('已发放 1 积分');await loadData();
  }

  async function submitRedemption(){
    const itemName=q('redemptionItem')?.value.trim()||'';const pointsCost=Number(q('redemptionCost')?.value||0);
    if(!itemName){notify('请填写兑换内容');return}
    if(!Number.isInteger(pointsCost)||pointsCost<1){notify('请输入有效的兑换积分');return}
    const button=q('submitRedemption');button.disabled=true;
    const {error}=await client.rpc('submit_point_redemption',{p_item_name:itemName,p_points_cost:pointsCost});button.disabled=false;
    if(error){notify(error.message);return}
    q('redemptionItem').value='';q('redemptionCost').value='1';notify('兑换申请已提交，等待管理员审核');await loadData();
  }

  async function withdrawRedemption(item){
    if(!window.confirm(`确认撤回“${item.item_name}”兑换申请？`))return;
    const {error}=await client.rpc('withdraw_point_redemption',{p_redemption_id:item.id});
    if(error){notify(error.message);return}notify('兑换申请已撤回');await loadData();
  }

  async function reviewRedemption(item,decision){
    let note=null;
    if(decision==='rejected'){note=window.prompt('可填写不通过原因（可留空）：','');if(note===null)return}
    else if(!window.confirm(`确认批准“${item.item_name}”，扣除 ${item.points_cost} 积分？`))return;
    const {error}=await client.rpc('review_point_redemption',{p_redemption_id:item.id,p_decision:decision,p_review_note:note||null});
    if(error){notify(error.message);return}notify(decision==='approved'?'兑换已批准并扣除积分':'兑换申请未通过');await loadData();
  }

  async function loadData(){
    const [submissionResult,redemptionResult]=await Promise.all([
      client.from('task_submissions').select('id,username,display_name,task_type,task_key,period_key,status,review_note,points_awarded,submitted_at,reviewed_at,updated_at,points_awarded_by,points_awarded_at').order('submitted_at',{ascending:false}).limit(500),
      client.from('point_redemptions').select('id,user_id,username,display_name,item_name,points_cost,status,review_note,submitted_at,reviewed_by,reviewed_at,updated_at').order('submitted_at',{ascending:false}).limit(500)
    ]);
    if(submissionResult.error){notify(submissionResult.error.message);return}
    if(redemptionResult.error){notify(redemptionResult.error.message);return}
    submissions=submissionResult.data||[];redemptions=redemptionResult.data||[];applyUi();
  }

  function cleanup(){profile=null;submissions=[];redemptions=[];observer?.disconnect();observer=null;if(realtimeChannel){client.removeChannel(realtimeChannel);realtimeChannel=null}q('pointAwardCard')?.classList.add('hidden');q('pointExchangeCard')?.classList.add('hidden')}

  async function initialize(session){
    if(!session){cleanup();return}
    const {data,error}=await client.from('profiles').select('role,username,display_name').eq('id',session.user.id).single();
    if(error){notify(error.message);return}
    profile=data;await loadData();observePage();
    if(realtimeChannel)client.removeChannel(realtimeChannel);
    realtimeChannel=client.channel('points-ledger-ui')
      .on('postgres_changes',{event:'*',schema:'public',table:'task_submissions'},loadData)
      .on('postgres_changes',{event:'*',schema:'public',table:'point_redemptions'},loadData)
      .subscribe();
  }

  function start(){client.auth.getSession().then(({data})=>initialize(data.session));client.auth.onAuthStateChange((event,session)=>{if(event==='SIGNED_IN'||event==='SIGNED_OUT')setTimeout(()=>initialize(session),0)})}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
