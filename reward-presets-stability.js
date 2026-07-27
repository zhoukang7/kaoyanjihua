(()=>{
  const config=window.STUDY_APP_CONFIG||{};
  if(!window.supabase||!config.supabaseUrl||!config.supabasePublishableKey)return;

  const client=window.supabase.createClient(
    config.supabaseUrl,
    config.supabasePublishableKey,
    {auth:{persistSession:true,autoRefreshToken:true}}
  );

  const presets=[
    [1,'休息 30 分钟','休息','适合完成一个学习时段后的短暂恢复。'],
    [2,'娱乐 1 小时','休息','可用于看视频、游戏、刷剧或其他自由活动。'],
    [3,'30 元以内饮品或甜点','饮食','兑换一份饮品、咖啡、甜点或小零食。'],
    [5,'50 元以内自选餐食','饮食','选择一顿喜欢的餐食作为阶段奖励。'],
    [7,'休息半天','休息','建议安排在周末或阶段任务完成后。'],
    [10,'100 元以内礼物','实物','可选择书籍、文具、生活用品或小型数码配件。'],
    [15,'完整休息一天','休息','建议在重要阶段目标完成后使用。'],
    [20,'200 元以内阶段奖励','实物','用于较大的阶段性奖励，仍需管理员确认。']
  ];

  let username=null;
  let observer=null;
  let timer=null;
  const q=id=>document.getElementById(id);
  const number=value=>Number(String(value??'0').replace(/[^0-9.-]/g,''))||0;

  function fillReward(points,title){
    const item=q('redemptionItem');
    const cost=q('redemptionCost');
    if(!item||!cost||username!=='user_1')return;
    item.value=title;
    cost.value=String(points);
    item.dispatchEvent(new Event('input',{bubbles:true}));
    cost.dispatchEvent(new Event('input',{bubbles:true}));
    q('redemptionRequestArea')?.scrollIntoView({behavior:'smooth',block:'nearest'});
  }

  function createPanel(form){
    const panel=document.createElement('section');
    panel.id='rewardPresetPanel';
    panel.className='points-preset-panel hidden';
    panel.innerHTML=`
      <div class="points-preset-heading">
        <div><h4>推荐奖励</h4><p>点击示例只会自动填入兑换内容和积分，不会直接提交。</p></div>
        <span id="presetAvailablePoints" class="points-preset-balance">可兑换 0 分</span>
      </div>
      <div id="rewardPresetGrid" class="points-preset-grid"></div>
      <div class="points-custom-reward">
        <div><strong>没有合适的奖励？</strong><span>可以自定义奖励内容，并自行填写希望使用的积分。</span></div>
        <button id="customRewardButton" class="task-review-ghost" type="button">填写自定义奖励</button>
      </div>
      <div class="points-preset-rules"><strong>兑换规则</strong><span>提交后先占用积分，管理员批准后才正式扣分；不通过或撤回会释放占用积分。</span></div>`;

    const grid=panel.querySelector('#rewardPresetGrid');
    presets.forEach(([points,title,category,description])=>{
      const button=document.createElement('button');
      button.type='button';
      button.className='points-preset-card';
      button.dataset.points=String(points);
      button.dataset.reward=title;
      button.innerHTML=`<span class="points-preset-top"><span class="points-preset-category">${category}</span><strong>${points} 积分</strong></span><b>${title}</b><small>${description}</small><span class="points-preset-action">选择并自动填入</span>`;
      button.addEventListener('click',()=>fillReward(points,title));
      grid.appendChild(button);
    });

    panel.querySelector('#customRewardButton')?.addEventListener('click',()=>{
      if(username!=='user_1')return;
      const item=q('redemptionItem');
      const cost=q('redemptionCost');
      if(!item||!cost)return;
      item.value='';
      cost.value='1';
      item.dispatchEvent(new Event('input',{bubbles:true}));
      cost.dispatchEvent(new Event('input',{bubbles:true}));
      item.focus();
    });

    form.insertAdjacentElement('beforebegin',panel);
    return panel;
  }

  function sync(){
    const form=q('redemptionRequestArea');
    const card=q('pointRedemptionCard');
    if(!form||!card)return;

    let panel=q('rewardPresetPanel');
    if(!panel)panel=createPanel(form);
    if(panel.nextElementSibling!==form)form.insertAdjacentElement('beforebegin',panel);

    const visible=username==='user_1';
    panel.classList.toggle('hidden',!visible);
    if(!visible)return;

    form.classList.remove('hidden');
    const redeemable=Math.max(0,number(q('availablePointValue')?.textContent)-number(q('pendingPointValue')?.textContent));
    const balance=q('presetAvailablePoints');
    if(balance)balance.textContent=`可兑换 ${redeemable} 分`;

    panel.querySelectorAll('.points-preset-card').forEach(button=>{
      const required=Number(button.dataset.points||0);
      button.disabled=required>redeemable;
      button.title=button.disabled?`当前最多可兑换 ${redeemable} 积分`:'点击后自动填入兑换表单';
    });
  }

  function schedule(){
    clearTimeout(timer);
    timer=setTimeout(sync,100);
  }

  async function initialize(session){
    username=null;
    if(session){
      const {data}=await client.from('profiles').select('username').eq('id',session.user.id).single();
      username=data?.username||null;
    }
    sync();
    if(!observer){
      observer=new MutationObserver(schedule);
      observer.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['class']});
    }
  }

  function start(){
    client.auth.getSession().then(({data})=>initialize(data.session));
    client.auth.onAuthStateChange((event,session)=>{
      if(event==='SIGNED_IN'||event==='SIGNED_OUT')setTimeout(()=>initialize(session),0);
    });
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();
