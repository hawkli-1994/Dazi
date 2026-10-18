import type { Language } from './index';
const copy = {
  zh: {
    connected: '工作会自动保存在本机。',
    reconnecting: '正在连接工作进程，已保存的工作不会丢失。',
    chooseFolder: '选择工作目录',
    schedule: '使用电脑本地时间；每周在周一运行。错过时只补最近一次。',
    saved: '已保存',
    configuration: '让搭子开始推进工作。',
    configurationHint: '选择已在本机配置好的模型。密钥不会发送到界面，也不会显示在日志里。',
    model: '工作使用的模型',
    noModel: '请选择模型',
    missingKey: '尚未配置凭据',
    saveModel: '使用这个模型',
    modelSaved: '模型已保存，新工作会使用它。',
    credentials:
      '请在启动桌面应用前，通过供应商支持的环境变量配置凭据，然后重启。不要在对话中粘贴密钥。',
    tools: '工作工具',
    toolsHint:
      '读取、写入、编辑和命令执行由工作进程处理。需要授权的操作会先显示具体内容，等你确认。',
    otherCapabilities: '外部工具连接和技能扩展仍未启用，不会执行界面演示中的配置。',
    localStorage: '对话和工作档案保存在本机数据库。刷新界面会重新连接，不会清空工作。',
    configureFirst: '先到能力页选择可用模型，再开始交代任务。',
  },
  en: {
    connected: 'Work is saved on this computer.',
    reconnecting: 'Connecting to the work process. Saved work is retained.',
    chooseFolder: 'Choose work folder',
    schedule:
      'Uses local computer time; weekly runs on Monday. Only the latest missed slot is caught up.',
    saved: 'Saved',
    configuration: 'Let Dazi start moving work forward.',
    configurationHint:
      'Choose a model configured on this computer. Credentials never enter the interface or logs.',
    model: 'Model for your work',
    noModel: 'Choose a model',
    missingKey: 'Credentials not configured',
    saveModel: 'Use this model',
    modelSaved: 'Model saved. New work will use it.',
    credentials:
      'Before starting the desktop app, configure credentials using the provider’s supported environment variable, then restart. Do not paste keys into conversations.',
    tools: 'Work tools',
    toolsHint:
      'Reading, writing, editing and commands run in the work process. Operations that need approval show their exact content first.',
    otherCapabilities:
      'External tool connections and skill extensions are not enabled; UI-demo configuration is never executed.',
    localStorage:
      'Conversations and work notes are saved in the local database. Refresh reconnects without clearing work.',
    configureFirst: 'Choose an available model in Capabilities before submitting a task.',
  },
} as const;
export function rt(language: Language, key: keyof typeof copy.zh) {
  return copy[language][key];
}
