interface GreetingPeriod {
  id: string
  startHour: number
  phrases: readonly string[]
}

// Each voice has 25 short lines. Newlines mark natural phrase boundaries.
const VOICE_0 = [
  '打开就算努力？\n前辈真好哄。',
  '嘴硬满分，\n进度还在补考？',
  '又想听夸奖？\n先拿成果来呀。',
  '盯这么久，\n等它自己做完？',
  '计划倒挺满，\n动手倒挺慢。',
  '还在挑字体？\n正文要吃醋啦。',
  '说好马上，\n是哪个马上呀？',
  '又叫最终版？\n上个答应了吗？',
  '才碰到难页，\n就想装断网？',
  '撤销这么熟，\n完成会不会呀？',
  '别藏那处漏字，\n我可没瞎哦。',
  '这么会找借口，\n译文也顺一顺呀。',
  '存盘还要催？\n真会让人操心。',
  '又来回切模式？\n哪种替你干活呀？',
  '敢点已完成，\n不敢再检查？',
  '先做一页嘛，\n吹牛又不算数。',
  '放大了十次，\n成果变多了吗？',
  '进度这么短，\n嘴倒是挺硬。',
  '忙着奖励自己？\n作业交了吗？',
  '这页还不错。\n只夸这一次哦。',
  '看你这么辛苦，\n就认可你一下啦。',
  '比上次好多了，\n不许得意太久。',
  '累了就存盘。\n才不是心疼你。',
  '慢归慢，\n你的认真我看见啦。',
  '这次算你厉害。\n明天也要来哦。',
] as const

const VOICE_1 = [
  '喵，鼠标挺忙，\n你负责围观？',
  '盯着也没用喵，\n进度不吃眼神。',
  '这点活就累啦？\n我趴着都比你忙。',
  '又在摸鱼？\n记得分我一条喵。',
  '图层乱成猫窝，\n还怪我踩键盘？',
  '拿漏字当留白？\n猫都不信喵。',
  '喵，爪子停了，\n借口倒没停。',
  '字体挑半天，\n选妃呢，喵？',
  '这气泡挤得，\n连猫都钻不进。',
  '存盘不会咬你，\n伸爪点一下喵。',
  '又叫最终版？\n九条命都不够改。',
  '这也叫对齐？\n我尾巴都比它直。',
  '刷新有用的话，\n我早拍烂键盘啦。',
  '别戳缩略图了，\n它又不会陪你玩。',
  '猫毛都掉一轮了，\n你还在这一页？',
  '藏起待办干嘛？\n我闻得见喵。',
  '窗口切得真快，\n成果跑哪去了？',
  '这页拖这么久，\n是要孵小猫吗？',
  '爪印都比你多，\n还敢说忙，喵？',
  '这页挺顺眼，\n准你摸一下头。',
  '喵，认真成这样，\n我就不捣乱啦。',
  '累了就歇会儿，\n位置给你留着。',
  '别说没做好，\n我有看见你改喵。',
  '今天还挺可靠，\n尾巴借你碰一下。',
  '保存好了吗？\n那就陪你收工喵。',
] as const

const VOICE_2 = [
  '你缺的不是工具。\n是开始。',
  '计划很完整。\n执行不在其中。',
  '改了文件名。\n内容没有变。',
  '这不是留白。\n这是漏字。',
  '你在切换窗口。\n并没有切入工作。',
  '重复检查借口，\n不如检查译文。',
  '说得很快。\n做得很慢。',
  '放大的是预览。\n不是完成度。',
  '收起待办，\n不等于处理待办。',
  '字号改了七次。\n错字还在。',
  '你的自信，\n比校对早了一步。',
  '不必解释忙碌。\n交付会说明。',
  '难页没有变少。\n只是被你后移了。',
  '命名为最终版，\n不是验收标准。',
  '你并非不会。\n只是还没动手。',
  '这处不叫风格。\n叫没有对齐。',
  '承诺已经收到。\n成果仍未收到。',
  '你的问题很稳定。\n总在明天开始。',
  '看见错误之后，\n沉默不能修好它。',
  '这次没有敷衍。\n我认可。',
  '完成得很扎实。\n不需要谦虚。',
  '速度可以再练。\n认真值得保留。',
  '今天已足够。\n保存，休息。',
  '你确实进步了。\n这是判断，不是安慰。',
  '不必急着否定自己。\n成果有据可查。',
] as const

