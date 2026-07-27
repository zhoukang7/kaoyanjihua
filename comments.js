(()=>{
  const config=window.STUDY_APP_CONFIG||{};
  if(!window.supabase||!config.supabaseUrl||!config.supabasePublishableKey)return;

  const labels={
    category:{suggestion:'建议',question:'问题',encouragement:'鼓励',plan_adjustment:'计划调整'},
    subject:{general:'综合',math:'数学',english:'英语',politics:'政治',control822:'822 控制工程',daily:'今日任务',weekly:'本周任务'},
    status:{pending:'待处理',replied:'已回复',adopted:'已采纳',not_adopted:'未采纳'}
  };
  const client=window.supabase.createClient(config.supabaseUrl,config.supabasePublishableKey,{auth:{persistSession:true,autoRefreshToken:true}});
  let currentUser=null,profile=null,comments=[],channel=null,toastTimer=null;

  const q=id=>document.getElementById(id);
  const formatTime=value=>new Intl.DateTimeFormat('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value));
  const isOwner=()=>profile?.role==='owner';
  const notify=text=>{let box=q('commentsToast');if(!box){box=document.createElement('div');box.id='commentsToast';box.className='comments-toast';box.setAttribute('role','status');box.setAttribute('aria-live','polite');document.body.appendChild(box)}clearTimeout(toastTimer);box.textContent=text;box.classList.add('show');toastTimer=setTimeout(()=>box.classList.remove('show'),2600)};

  function mount(){
    if(q('commentsSection'))return;
    const app=q('app');if(!app)return;
    const footer=app.querySelector('footer');
    const section=document.createElement('section');section.id='commentsSection';section.className='comments-section';section.innerHTML=`
      <div class="comments-head"><div><h2>学习交流</h2><p>查看账号可以提交建议和问题；管理员负责回复、采纳或说明处理结果。</p></div><span id="commentsCount" class="comments-count">正在读取评论</span></div>
      <div class="comments-shell">
        <article class="comments-card comments-form-card">
          <div class="comments-title-row"><h3>提交意见</h3><span class="comments-badge">所有登录用户</span></div>
          <div class="comments-form-grid">
            <div class="comments-field"><label for="commentCategory">类型</label><select id="commentCategory"><option value="suggestion">建议</option><option value="question">问题</option><option value="encouragement">鼓励</option><option value="plan_adjustment">计划调整</option></select></div>
            <div class="comments-field"><label for="commentSubject">关联内容</label><select id="commentSubject"><option value="general">综合</option><option value="math">数学</option><option value="english">英语</option><option value="politics">政治</option><option value="control822">822 控制工程</option><option value="daily">今日任务</option><option value="weekly">本周任务</option></select></div>
          </div>
          <div class="comments-field"><label for="commentContent">意见内容</label><textarea id="commentContent" maxlength="2000" placeholder="例如：今天的数学题量偏大，建议调整为20题，并在周末补齐。"></textarea></div>
          <div class="comments-submit-row"><span id="commentLength" class="comments-helper">0 / 2000</span><button id="submitComment" class="comments-primary" type="button">提交意见</button></div>
          <p class="comments-helper">评论会显示账号名称。普通用户只能修改或删除自己尚未处理的评论。</p>
        </article>
        <div>
          <div class="comments-toolbar"><label>学科<select id="commentFilterSubject"><option value="all">全部</option><option value="general">综合</option><option value="math">数学</option><option value="english">英语</option><option value="politics">政治</option><option value="control822">822</option><option value="daily">今日任务</option><option value="weekly">本周任务</option></select></label><label>状态<select id="commentFilterStatus"><option value="all">全部</option><option value="pending">待处理</option><option value="replied">已回复</option><option value="adopted">已采纳</option><option value="not_adopted">未采纳</option></select></label><button id="refreshComments" class="comments-ghost" type="button">刷新</button></div>
          <div id="commentList" class="comments-list"><div class="comments-empty">正在读取交流内容…</div></div>
        </div>
      </div>`;
    if(footer)app.insertBefore(section,footer);else app.appendChild(section);
    q('submitComment').addEventListener('click',submitComment);
    q('refreshComments').addEventListener('click',loadComments);
    q('commentFilterSubject').addEventListener('change',renderComments);
    q('commentFilterStatus').addEventListener('change',renderComments);
    q('commentContent').addEventListener('input',event=>{q('commentLength').textContent=`${event.target.value.length} / 2000`});
  }

  async function initialize(session){
    mount();
    if(!session){currentUser=profile=null;comments=[];renderComments();return}
    currentUser=session.user;
    const {data,error}=await client.from('profiles').select('role,username,display_name').eq('id',currentUser.id).single();
    if(error){q('commentList').innerHTML='<div class="comments-empty">评论权限读取失败。</div>';return}
    profile=data;
    await loadComments();
    if(channel)client.removeChannel(channel);
    channel=client.channel('comments-module-live').on('postgres_changes',{event:'*',schema:'public',table:'comments'},()=>loadComments()).subscribe();
  }

  async function loadComments(){
    if(!currentUser)return;
    q('commentsCount').textContent='正在读取评论';
    const {data,error}=await client.from('comments').select('*').order('created_at',{ascending:false}).limit(200);
    if(error){q('commentList').innerHTML=`<div class="comments-empty">评论读取失败：${escapeHtml(error.message)}</div>`;q('commentsCount').textContent='评论读取失败';return}
    comments=data||[];renderComments();
  }

  function renderComments(){
    const list=q('commentList');if(!list)return;
    if(!currentUser){list.innerHTML='<div class="comments-empty">登录后可查看学习交流。</div>';q('commentsCount').textContent='';return}
    const subject=q('commentFilterSubject').value,status=q('commentFilterStatus').value;
    const filtered=comments.filter(item=>(subject==='all'||item.subject===subject)&&(status==='all'||item.status===status));
    const pending=comments.filter(item=>item.status==='pending').length;
    q('commentsCount').textContent=`${comments.length} 条意见 · ${pending} 条待处理`;
    list.innerHTML='';
    if(!filtered.length){list.innerHTML='<div class="comments-empty">暂无符合条件的评论。</div>';return}
    filtered.forEach(item=>list.appendChild(createCommentNode(item)));
  }

  function createCommentNode(item){
    const article=document.createElement('article');article.className='comment-item';
    const own=item.author_id===currentUser.id,canEdit=own&&item.status==='pending';
    article.innerHTML=`<div class="comment-top"><div class="comment-author"><div class="comment-avatar">${escapeHtml((item.author_display_name||item.author_username||'用').slice(0,1))}</div><div class="comment-meta"><strong>${escapeHtml(item.author_display_name||item.author_username)}</strong><small>@${escapeHtml(item.author_username)} · ${formatTime(item.created_at)}</small></div></div><span class="comment-status ${escapeHtml(item.status)}">${labels.status[item.status]||item.status}</span></div><div class="comment-tags"><span class="comment-tag">${labels.category[item.category]||item.category}</span><span class="comment-tag">${labels.subject[item.subject]||item.subject}</span></div><p class="comment-content"></p>`;
    article.querySelector('.comment-content').textContent=item.content;
    if(item.admin_reply){const reply=document.createElement('div');reply.className='comment-admin-reply';const title=document.createElement('strong');title.textContent='管理员回复';const body=document.createElement('div');body.style.whiteSpace='pre-wrap';body.textContent=item.admin_reply;reply.append(title,body);article.appendChild(reply)}
    const actions=document.createElement('div');actions.className='comment-actions';
    if(canEdit)actions.append(makeButton('编辑','comments-small',()=>showEdit(article,item)),makeButton('删除','comments-danger',()=>deleteComment(item)));
    if(isOwner())actions.append(makeButton(item.admin_reply?'修改处理':'回复处理','comments-small',()=>showReply(article,item)),makeButton('管理员删除','comments-danger',()=>deleteComment(item)));
    if(actions.childNodes.length)article.appendChild(actions);
    return article;
  }

  function makeButton(text,className,handler){const button=document.createElement('button');button.type='button';button.className=className;button.textContent=text;button.addEventListener('click',handler);return button}

  function showEdit(article,item){
    article.querySelector('.comment-edit-panel')?.remove();
    const panel=document.createElement('div');panel.className='comment-edit-panel';
    const textarea=document.createElement('textarea');textarea.maxLength=2000;textarea.value=item.content;
    const actions=document.createElement('div');actions.className='comment-actions';
    actions.append(makeButton('取消','comments-ghost',()=>panel.remove()),makeButton('保存修改','comments-primary',async()=>{const content=textarea.value.trim();if(!content){notify('评论内容不能为空');return}const {error}=await client.from('comments').update({content}).eq('id',item.id);if(error)notify(error.message);else{notify('评论已修改');panel.remove();loadComments()}}));
    panel.append(textarea,actions);article.appendChild(panel);textarea.focus();
  }

  function showReply(article,item){
    article.querySelector('.comment-reply-panel')?.remove();
    const panel=document.createElement('div');panel.className='comment-reply-panel';
    const textarea=document.createElement('textarea');textarea.maxLength=2000;textarea.placeholder='填写管理员回复；选择“待处理”时可以暂不回复。';textarea.value=item.admin_reply||'';
    const row=document.createElement('div');row.className='comment-reply-row';
    const select=document.createElement('select');
    Object.entries(labels.status).forEach(([value,text])=>{const option=document.createElement('option');option.value=value;option.textContent=text;option.selected=item.status===value;select.appendChild(option)});
    const actions=document.createElement('div');actions.className='comment-actions';actions.style.marginTop='0';
    actions.append(makeButton('取消','comments-ghost',()=>panel.remove()),makeButton('保存处理','comments-primary',async()=>{const reply=textarea.value.trim()||null,status=select.value;if(status==='replied'&&!reply){notify('“已回复”状态需要填写回复内容');return}const payload={status,admin_reply:reply,admin_replied_by:reply?currentUser.id:null,admin_replied_at:reply?new Date().toISOString():null};const {error}=await client.from('comments').update(payload).eq('id',item.id);if(error)notify(error.message);else{notify('处理结果已保存');panel.remove();loadComments()}}));
    row.append(select,actions);panel.append(textarea,row);article.appendChild(panel);textarea.focus();
  }

  async function deleteComment(item){if(!confirm('确认删除这条评论？'))return;const {error}=await client.from('comments').delete().eq('id',item.id);if(error)notify(error.message);else{notify('评论已删除');loadComments()}}

  async function submitComment(){
    if(!currentUser){notify('请先登录');return}
    const content=q('commentContent').value.trim();if(!content){notify('请填写意见内容');return}
    const button=q('submitComment');button.disabled=true;
    const subject=q('commentSubject').value;
    const payload={category:q('commentCategory').value,subject,target_type:subject==='daily'?'daily_task':subject==='weekly'?'weekly_task':subject==='general'?'general':'subject',target_key:null,content};
    const {error}=await client.from('comments').insert(payload);button.disabled=false;
    if(error){notify(error.message);return}
    q('commentContent').value='';q('commentLength').textContent='0 / 2000';notify('意见已提交');loadComments();
  }

  function escapeHtml(value){return String(value??'').replace(/[&<>"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[char]))}

  const start=()=>{mount();client.auth.getSession().then(({data})=>initialize(data.session));client.auth.onAuthStateChange((event,session)=>{if(event==='SIGNED_OUT'||event==='SIGNED_IN')setTimeout(()=>initialize(session),0)})};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();