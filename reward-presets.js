(()=>{
  const presets=[
    {points:1,title:'休息 30 分钟',category:'休息',description:'适合完成一个学习时段后的短暂恢复。'},
    {points:2,title:'娱乐 1 小时',category:'休息',description:'可用于看视频、游戏、刷剧或其他自由活动。'},
    {points:3,title:'30 元以内饮品或甜点',category:'饮食',description:'兑换一份饮品、咖啡、甜点或小零食。'},
    {points:5,title:'50 元以内自选餐食',category:'饮食',description:'选择一顿喜欢的餐食作为阶段奖励。'},
    {points:7,title:'休息半天',category:'休息',description:'建议安排在周末或阶段任务完成后。'},
    {points:10,title:'100 元以内礼物',category:'实物',description:'可选择书籍、文具、生活用品或小型数码配件。'},
    {points:15,title:'完整休息一天',category:'休息',description:'建议在重要阶段目标完成后使用。'},
    {points:20,title:'200 元以内阶段奖励',category:'实物',description:'用于较大的阶段性奖励，仍需管理员确认。'}
  ];

  let observer=null;
  let syncTimer=null;

  const q=id=>document.getElementById(id);
  const toNumber=value=>{
    const number=Number(String(value??'').replace(/[^0-9.-]/g,''));
    return Number.isFinite(number)?number:0;
  };

  function redeemablePoints(){
    return Math.max(
      0,
      toNumber(q('availablePointValue')?.textContent)-toNumber(q('pendingPointValue')?.textContent)
    );
  }

  function createPresetButton(preset){
    const button=document.createElement('button');
    button.type='button';
    button.className='points-preset-card';
    button.dataset.points=String(preset.points);
    button.dataset.reward=preset.title;
    button.innerHTML=`
      <span class="points-preset-top">
        <span class="points-preset-category">${preset.category}</span>
        <strong>${preset.points} 积分</strong>
      </span>
      <b>${preset.title}</b>
      <small>${preset.description}</small>
      <span class="points-preset-action">选择并自动填入</span>`;
    button.addEventListener('click',()=>fillPreset(preset,button));
    return button;
  }

  function mountPanel(){
    const requestArea=q('redemptionRequestArea');
    if(!requestArea||q('rewardPresetPanel'))return;

    const panel=document.createElement('section');
    panel.id='rewardPresetPanel';
    panel.className='points-preset-panel hidden';
    panel.innerHTML=`
      <div class="points-preset-heading">
        <div>
          <h4>推荐奖励</h4>
          <p>点击示例只会自动填入兑换内容和积分，不会直接提交。</p>
        </div>
        <span id="presetAvailablePoints" class="points-preset-balance">可兑换 0 分</span>
      </div>
      <div id="rewardPresetGrid" class="points-preset-grid"></div>
      <div class="points-custom-reward">
        <div>
          <strong>没有合适的奖励？</strong>
          <span>可以自定义奖励内容，并自行填写希望使用的积分。</span>
        </div>
        <button id="customRewardButton" class="task-review-ghost" type="button">填写自定义奖励</button>
      </div>
      <div class="points-preset-rules">
        <strong>兑换规则</strong>
        <span>提交后先占用积分，管理员批准后才正式扣分；不通过或撤回会释放占用积分。</span>
      </div>`;

    const grid=panel.querySelector('#rewardPresetGrid');
    presets.forEach(preset=>grid.appendChild(createPresetButton(preset)));
    panel.querySelector('#customRewardButton')?.addEventListener('click',startCustomReward);

    requestArea.insertAdjacentElement('beforebegin',panel);
    bindFormListeners();
  }

  function bindFormListeners(){
    const item=q('redemptionItem');
    const cost=q('redemptionCost');
    if(item&&item.dataset.presetListener!=='1'){
      item.dataset.presetListener='1';
      item.addEventListener('input',syncSelection);
    }
    if(cost&&cost.dataset.presetListener!=='1'){
      cost.dataset.presetListener='1';
      cost.addEventListener('input',syncSelection);
    }
  }

  function fillPreset(preset,button){
    if(button.disabled)return;
    const item=q('redemptionItem');
    const cost=q('redemptionCost');
    if(!item||!cost)return;

    item.value=preset.title;
    cost.value=String(preset.points);
    item.dispatchEvent(new Event('input',{bubbles:true}));
    cost.dispatchEvent(new Event('input',{bubbles:true}));
    syncSelection();
    item.focus({preventScroll:true});
    q('redemptionRequestArea')?.scrollIntoView({behavior:'smooth',block:'nearest'});
  }

  function startCustomReward(){
    const item=q('redemptionItem');
    const cost=q('redemptionCost');
    if(!item||!cost)return;

    item.value='';
    cost.value='1';
    item.dispatchEvent(new Event('input',{bubbles:true}));
    cost.dispatchEvent(new Event('input',{bubbles:true}));
    syncSelection();
    item.focus();
    q('redemptionRequestArea')?.scrollIntoView({behavior:'smooth',block:'nearest'});
  }

  function syncSelection(){
    const currentItem=q('redemptionItem')?.value.trim()||'';
    const currentCost=Number(q('redemptionCost')?.value||0);
    document.querySelectorAll('.points-preset-card').forEach(button=>{
      const selected=button.dataset.reward===currentItem&&Number(button.dataset.points)===currentCost;
      if(button.classList.contains('selected')!==selected){
        button.classList.toggle('selected',selected);
      }
      button.setAttribute('aria-pressed',selected?'true':'false');
    });
  }

  function syncPanel(){
    mountPanel();
    bindFormListeners();

    const panel=q('rewardPresetPanel');
    const requestArea=q('redemptionRequestArea');
    if(!panel||!requestArea)return;

    const isUser1=!requestArea.classList.contains('hidden');
    if(panel.classList.contains('hidden')===isUser1){
      panel.classList.toggle('hidden',!isUser1);
    }
    if(!isUser1)return;

    const redeemable=redeemablePoints();
    const balance=q('presetAvailablePoints');
    const balanceText=`可兑换 ${redeemable} 分`;
    if(balance&&balance.textContent!==balanceText)balance.textContent=balanceText;

    document.querySelectorAll('.points-preset-card').forEach(button=>{
      const points=Number(button.dataset.points||0);
      const disabled=points>redeemable;
      if(button.disabled!==disabled)button.disabled=disabled;
      button.title=disabled?`当前最多可兑换 ${redeemable} 积分`:'点击后自动填入兑换表单';
    });

    syncSelection();
  }

  function scheduleSync(){
    clearTimeout(syncTimer);
    syncTimer=setTimeout(syncPanel,80);
  }

  function start(){
    syncPanel();
    observer=new MutationObserver(scheduleSync);
    observer.observe(document.body,{
      childList:true,
      subtree:true,
      characterData:true,
      attributes:true,
      attributeFilter:['class']
    });
  }

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',start,{once:true});
  }else{
    start();
  }
})();