const VOICE_3 = [
  '主人好厉害！\n一页能玩一整天！',
  '我会装死！\n你会装忙耶！',
  '又是这一页！\n它一定很喜欢你！',
  '我去追球啦！\n你去追死线吧！',
  '你没偷懒呀！\n鼠标一直在跑！',
  '哇，好多最终版！\n每个都没完耶！',
  '我叼回球了！\n你叼回进度了吗？',
  '字体全看过啦？\n那正文认识你吗？',
  '我坐下会有零食！\n你坐着就有进度吗？',
  '别怕，我陪你！\n反正你还没开工！',
  '今天又刷新啦！\n昨天的活还很新！',
  '主人真专一！\n只盯这一页耶！',
  '我能等一整天！\n甲方也可以吗？',
  '你说马上做！\n我昨天也听到啦！',
  '图层好多呀！\n像我打翻的玩具！',
  '我会找漏掉的球！\n你会找漏掉的字吗？',
  '你窗口切得好快！\n活都追不上你！',
  '计划写满啦！\n成果也能写点吗？',
  '这一页还没好？\n那我再睡一觉！',
  '我看见你努力啦！\n尾巴替你鼓掌！',
  '做好一页啦！\n可以开心一下吧！',
  '你累了对不对？\n我陪你休息呀！',
  '慢一点也行！\n我又不会先跑掉！',
  '这里比刚才好了！\n我真的看出来啦！',
  '保存好就回家！\n你今天很棒啦！',
] as const

const PHRASES = [...VOICE_0, ...VOICE_1, ...VOICE_2, ...VOICE_3]

const GREETING_PERIODS: readonly GreetingPeriod[] = [
  { id: 'late-night', startHour: 0, phrases: PHRASES },
  { id: 'early-morning', startHour: 5, phrases: PHRASES },
  { id: 'morning', startHour: 9, phrases: PHRASES },
  { id: 'noon', startHour: 12, phrases: PHRASES },
  { id: 'afternoon', startHour: 14, phrases: PHRASES },
  { id: 'evening', startHour: 18, phrases: PHRASES },
  { id: 'night', startHour: 22, phrases: PHRASES },
]

export function greetingSalutation(date: Date): string {
  const hour = date.getHours()
  if (hour < 5 || hour >= 22) return '夜深了'
  if (hour < 12) return '早上好'
  if (hour < 14) return '中午好'
  if (hour < 18) return '下午好'
  return '晚上好'
}

function stableHash(value: string): number {
  let hash = 0
  for (const character of value) hash = (hash * 31 + character.codePointAt(0)!) >>> 0
  return hash
}

export function greetingSlotForDate(date: Date): number {
  const localDay = Math.floor(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000
  )
  return localDay * 48 + date.getHours() * 2 + (date.getMinutes() >= 30 ? 1 : 0)
}

export function millisecondsUntilNextGreetingSlot(date: Date): number {
  const next = new Date(date.getTime())
  next.setSeconds(0, 0)
  if (date.getMinutes() < 30) next.setMinutes(30)
  else next.setHours(next.getHours() + 1, 0, 0, 0)
  return Math.max(1, next.getTime() - date.getTime())
}

export function greetingForDate(date: Date): string {
  const hour = date.getHours()
  let period = GREETING_PERIODS[0]
  for (const candidate of GREETING_PERIODS) {
    if (hour >= candidate.startHour) period = candidate
  }
  const slot = greetingSlotForDate(date)
  const index =
    (stableHash(period.id) + (slot % period.phrases.length) * 37) % period.phrases.length
  return period.phrases[index]
}

export { GREETING_PERIODS }
