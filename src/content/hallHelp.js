// Usage guidance, not a source of business state or permissions.
// Reviewed 2026-11-09 against the current Hall entry points.
export const hallHelpArticles = [
  ['start','快速开始','第一次使用聚义厅','从一句需求开始，把沟通、进度和成果留在同一件事里。',['打开「办事」，说明你想完成什么、给谁使用以及期望的成果。','按需补充参考资料，核对需求后再提交。','按页面提示确认承办，在同一事项里补充要求、查看进度和成果。'],'先看看办事页','overview','入门 新手 开始 任务'],
  ['request','办事与沟通','怎样把需求说清楚？','说清目标、使用场景和交付形式，比只说“帮我做一个”更有效。',['例如：为亲子自然观察活动写一份半天的活动方案。','补充人数、时间、风格等限制，并附上已有资料。','需要修改时，在原事项议事中继续补充，不必重复新建。'],'前往办事','overview','提问 聊天 需求'],
  ['progress','事项与成果','事项没有进展，该怎么办？','先查看事项当前状态和最近消息，不要因为等待就重复提交。',['在「事项」找到对应事项并打开。','检查是否有待确认、待补充资料或异常提示。','按页面提供的处理入口继续；结果未知时先核对原操作，不盲目重试。'],'前往事项','tasks','任务 卡住 进度 等待 状态'],
  ['result','事项与成果','生成的文件在哪里查看？','先回到对应事项，查看议事中的成果和相关记录。',['打开「事项」，找到这次办理的事项。','进入议事，查看成果消息与可用的预览入口。','核对内容与版本；查看成果不等于确认验收。'],'前往事项','tasks','文件 下载 结果 成果 图片'],
  ['material','资料与引用','怎样给办事补充参考资料？','在需求或议事的资料入口选取已有资料；不要只在消息里写一个本机路径。',['先到「资料」查看已有文件。','回到需求或议事，从资料入口选择需要引用的文件。','核对所选文件后再发送；取消选择不会提交需求。'],'查看资料','treasure','文件 上传 附件 引用'],
  ['agent','好汉与能力','怎样了解好汉能做什么？','在好汉名册查看能力与当前状态，再决定如何协作。',['打开「我的 → 好汉名册」。','选中好汉，查看能力说明与状态。','能力说明不等于实时可用承诺；以当前页面给出的可用操作为准。'],'查看好汉名册','agents','机器人 智能体 agent 在线 技能'],
  ['reply','办事与沟通','为什么暂时没有收到回复？','没有新消息不一定意味着任务失败，先检查当前会话和页面提示。',['确认正在查看原事项或原密议。','留意连接、处理进度和需要补充信息的提示。','若状态仍不明确，保留问题现象并反馈，不重复发送同一操作。'],'查看事项','tasks','没回复 无响应 离线'],
  ['notice','事项与成果','需要我确认的事情在哪里？','从「我的」中的待办提醒入口查看需要你处理的事项。',['打开「我的」，进入待办提醒。','选择对应事项，阅读具体问题或成果。','按实际提供的操作处理；打开消息本身不代表验收。'],'查看待办提醒','messages','提醒 待办 待办提醒 确认'],
  ['account','账户与设置','账户与授权设置在哪里？','从「我的 → 个人中心」进入；以实际开放的功能为准。',['打开「我的」，选择个人中心。','查看当前可用的账户与授权入口。','不要在反馈或对话中提供密码、密钥或登录凭据。'],'查看个人中心','account','安全 账号 个人中心 钱袋']
].map(([id,category,title,summary,steps,action,target,keywords]) => ({id,category,title,summary,steps,action,target,keywords}))

export const hallHelpCategories = Object.freeze(['办事与沟通', '事项与成果', '资料与引用', '好汉与能力', '账户与设置'])
export const hallHelpPopularIds = Object.freeze(['reply', 'progress', 'result', 'notice'])

export const searchHallHelp = (query = '', category = '') => {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean)
  return hallHelpArticles.filter(article => {
    if (category && article.category !== category) return false
    const text = [article.title, article.summary, article.keywords, article.category, ...article.steps].join(' ').toLocaleLowerCase()
    return terms.every(term => text.includes(term))
  })
}
