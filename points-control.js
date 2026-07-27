(()=>{
  const config=window.STUDY_APP_CONFIG||{};
  if(!window.supabase||!config.supabaseUrl||!config.supabasePublishableKey)return;

  const client=window.supabase.createClient(
    config.supabaseUrl,
    config.supabasePublishableKey,
    {auth:{persistSession:true,autoRefreshToken:true}}
  );

  const redemptionStatus={pending:'待审核',approved:'已兑换',rejected:'未通过'};
  let profile=null;
  let ledger=[];
  let redemptions=[];
  let realtimeChannel=null;
  let observer=null;
  let patchTimer=null;
  let toastTimer=null;

  const q=id=>document.getElementById(id);
  const isOwner=()=>profile?.role==='owner';
  const isUser1=()=>profile?.username==='user_1';
  const setText=(element,text)=>{if(element&&element.textContent!==text)element.textContent=text};
  const formatTime=value=>value?new Intl.DateTimeFormat('zh-CN',{
    year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'
  }).format(new Date(value)):'—';

  const grantedTotal=()=>ledger
    .filter(item=>item.username==='user_1'&&Number(item.amount)>0)
    .reduce((sum,item)=>sum+Number(item.amount||0),0);

  const redeemedTotal=()=>ledger
    .filter(item=>item.username==='user_1'&&Number(item.amount)<0)
    .reduce((sum,item)=>sum+Math.abs(Number(item.amount||0)),0);

  const availablePoints=()=>Math.max(0,ledger
    .filter(item=>item.username==='user_1')
    .reduce((sum,item)=>sum+Number(item.amount||0),0));

  const pendingRedemptionTotal=()=>redemptions
    .filter(item=>item.username==='user_1'&&item.status==='pending')
    .reduce((sum,item)=>sum+Number(item.points_cost||0),0);

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

  function mountPointsCenter(){
    if(q('pointsCenterSection'))return;
    const app=q('app');
    if(!app)return;

    const section=document.createElement('section');
    section.id='pointsCenterSection';
    section.className='task-review-section points-center-section';
    section.innerHTML=`
      <div class="task-review-head">
        <div>
          <h2>积分中心</h2>
          <p>积分由管理员独立控制，与每日任务完成数量无关。</p>
        </div>
        <span id="pointsAccessBadge" class="task-review-access">正在验证</span>
      </div>

      <div class="points-balance-grid">
        <div><span>可用积分</span><strong id="availablePointValue">0</strong></div>
        <div><span>累计发放</span><strong id="grantedPointValue">0</strong></div>
        <div><span>已兑换</span><strong id="redeemedPointValue">0</strong></div>
        <div><span>待审核占用</span><strong id="pendingPointValue">0</strong></div>
      </div>

      <article id="manualGrantCard" class="task-review-card hidden">
        <div class="task-review-card-head">
          <div>
            <h3>管理员独立发放积分</h3>
            <p>输入积分数量并点击按钮即可发放，不需要关联任何任务。</p>
          </div>
          <button id="refreshPointsCenter" class="task-review-ghost" type="button">刷新</button>
        </div>
        <div class="points-admin-grant-form">
          <label>发放积分
            <input id="manualGrantAmount" type="number" min="1" max="9999" step="1" value="1">
          </label>
          <label>发放说明
            <input id="manualGrantNote" maxlength="500" placeholder="例如：本周学习表现优秀">
          </label>
          <button id="manualGrantButton" class="task-review-primary" type="button">发放积分</button>
        </div>
      </article>

      <article id="pointRedemptionCard" class="task-review-card points-exchange-card">
        <div class="task-review-card-head">
          <div>
            <h3>积分兑换</h3>
            <p>user_1 提交兑换申请，管理员批准后才正式扣分。</p>
          </div>
          <button id="refreshRedemptions" class="task-review-ghost" type="button">刷新</button>
        </div>

        <div id="redemptionRequestArea" class="points-redemption-form hidden">
          <label>兑换内容
            <input id="redemptionItem" maxlength="120" placeholder="例如：周末休息半天">
          </label>
          <label>使用积分
            <input id="redemptionCost" type="number" min="1" max="999" step="1" value="1">
          </label>
          <button id="submitRedemption" class="task-review-primary points-redeem-button" type="button">申请兑换</button>
          <p>待审核申请会占用相应积分；管理员审核通过后才真正扣分。</p>
        </div>

        <div id="redemptionReadOnlyNotice" class="task-review-notice hidden">
          只有 user_1 可以申请兑换；其他账号可查看积分与兑换记录。
        </div>

        <div id="redemptionReviewArea" class="hidden">
          <h4>待审核兑换</h4>
          <div id="pendingRedemptionList" class="task-review-list"></div>
        </div>

        <div class="points-history-grid">
          <section>
            <h4>积分发放记录</h4>
            <div id="pointGrantHistory" class="points-history-list"></div>
          </section>
          <section>
            <h4>积分兑换记录</h4>
            <div id="pointRedemptionHistory" class="points-history-list"></div>
          </section>
        </div>
      </article>
    `;

    const taskSection=q('taskReviewSection');
    const commentsSection=q('commentsSection');
    const footer=app.querySelector('footer');
    const anchor=commentsSection||footer;
    if(taskSection)taskSection.insertAdjacentElement('afterend',section);
    else if(anchor)app.insertBefore(section,anchor);
    else app.appendChild(section);

    q('refreshPointsCenter')?.addEventListener('click',loadData);
    q('refreshRedemptions')?.addEventListener('click',loadData);
    q('manualGrantButton')?.addEventListener('click',grantPoints);
    q('submitRedemption')?.addEventListener('click',submitRedemption);
  }

  function patchLegacyTaskUi(){
    const heading=q('taskReviewSection')?.querySelector('.task-review-head h2');
    setText(heading,'任务审核');

    const description=q('taskReviewDescription');
    const notice=q('taskReviewNotice');
    const adminHelp=q('adminReviewCard')?.querySelector('.task-review-card-head p');

    if(isOwner()){
      setText(description,'user_1 的每日和每周任务必须由管理员审核，审核通过后才算完成。');
      setText(notice,'任务审核只影响任务完成和学习进度；积分请在下方积分中心独立发放。');
    }else if(isUser1()){
      setText(description,'你可以勾选每日任务和每周任务，管理员审核通过后才算完成。');
      setText(notice,'任务完成不会自动增加积分；积分由管理员在积分中心独立发放。');
    }else if(profile){
      setText(description,'user_2 保持只读，可以查看任务审核状态，但不能提交任务。');
      setText(notice,'积分由管理员独立控制，与每日任务完成数量无关。');
    }

    setText(adminHelp,'审核通过会同步主看板；每日任务计入学习进度，但不会自动增加积分。');

    document.querySelectorAll('#pendingReviewList .task-review-primary').forEach(button=>{
      if(button.textContent!=='审核通过')button.textContent='审核通过';
    });

    const metric=q('user1Points')?.closest('.task-review-metric');
    setText(metric?.querySelector('span'),'user_1 可用积分');
    setText(metric?.querySelector('small'),'由管理员独立发放，扣除已兑换积分');
    setText(q('user1Points'),String(availablePoints()));

    document.querySelectorAll('.task-submission-state').forEach(badge=>{
      if(badge.textContent.includes('+1积分')||badge.textContent.includes('待发积分')){
        badge.textContent='已通过';
      }
    });
  }

  function renderAccess(){
    const badge=q('pointsAccessBadge');
    q('manualGrantCard')?.classList.toggle('hidden',!isOwner());
    q('redemptionRequestArea')?.classList.toggle('hidden',!isUser1());
    q('redemptionReviewArea')?.classList.toggle('hidden',!isOwner());
    q('redemptionReadOnlyNotice')?.classList.toggle('hidden',isUser1()||isOwner());

    if(isOwner())setText(badge,'管理员 · 可发放与审核');
    else if(isUser1())setText(badge,'user_1 · 可申请兑换');
    else setText(badge,'user_2 · 只读');
  }

  function renderBalances(){
    const available=availablePoints();
    const granted=grantedTotal();
    const redeemed=redeemedTotal();
    const pending=pendingRedemptionTotal();

    setText(q('availablePointValue'),String(available));
    setText(q('grantedPointValue'),String(granted));
    setText(q('redeemedPointValue'),String(redeemed));
    setText(q('pendingPointValue'),String(pending));
    setText(q('user1Points'),String(available));

    const cost=q('redemptionCost');
    if(cost){
      cost.max=String(Math.max(1,available-pending));
      if(Number(cost.value)>Number(cost.max))cost.value=cost.max;
    }
  }

  function renderRedemptionReviews(){
    const list=q('pendingRedemptionList');
    if(!list||!isOwner())return;

    const pending=redemptions
      .filter(item=>item.status==='pending')
      .sort((a,b)=>new Date(a.submitted_at)-new Date(b.submitted_at));

    if(!pending.length){
      list.innerHTML='<div class="task-review-empty">目前没有待审核兑换。</div>';
      return;
    }

    list.replaceChildren(...pending.map(item=>{
      const row=document.createElement('article');
      row.className='task-review-item';

      const main=document.createElement('div');
      main.className='task-review-item-main';
      const title=document.createElement('strong');
      title.textContent=`${item.item_name} · ${item.points_cost} 积分`;
      const meta=document.createElement('span');
      meta.textContent=`${item.display_name||item.username} · ${formatTime(item.submitted_at)}`;
      main.append(title,meta);

      const actions=document.createElement('div');
      actions.className='task-review-actions';

      const reject=document.createElement('button');
      reject.type='button';
      reject.className='task-review-danger';
      reject.textContent='不通过';
      reject.addEventListener('click',()=>reviewRedemption(item,'rejected'));

      const approve=document.createElement('button');
      approve.type='button';
      approve.className='task-review-primary';
      approve.textContent=`批准并扣 ${item.points_cost} 分`;
      approve.addEventListener('click',()=>reviewRedemption(item,'approved'));

      actions.append(reject,approve);
      row.append(main,actions);
      return row;
    }));
  }

  function makeHistoryRow(title,meta,badge,badgeClass=''){
    const row=document.createElement('article');
    row.className='points-history-item';

    const main=document.createElement('div');
    const strong=document.createElement('strong');
    strong.textContent=title;
    const small=document.createElement('span');
    small.textContent=meta;
    main.append(strong,small);

    const status=document.createElement('b');
    status.className=badgeClass;
    status.textContent=badge;

    row.append(main,status);
    return row;
  }

  function renderHistories(){
    const grantList=q('pointGrantHistory');
    const redemptionList=q('pointRedemptionHistory');
    if(!grantList||!redemptionList)return;

    const grants=ledger
      .filter(item=>item.username==='user_1'&&Number(item.amount)>0)
      .sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));

    grantList.replaceChildren(...(grants.length?grants.map(item=>
      makeHistoryRow(
        item.note||'管理员发放积分',
        formatTime(item.created_at),
        `+${item.amount}`,
        'points-positive'
      )
    ):[makeHistoryRow('暂无积分发放记录','管理员点击发放积分后将在这里显示','—')]));

    const history=[...redemptions].sort((a,b)=>new Date(b.submitted_at)-new Date(a.submitted_at));
    redemptionList.replaceChildren(...(history.length?history.map(item=>{
      const status=redemptionStatus[item.status]||item.status;
      const row=makeHistoryRow(
        item.item_name,
        `${item.points_cost} 积分 · ${formatTime(item.submitted_at)}`,
        status,
        item.status==='approved'?'points-negative':`status-${item.status}`
      );

      if(item.status==='pending'&&isUser1()){
        const button=document.createElement('button');
        button.type='button';
        button.className='task-review-ghost';
        button.textContent='撤回';
        button.addEventListener('click',()=>withdrawRedemption(item));
        row.appendChild(button);
      }

      if(item.review_note){
        const note=document.createElement('p');
        note.className='points-history-note';
        note.textContent=`管理员说明：${item.review_note}`;
        row.appendChild(note);
      }

      return row;
    }):[makeHistoryRow('暂无兑换记录','user_1 申请兑换后将在这里显示','—')]));
  }

  function observePage(){
    if(!profile)return;
    if(!observer)observer=new MutationObserver(schedulePatch);
    observer.observe(document.body,{childList:true,subtree:true,characterData:true});
  }

  function applyUi(){
    observer?.disconnect();
    mountPointsCenter();
    patchLegacyTaskUi();
    renderAccess();
    renderBalances();
    renderRedemptionReviews();
    renderHistories();
    observePage();
  }

  function schedulePatch(){
    clearTimeout(patchTimer);
    patchTimer=setTimeout(applyUi,60);
  }

  async function grantPoints(){
    const amount=Number(q('manualGrantAmount')?.value||0);
    const note=q('manualGrantNote')?.value.trim()||'';

    if(!Number.isInteger(amount)||amount<1||amount>9999){
      notify('请输入 1 到 9999 的整数积分');
      return;
    }

    const button=q('manualGrantButton');
    button.disabled=true;
    const {error}=await client.rpc('grant_user_points',{
      p_points:amount,
      p_note:note||null
    });
    button.disabled=false;

    if(error){
      notify(error.message);
      return;
    }

    q('manualGrantAmount').value='1';
    q('manualGrantNote').value='';
    notify(`已向 user_1 发放 ${amount} 积分`);
    await loadData();
  }

  async function submitRedemption(){
    const itemName=q('redemptionItem')?.value.trim()||'';
    const pointsCost=Number(q('redemptionCost')?.value||0);

    if(!itemName){
      notify('请填写兑换内容');
      return;
    }

    if(!Number.isInteger(pointsCost)||pointsCost<1){
      notify('请输入有效的兑换积分');
      return;
    }

    const button=q('submitRedemption');
    button.disabled=true;
    const {error}=await client.rpc('submit_point_redemption',{
      p_item_name:itemName,
      p_points_cost:pointsCost
    });
    button.disabled=false;

    if(error){
      notify(error.message);
      return;
    }

    q('redemptionItem').value='';
    q('redemptionCost').value='1';
    notify('兑换申请已提交，等待管理员审核');
    await loadData();
  }

  async function withdrawRedemption(item){
    if(!window.confirm(`确认撤回“${item.item_name}”兑换申请？`))return;
    const {error}=await client.rpc('withdraw_point_redemption',{
      p_redemption_id:item.id
    });

    if(error){
      notify(error.message);
      return;
    }

    notify('兑换申请已撤回');
    await loadData();
  }

  async function reviewRedemption(item,decision){
    let note=null;

    if(decision==='rejected'){
      note=window.prompt('可填写不通过原因（可留空）：','');
      if(note===null)return;
    }else if(!window.confirm(`确认批准“${item.item_name}”，扣除 ${item.points_cost} 积分？`)){
      return;
    }

    const {error}=await client.rpc('review_point_redemption',{
      p_redemption_id:item.id,
      p_decision:decision,
      p_review_note:note||null
    });

    if(error){
      notify(error.message);
      return;
    }

    notify(decision==='approved'?'兑换已批准并扣除积分':'兑换申请未通过');
    await loadData();
  }

  async function loadData(){
    const [ledgerResult,redemptionResult]=await Promise.all([
      client.from('point_ledger')
        .select('id,user_id,username,display_name,amount,entry_type,note,created_by,source_redemption_id,created_at')
        .order('created_at',{ascending:false})
        .limit(1000),
      client.from('point_redemptions')
        .select('id,user_id,username,display_name,item_name,points_cost,status,review_note,submitted_at,reviewed_by,reviewed_at,updated_at')
        .order('submitted_at',{ascending:false})
        .limit(500)
    ]);

    if(ledgerResult.error){
      notify(ledgerResult.error.message);
      return;
    }

    if(redemptionResult.error){
      notify(redemptionResult.error.message);
      return;
    }

    ledger=ledgerResult.data||[];
    redemptions=redemptionResult.data||[];
    applyUi();
  }

  function cleanup(){
    profile=null;
    ledger=[];
    redemptions=[];
    observer?.disconnect();
    observer=null;

    if(realtimeChannel){
      client.removeChannel(realtimeChannel);
      realtimeChannel=null;
    }

    q('pointsCenterSection')?.classList.add('hidden');
  }

  async function initialize(session){
    if(!session){
      cleanup();
      return;
    }

    const {data,error}=await client.from('profiles')
      .select('role,username,display_name')
      .eq('id',session.user.id)
      .single();

    if(error){
      notify(error.message);
      return;
    }

    profile=data;
    mountPointsCenter();
    q('pointsCenterSection')?.classList.remove('hidden');
    await loadData();
    observePage();

    if(realtimeChannel)client.removeChannel(realtimeChannel);
    realtimeChannel=client.channel('manual-points-ui')
      .on('postgres_changes',{event:'*',schema:'public',table:'point_ledger'},loadData)
      .on('postgres_changes',{event:'*',schema:'public',table:'point_redemptions'},loadData)
      .subscribe();
  }

  function start(){
    client.auth.getSession().then(({data})=>initialize(data.session));
    client.auth.onAuthStateChange((event,session)=>{
      if(event==='SIGNED_IN'||event==='SIGNED_OUT')setTimeout(()=>initialize(session),0);
    });
  }

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',start,{once:true});
  }else{
    start();
  }
})();
