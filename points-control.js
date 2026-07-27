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

  let profile=null;
  let submissions=[];
  let realtimeChannel=null;
  let observer=null;
  let patchTimer=null;
  let toastTimer=null;

  const q=id=>document.getElementById(id);
  const isOwner=()=>profile?.role==='owner';
  const localDateKey=(date=new Date())=>{
    const year=date.getFullYear();
    const month=String(date.getMonth()+1).padStart(2,'0');
    const day=String(date.getDate()).padStart(2,'0');
    return `${year}-${month}-${day}`;
  };
  const formatTime=value=>new Intl.DateTimeFormat('zh-CN',{
    month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'
  }).format(new Date(value));
  const taskLabel=key=>dailyTasks.find(task=>task.key===key)?.label||key;
  const setText=(element,text)=>{
    if(element&&element.textContent!==text)element.textContent=text;
  };

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

  function mountPointCard(){
    const section=q('taskReviewSection');
    if(!section||q('pointAwardCard'))return;

    const card=document.createElement('article');
    card.id='pointAwardCard';
    card.className='task-review-card hidden';
    card.innerHTML=`
      <div class="task-review-card-head">
        <div>
          <h3>积分发放</h3>
          <p>任务审核与积分分开操作。仅审核通过的每日任务可由管理员手动发放 1 积分。</p>
        </div>
        <button id="refreshPointAwards" class="task-review-ghost" type="button">刷新</button>
      </div>
      <div id="pendingPointList" class="task-review-list"></div>
    `;

    const adminCard=q('adminReviewCard');
    if(adminCard)adminCard.insertAdjacentElement('afterend',card);
    else section.appendChild(card);

    q('refreshPointAwards')?.addEventListener('click',loadSubmissions);
  }

  function patchStaticText(){
    const description=q('taskReviewDescription');
    const adminCard=q('adminReviewCard');
    const notice=q('taskReviewNotice');

    if(isOwner()){
      setText(description,'user_1 的所有勾选必须审核；审核通过后同步任务和学习进度，积分由管理员另行发放。');
      setText(notice,'审核与积分发放是两个独立操作。管理员可在下方对已通过的每日任务单独发放 1 积分。');
    }else if(profile?.username==='user_1'){
      setText(description,'你可以勾选每日任务和每周任务。管理员审核通过后任务才算完成。');
      setText(notice,'每日任务审核通过后计入学习进度；积分是否发放由管理员单独决定。每周任务不计积分。');
    }

    const adminHelp=adminCard?.querySelector('.task-review-card-head p');
    setText(adminHelp,'审核通过会同步主看板；每日任务同步学习进度，但不会自动增加积分。');

    document.querySelectorAll('#pendingReviewList .task-review-primary').forEach(button=>{
      if(button.textContent.includes('+1'))button.textContent='审核通过';
    });

    const metricHelp=q('user1Points')?.closest('.task-review-metric')?.querySelector('small');
    setText(metricHelp,'仅统计管理员已手动发放的积分');
  }

  function renderPointList(){
    mountPointCard();
    const card=q('pointAwardCard');
    const list=q('pendingPointList');
    if(!card||!list)return;

    card.classList.toggle('hidden',!isOwner());
    if(!isOwner())return;

    const waiting=submissions
      .filter(item=>
        item.username==='user_1'&&
        item.task_type==='daily'&&
        item.status==='approved'&&
        Number(item.points_awarded||0)===0
      )
      .sort((a,b)=>new Date(a.reviewed_at||a.submitted_at)-new Date(b.reviewed_at||b.submitted_at));

    if(!waiting.length){
      list.innerHTML='<div class="task-review-empty">目前没有待发放积分的每日任务。</div>';
      return;
    }

    list.replaceChildren(...waiting.map(item=>{
      const row=document.createElement('article');
      row.className='task-review-item';

      const main=document.createElement('div');
      main.className='task-review-item-main';
      const title=document.createElement('strong');
      title.textContent=taskLabel(item.task_key);
      const meta=document.createElement('span');
      meta.textContent=`每日任务 · ${item.period_key} · 审核通过于 ${formatTime(item.reviewed_at||item.updated_at)}`;
      main.append(title,meta);

      const actions=document.createElement('div');
      actions.className='task-review-actions';
      const button=document.createElement('button');
      button.type='button';
      button.className='task-review-primary';
      button.textContent='发放 1 积分';
      button.addEventListener('click',()=>awardPoint(item,button));
      actions.appendChild(button);

      row.append(main,actions);
      return row;
    }));
  }

  function patchTaskBadges(){
    const rows=[...(q('daily')?.querySelectorAll('.task')||[])];
    const today=localDateKey();

    dailyTasks.forEach((task,index)=>{
      const row=rows[index];
      if(!row)return;

      const item=submissions.find(record=>
        record.username==='user_1'&&
        record.task_type==='daily'&&
        record.task_key===task.key&&
        record.period_key===today
      );

      if(!item||item.status!=='approved')return;

      const content=row.children[1];
      if(!content)return;
      let badge=row.querySelector('.task-submission-state');
      if(!badge){
        badge=document.createElement('span');
        content.appendChild(badge);
      }
      badge.className='task-submission-state status-approved';
      setText(
        badge,
        Number(item.points_awarded||0)===1
          ?'已通过 · +1积分'
          :'已通过 · 待发积分'
      );
    });
  }

  function updateMetrics(){
    const total=submissions
      .filter(item=>item.username==='user_1'&&item.task_type==='daily')
      .reduce((sum,item)=>sum+Number(item.points_awarded||0),0);
    setText(q('user1Points'),String(total));
  }

  function observePage(){
    if(!profile)return;
    if(!observer)observer=new MutationObserver(schedulePatch);
    observer.observe(document.body,{childList:true,subtree:true,characterData:true});
  }

  function applyUi(){
    observer?.disconnect();
    mountPointCard();
    patchStaticText();
    renderPointList();
    patchTaskBadges();
    updateMetrics();
    observePage();
  }

  function schedulePatch(){
    clearTimeout(patchTimer);
    patchTimer=setTimeout(applyUi,60);
  }

  async function awardPoint(item,button){
    if(!window.confirm(`确认给“${taskLabel(item.task_key)}”发放 1 积分？`))return;
    button.disabled=true;

    const {error}=await client.rpc('award_task_point',{
      p_submission_id:item.id
    });

    button.disabled=false;
    if(error){
      notify(error.message);
      return;
    }

    notify('已发放 1 积分');
    await loadSubmissions();
  }

  async function loadSubmissions(){
    const {data,error}=await client
      .from('task_submissions')
      .select('id,username,display_name,task_type,task_key,period_key,status,review_note,points_awarded,submitted_at,reviewed_at,updated_at,points_awarded_by,points_awarded_at')
      .order('submitted_at',{ascending:false})
      .limit(500);

    if(error){
      notify(error.message);
      return;
    }

    submissions=data||[];
    applyUi();
  }

  function cleanup(){
    profile=null;
    submissions=[];
    observer?.disconnect();
    observer=null;
    if(realtimeChannel){
      client.removeChannel(realtimeChannel);
      realtimeChannel=null;
    }
    q('pointAwardCard')?.classList.add('hidden');
  }

  async function initialize(session){
    if(!session){
      cleanup();
      return;
    }

    const {data,error}=await client
      .from('profiles')
      .select('role,username,display_name')
      .eq('id',session.user.id)
      .single();

    if(error){
      notify(error.message);
      return;
    }

    profile=data;
    await loadSubmissions();
    observePage();

    if(realtimeChannel)client.removeChannel(realtimeChannel);
    realtimeChannel=client
      .channel('point-awards-ui')
      .on('postgres_changes',{event:'*',schema:'public',table:'task_submissions'},loadSubmissions)
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
