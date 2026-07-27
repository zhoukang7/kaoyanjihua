(()=>{
  const config=window.STUDY_APP_CONFIG||{};
  if(!window.supabase||!config.supabaseUrl||!config.supabasePublishableKey)return;

  const client=window.supabase.createClient(
    config.supabaseUrl,
    config.supabasePublishableKey,
    {auth:{persistSession:true,autoRefreshToken:true}}
  );

  let profile=null;
  let observer=null;
  let syncTimer=null;

  const q=id=>document.getElementById(id);
  const isOwner=()=>profile?.role==='owner';
  const isUser1=()=>profile?.username==='user_1';
  const todayText=()=>new Intl.DateTimeFormat('zh-CN',{
    year:'numeric',month:'2-digit',day:'2-digit'
  }).format(new Date());

  function mountStyles(){
    if(q('learningCommunicationStyles'))return;
    const style=document.createElement('style');
    style.id='learningCommunicationStyles';
    style.textContent=`
      .learning-report-guide{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:14px;align-items:center;margin:0 0 16px;padding:16px;border:1px solid #cfe0d5;border-radius:18px;background:linear-gradient(135deg,#f6fbf7,#eaf3ed)}
      .learning-report-guide-label{display:inline-block;margin-bottom:7px;padding:4px 8px;border-radius:99px;background:#fff;color:var(--green);font-size:11px;font-weight:850}
      .learning-report-guide strong{display:block;font-size:16px}
      .learning-report-guide p{margin:7px 0 0;color:var(--muted);font-size:13px;line-height:1.75}
      .learning-report-guide button{white-space:nowrap}
      @media(max-width:560px){.learning-report-guide{grid-template-columns:1fr}.learning-report-guide button{width:100%}}
    `;
    document.head.appendChild(style);
  }

  function ensureSectionOrder(){
    const app=q('app');
    if(!app)return;

    const task=q('taskReviewSection');
    const comments=q('commentsSection');
    const points=q('pointsCenterSection');
    const footer=app.querySelector('footer');

    if(task&&comments&&task.nextElementSibling!==comments){
      task.insertAdjacentElement('afterend',comments);
    }

    if(points&&footer&&points.nextElementSibling!==footer){
      app.insertBefore(points,footer);
    }
  }

  function stabilizeTaskNotice(){
    const original=q('taskReviewNotice');
    if(!original)return;

    original.classList.add('hidden');
    original.setAttribute('aria-hidden','true');

    let stable=q('taskReviewNoticeStable');
    if(!stable){
      stable=document.createElement('div');
      stable.id='taskReviewNoticeStable';
      stable.className='task-review-notice';
      original.insertAdjacentElement('afterend',stable);
    }

    stable.textContent='任务审核只决定任务完成状态和学习进度；任务不会自动产生积分，积分由管理员根据审核结果在积分中心独立发放。';
  }

  function ensureStudyGuide(){
    const section=q('commentsSection');
    if(!section)return;

    const category=q('commentCategory');
    const planOption=category?.querySelector('option[value="plan_adjustment"]');
    if(planOption&&planOption.textContent!=='学习情况 / 计划调整'){
      planOption.textContent='学习情况 / 计划调整';
    }

    if(q('learningReportGuide')){
      updateGuideRole();
      return;
    }

    const head=section.querySelector('.comments-head');
    if(!head)return;

    const guide=document.createElement('div');
    guide.id='learningReportGuide';
    guide.className='learning-report-guide';
    guide.innerHTML=`
      <div>
        <span class="learning-report-guide-label">学习情况申报与积分说明</span>
        <strong id="learningReportTitle">实际学习内容也可以提交审核</strong>
        <p id="learningReportText">若未完成页面中的每日任务，但实际完成了计划外学习、补充复习或与任务要求等量的学习，user_1 可在学习交流中如实说明学习日期、科目、内容、时长或题量及学习成果。admin 审核后，可在积分中心独立决定是否核发积分；提交说明本身不会自动增加积分。</p>
      </div>
      <button id="startLearningReport" class="comments-ghost hidden" type="button">填写学习情况申报</button>`;

    head.insertAdjacentElement('afterend',guide);
    q('startLearningReport')?.addEventListener('click',fillLearningReport);
    updateGuideRole();
  }

  function updateGuideRole(){
    const button=q('startLearningReport');
    const text=q('learningReportText');
    if(!button||!text)return;

    button.classList.toggle('hidden',!isUser1());

    if(isOwner()){
      text.textContent='user_1 可以在此申报未对应每日任务的实际学习内容。请根据学习日期、科目、学习量和成果核实情况；符合要求时，可在页面底部积分中心独立发放积分，并在回复中说明审核结论和核发依据。';
    }else if(isUser1()){
      text.textContent='若未完成页面中的每日任务，但实际完成了计划外学习、补充复习或与任务要求等量的学习，可如实说明学习日期、科目、内容、时长或题量及学习成果。admin 审核后，可在积分中心独立决定是否核发积分；提交说明本身不会自动增加积分。';
    }else{
      text.textContent='学习情况申报用于记录实际学习内容并交由管理员核实。只有 user_1 可以使用快捷申报入口；积分是否发放及发放数量均由 admin 独立决定。';
    }
  }

  function fillLearningReport(){
    if(!isUser1())return;

    const category=q('commentCategory');
    const subject=q('commentSubject');
    const content=q('commentContent');
    if(!category||!subject||!content)return;

    if(content.value.trim()&&!window.confirm('当前内容尚未提交，确认替换为学习情况申报模板？'))return;

    category.value='plan_adjustment';
    subject.value='general';
    content.value=`学习日期：${todayText()}\n学习科目：\n实际学习内容：\n学习时长或完成题量：\n学习成果或完成证明：\n申请说明：`;
    content.dispatchEvent(new Event('input',{bubbles:true}));
    content.focus();
    content.scrollIntoView({behavior:'smooth',block:'center'});
  }

  function syncPage(){
    mountStyles();
    ensureSectionOrder();
    stabilizeTaskNotice();
    ensureStudyGuide();
  }

  function scheduleSync(){
    clearTimeout(syncTimer);
    syncTimer=setTimeout(syncPage,60);
  }

  async function initialize(session){
    profile=null;
    if(session){
      const {data}=await client.from('profiles')
        .select('role,username,display_name')
        .eq('id',session.user.id)
        .single();
      profile=data||null;
    }

    syncPage();

    if(!observer){
      observer=new MutationObserver(scheduleSync);
      observer.observe(document.body,{childList:true,subtree:true});
    }
  }

  function start(){
    mountStyles();
    client.auth.getSession().then(({data})=>initialize(data.session));
    client.auth.onAuthStateChange((event,session)=>{
      if(event==='SIGNED_IN'||event==='SIGNED_OUT')setTimeout(()=>initialize(session),0);
    });
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();
