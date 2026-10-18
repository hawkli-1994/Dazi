import { localized as l } from '../i18n';
import {
  ArtifactKind,
  DecisionStatus,
  DossierKind,
  FixturePreset,
  MessageDelivery,
  MessageRole,
  PlanStatus,
  ScheduleFrequency,
  WorkStatus,
  type Work,
} from './types';

/** Static, intentionally authored examples. These are never generated or executed. */
const sampleWorks: readonly Work[] = [
  {
    id: 'brand-website',
    title: l('品牌官网焕新', 'A fresh home for the brand'),
    goal: l(
      '整理品牌故事，做一个清晰、有温度的新官网。',
      'Tell our story through a clearer, warmer website.',
    ),
    directory: '~/Projects/brand-website',
    status: WorkStatus.Waiting,
    summary: l(
      '首页的两种方向已经整理好了，想听听你的想法。',
      'Two homepage directions are ready. A little input from you would help.',
    ),
    createdAt: '2026-10-15T08:00:00.000Z',
    updatedAt: '2026-10-18T08:40:00.000Z',
    messages: [
      {
        id: 'brand-message-1',
        role: MessageRole.User,
        content: l(
          '想给我们的品牌官网换一个样子。更轻一点，有呼吸感，也让人一眼明白我们在做什么。',
          'I’d like to refresh our brand website. Something lighter, with room to breathe, that makes what we do immediately clear.',
        ),
        createdAt: '2026-10-17T09:20:00.000Z',
        delivery: MessageDelivery.Sample,
      },
      {
        id: 'brand-message-2',
        role: MessageRole.Assistant,
        content: l(
          '首页的故事线已经理顺了。\n\n我整理了两个方向：一个从产品开始，一个从使用它的人开始。我更倾向第二个，先让访客看见自己，再认识我们。\n\n下面是具体的结构。你选好方向，我们再把细节铺开。',
          'The homepage story is taking shape.\n\nI’ve put together two directions: one starts with the product, the other with the people who use it. I lean toward the second: help visitors see themselves before introducing us.\n\nThe proposed structure is below. Choose a direction and we can work through the details.',
        ),
        createdAt: '2026-10-18T08:40:00.000Z',
        delivery: MessageDelivery.Sample,
        details: [
          l(
            '梳理现有的品牌介绍与三个核心使用场景',
            'Reviewed the brand introduction and three core use cases',
          ),
          l(
            '对比两种信息结构，整理首页内容草稿',
            'Compared two information structures and outlined the homepage',
          ),
          l(
            '保留现有标识；把故事、产品和行动入口重新排序',
            'Kept the existing identity and reordered the story, product, and call to action',
          ),
        ],
      },
    ],
    dossier: [
      {
        id: 'brand-note-1',
        kind: DossierKind.Agreement,
        content: l(
          '保留现有品牌标识，以内容和留白建立新的感觉。',
          'Keep the existing identity. Let content and space create the new feel.',
        ),
        source: l('最初的工作说明', 'Original work brief'),
      },
      {
        id: 'brand-note-2',
        kind: DossierKind.Context,
        content: l(
          '主要读者是刚认识我们的独立创作者和小团队。',
          'The audience is independent creators and small teams meeting us for the first time.',
        ),
        source: l('品牌介绍', 'Brand introduction'),
      },
      {
        id: 'brand-note-3',
        kind: DossierKind.Pitfall,
        content: l(
          '不要堆砌功能。先回答“这和我有什么关系”。',
          'Avoid a wall of features. First answer: “How does this help me?”',
        ),
        source: l('首页内容讨论', 'Homepage discussion'),
      },
    ],
    artifacts: [
      {
        id: 'brand-artifact-1',
        kind: ArtifactKind.Document,
        title: l('首页内容草稿', 'Homepage story draft'),
        path: 'docs/homepage-story.md',
        summary: l(
          '从真实场景开始，讲清产品能带来的改变。',
          'Start with a real situation and show the difference the product makes.',
        ),
        content: l(
          '一个更从容的工作方式\n\n让想法有地方落下，让重要的事情继续向前。\n\n01 · 先看见自己\n用一个熟悉的工作场景，讲清我们想解决的问题。\n\n02 · 看见新的可能\n三个小故事：收拢想法、完成第一稿、把结果交到需要的人手里。\n\n03 · 从一件小事开始\n一个明确的入口，邀请访客开始第一项工作。',
          'A calmer way to work\n\nGive ideas somewhere to land and keep the important things moving.\n\n01 · See yourself\nStart with a familiar work situation and the problem we want to solve.\n\n02 · See what’s possible\nThree small stories: gather an idea, finish a first draft, and share the result with the right person.\n\n03 · Start with something small\nOne clear invitation to begin a first piece of work.',
        ),
      },
      {
        id: 'brand-artifact-2',
        kind: ArtifactKind.Design,
        title: l('页面结构笔记', 'Page structure notes'),
        path: 'design/homepage-outline.md',
        summary: l(
          '两种叙事方向的取舍与布局建议。',
          'Trade-offs and layout notes for two story directions.',
        ),
        content: l(
          '方向 A · 产品先行\n先展示产品界面，适合已了解品类的访客。\n\n方向 B · 人的故事\n先展示熟悉的使用场景，再介绍产品如何帮忙。建议采用这个方向。\n\n共同原则\n保持一个主要行动入口；优先展示真实内容；为阅读留出足够空间。',
          'Direction A · Product first\nLead with the product interface for visitors who already know the category.\n\nDirection B · People first\nStart with a familiar situation, then explain how the product helps. This is the recommended direction.\n\nShared principles\nOne primary call to action, real content, and enough room to read.',
        ),
      },
    ],
    plan: [
      {
        id: 'brand-plan-1',
        title: l('理顺首页的故事线', 'Shape the homepage story'),
        status: PlanStatus.Done,
      },
      {
        id: 'brand-plan-2',
        title: l('一起选定内容方向', 'Choose a direction together'),
        status: PlanStatus.InProgress,
      },
      {
        id: 'brand-plan-3',
        title: l('展开页面细节与移动端布局', 'Develop the details and mobile layout'),
        status: PlanStatus.Pending,
      },
    ],
    decisions: [
      {
        id: 'brand-decision-1',
        title: l('从“使用它的人”开始讲，怎么样？', 'Shall we start with the people who use it?'),
        reason: l(
          '先呈现熟悉的场景，更容易让新访客理解我们能帮上什么忙。',
          'A familiar situation helps new visitors understand what we can help with.',
        ),
        impact: l(
          '会调整首页内容顺序，保留现有品牌标识，不会发布页面。',
          'Reorder the homepage content while keeping the brand identity. No page will be published.',
        ),
        preview: l(
          '真实工作场景 → 三个小故事 → 产品如何帮忙 → 开始第一项工作',
          'A real work situation → Three small stories → How the product helps → Start your first piece of work',
        ),
        approveLabel: l('就从这个方向开始', 'Let’s go with this direction'),
        status: DecisionStatus.Pending,
      },
    ],
    schedule: null,
  },
  {
    id: 'quarterly-review',
    title: l('季度复盘报告', 'A thoughtful quarterly review'),
    goal: l(
      '把这个季度的进展整理成一份清晰、简洁的复盘。',
      'Turn this quarter’s progress into a clear, concise review.',
    ),
    directory: '~/Documents/quarterly-review',
    status: WorkStatus.Done,
    summary: l(
      '复盘初稿整理好了，重点和下一步都放在了前面。',
      'The first draft is ready, with the key findings and next steps up front.',
    ),
    createdAt: '2026-10-12T10:00:00.000Z',
    updatedAt: '2026-10-18T08:15:00.000Z',
    messages: [
      {
        id: 'review-message-1',
        role: MessageRole.User,
        content: l(
          '帮我整理这个季度的复盘，别太长。重点是学到了什么，以及接下来怎么做。',
          'Help me put together a short quarterly review. Focus on what we learned and what to do next.',
        ),
        createdAt: '2026-10-17T11:00:00.000Z',
        delivery: MessageDelivery.Sample,
      },
      {
        id: 'review-message-2',
        role: MessageRole.Assistant,
        content: l(
          '复盘初稿好了。\n\n我把内容收成三个部分：做成的事、学到的事、下一步。零散的过程留在附注里，开头就能看见结论。\n\n你可以在右侧预览完整内容。',
          'The review draft is ready.\n\nIt has three parts: what worked, what we learned, and what comes next. Supporting details are in the notes, so the conclusions are easy to find.\n\nYou can preview it in the side panel.',
        ),
        createdAt: '2026-10-18T08:15:00.000Z',
        delivery: MessageDelivery.Sample,
        details: [
          l(
            '整理访谈记录与项目复盘，归纳三个主题',
            'Reviewed interview notes and project reflections, then grouped them into three themes',
          ),
        ],
      },
    ],
    dossier: [
      {
        id: 'review-note-1',
        kind: DossierKind.Agreement,
        content: l(
          '结论优先，一页能读完，不堆砌数字。',
          'Lead with conclusions, fit on one page, and avoid a wall of numbers.',
        ),
        source: l('工作说明', 'Work brief'),
      },
      {
        id: 'review-note-2',
        kind: DossierKind.Decision,
        content: l(
          '用“做成、学到、下一步”组织报告。',
          'Organize the review around outcomes, lessons, and next steps.',
        ),
        source: l('复盘提纲', 'Review outline'),
      },
    ],
    artifacts: [
      {
        id: 'review-artifact-1',
        kind: ArtifactKind.Document,
        title: l('季度复盘 · 初稿', 'Quarterly review · First draft'),
        path: 'reports/quarterly-review.md',
        summary: l(
          '一页回顾，三件值得带到下个季度的事。',
          'One page, with three things worth carrying into next quarter.',
        ),
        content: l(
          '季度复盘\n\n做成的事\n完成核心体验的第一轮整理，让新用户更快找到下一步。\n\n学到的事\n清晰的入口比更多的功能重要。小范围验证，让讨论更具体。\n\n下一步\n先解决引导流程里最容易卡住的一步，再继续扩展。每两周回看一次真实反馈。\n\n以上为演示内容，不包含真实业务数据。',
          'Quarterly review\n\nWhat worked\nCompleted a first pass on the core experience so new users can find their next step more easily.\n\nWhat we learned\nClear entry points matter more than more features. Small experiments make discussions more concrete.\n\nWhat comes next\nFix the biggest point of friction in onboarding before expanding. Review real feedback every two weeks.\n\nThis is sample content and contains no real business data.',
        ),
      },
    ],
    plan: [
      {
        id: 'review-plan-1',
        title: l('整理本季度的材料', 'Gather this quarter’s material'),
        status: PlanStatus.Done,
      },
      {
        id: 'review-plan-2',
        title: l('完成一页复盘', 'Write a one-page review'),
        status: PlanStatus.Done,
      },
      {
        id: 'review-plan-3',
        title: l('一起看看下季度的优先事项', 'Review next quarter’s priorities together'),
        status: PlanStatus.Pending,
      },
    ],
    decisions: [],
    schedule: null,
  },
  {
    id: 'onboarding-flow',
    title: l('新用户引导体验', 'A gentler first experience'),
    goal: l(
      '让第一次使用产品的人，轻松找到自己的下一步。',
      'Help first-time users find their next step with less effort.',
    ),
    directory: '~/Projects/onboarding',
    status: WorkStatus.Running,
    summary: l(
      '正在梳理第一次打开产品时，最容易卡住的地方。',
      'Looking at where people get stuck when they first open the product.',
    ),
    createdAt: '2026-10-16T07:00:00.000Z',
    updatedAt: '2026-10-18T08:55:00.000Z',
    messages: [
      {
        id: 'onboarding-message-1',
        role: MessageRole.User,
        content: l(
          '新用户好像不太清楚第一步做什么，帮我看看引导可以怎么更自然。',
          'New users don’t seem sure what to do first. Can you look at how onboarding could feel more natural?',
        ),
        createdAt: '2026-10-18T08:30:00.000Z',
        delivery: MessageDelivery.Sample,
      },
      {
        id: 'onboarding-message-2',
        role: MessageRole.Assistant,
        content: l(
          '先从最初的三分钟看起。\n\n目前的线索是：选择太多，而“开始做一件事”的入口不够明确。我把几个关键节点放进了计划，准备逐个梳理。',
          'Let’s start with the first three minutes.\n\nThe current clue is that there are too many choices, while the way to start one piece of work isn’t clear enough. The key moments are now in the plan for review.',
        ),
        createdAt: '2026-10-18T08:55:00.000Z',
        delivery: MessageDelivery.Sample,
      },
    ],
    dossier: [
      {
        id: 'onboarding-note-1',
        kind: DossierKind.Agreement,
        content: l(
          '不增加新的引导弹窗，优先把页面本身讲清楚。',
          'Avoid adding onboarding pop-ups. Make the page itself clearer first.',
        ),
        source: l('工作说明', 'Work brief'),
      },
    ],
    artifacts: [],
    plan: [
      {
        id: 'onboarding-plan-1',
        title: l('梳理首次使用路径', 'Map the first-use journey'),
        status: PlanStatus.InProgress,
      },
      {
        id: 'onboarding-plan-2',
        title: l('找出最值得先改的一步', 'Find the most useful first change'),
        status: PlanStatus.Pending,
      },
      {
        id: 'onboarding-plan-3',
        title: l('整理一版更轻的引导方案', 'Outline a lighter onboarding experience'),
        status: PlanStatus.Pending,
      },
    ],
    decisions: [],
    schedule: null,
  },
  {
    id: 'weekly-insights',
    title: l('每周行业观察', 'A weekly moment to look around'),
    goal: l(
      '收拢值得关注的变化，每周留下一份简短观察。',
      'Gather meaningful changes into a short weekly note.',
    ),
    directory: '~/Documents/weekly-insights',
    status: WorkStatus.Error,
    summary: l(
      '示例任务停在资料整理这一步，可以试试重试。',
      'The sample paused while gathering material. You can try Retry.',
    ),
    createdAt: '2026-10-10T09:00:00.000Z',
    updatedAt: '2026-10-18T07:45:00.000Z',
    messages: [
      {
        id: 'insights-message-1',
        role: MessageRole.User,
        content: l(
          '每周帮我留意一下行业里值得看的变化，简短一点，有自己的重点。',
          'Help me keep an eye on meaningful changes in the industry each week. Keep it short and focused.',
        ),
        createdAt: '2026-10-17T09:00:00.000Z',
        delivery: MessageDelivery.Sample,
      },
      {
        id: 'insights-message-2',
        role: MessageRole.Assistant,
        content: l(
          '这是一条中断状态的示例。资料整理还没完成，已有的工作档案和计划都保留在这里。\n\n点击重试，可以查看界面的暂存状态；演示不会实际获取资料。',
          'This is an example of an interrupted task. The research is unfinished, but the work notes and plan are still here.\n\nChoose Retry to see the UI’s saved state. The demo does not actually fetch any material.',
        ),
        createdAt: '2026-10-18T07:45:00.000Z',
        delivery: MessageDelivery.Sample,
      },
    ],
    dossier: [
      {
        id: 'insights-note-1',
        kind: DossierKind.Agreement,
        content: l(
          '每周最多三个重点，附上来源，分清事实和判断。',
          'At most three highlights per week. Include sources and separate facts from interpretation.',
        ),
        source: l('最初的约定', 'Original agreement'),
      },
    ],
    artifacts: [],
    plan: [
      {
        id: 'insights-plan-1',
        title: l('整理本周的观察素材', 'Gather this week’s observations'),
        status: PlanStatus.InProgress,
      },
      {
        id: 'insights-plan-2',
        title: l('写下三个值得关注的变化', 'Write down three meaningful changes'),
        status: PlanStatus.Pending,
      },
    ],
    decisions: [],
    schedule: {
      frequency: ScheduleFrequency.Weekly,
      time: '09:00',
      prompt: '整理本周值得关注的三个变化 / Gather three meaningful changes this week',
      enabled: true,
    },
  },
];

export function getFixtures(preset: FixturePreset = FixturePreset.Default): Work[] {
  return preset === FixturePreset.Empty ? [] : (structuredClone(sampleWorks) as Work[]);
}
