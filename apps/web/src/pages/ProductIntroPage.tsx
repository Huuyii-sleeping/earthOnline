import { Link } from "react-router-dom";
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  ChevronRight,
  ImagePlus,
  Medal,
  MessageSquareText,
  Mic,
  PanelTop,
  Share2,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const process = [
  {
    title: "Capture",
    text: "用对话、图片、语音输入一天里的真实经历。",
  },
  {
    title: "Distill",
    text: "Agent 追问行动、情绪和意义，提炼经历的核心价值。",
  },
  {
    title: "Medalize",
    text: "生成可展示的奖章和可回看的经历详情。",
  },
];

const features = [
  {
    icon: MessageSquareText,
    title: "对话式经历采集",
    text: "用户不需要写完整日记，只要像聊天一样说出今天发生了什么。",
  },
  {
    icon: ImagePlus,
    title: "多模态材料输入",
    text: "照片、文字和语音会成为 Agent 判断经历重点的上下文。",
  },
  {
    icon: Medal,
    title: "经历奖章生成",
    text: "奖章展示概括信息，点击后进入完整情节和意义说明。",
  },
  {
    icon: Share2,
    title: "自主公开展示",
    text: "用户决定哪些奖章公开，哪些经历只保留在自己的档案里。",
  },
];

const examples = ["旅行后", "完成重要任务", "和朋友深聊", "一个普通但值得记住的夜晚"];

export default function ProductIntroPage() {
  return (
    <div className="min-h-screen bg-white text-black">
      <header className="sticky top-0 z-50 border-b border-neutral-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2 text-sm font-semibold">
            <Bot className="h-4 w-4" />
            经历成就官
          </Link>
          <div className="flex items-center gap-2">
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="hidden rounded-md text-neutral-600 hover:text-black sm:inline-flex"
            >
              <Link to="/login">登录</Link>
            </Button>
            <Button asChild size="sm" className="rounded-md bg-black px-3 text-white">
              <Link to="/app">进入产品</Link>
            </Button>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden border-b border-neutral-200">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#f1f1f1_1px,transparent_1px),linear-gradient(to_bottom,#f1f1f1_1px,transparent_1px)] bg-[size:48px_48px]" />
        <div className="relative mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-6xl flex-col px-4 py-12 sm:px-6">
          <div className="mx-auto flex w-fit items-center gap-2 rounded-full border border-neutral-200 bg-white px-3 py-1 text-xs font-medium text-neutral-600 shadow-sm">
            <Sparkles className="h-3.5 w-3.5" />
            Personal experience achievement system
          </div>

          <div className="mx-auto mt-10 max-w-5xl text-center">
            <h1 className="text-balance text-5xl font-semibold leading-[1.02] tracking-[-0.055em] sm:text-7xl lg:text-8xl">
              把真实经历变成
              <br />
              可以展示的成就
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-base leading-8 text-neutral-600 sm:text-lg">
              经历成就官让用户把一天的经历交给 Agent。系统会追问、提炼、生成一枚专属奖章，
              让生活不只是被记录，而是被理解和看见。
            </p>
          </div>

          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button asChild size="lg" className="h-11 rounded-md bg-black px-5 text-white">
              <Link to="/app">
                开始创建经历
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="h-11 rounded-md border-neutral-300 bg-white px-5 text-black"
            >
              <Link to="/settings/agent">配置 Agent</Link>
            </Button>
          </div>

          <div className="mx-auto mt-12 w-full max-w-5xl overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-[0_24px_80px_rgba(0,0,0,0.12)]">
            <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
              <div className="flex items-center gap-2 text-xs font-medium text-neutral-500">
                <PanelTop className="h-3.5 w-3.5" />
                experience-agent.app
              </div>
              <div className="hidden items-center gap-2 text-xs text-neutral-400 sm:flex">
                <span>streaming</span>
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </div>
            </div>

            <div className="grid lg:grid-cols-[1.1fr_0.9fr]">
              <div className="border-b border-neutral-200 p-5 lg:border-b-0 lg:border-r">
                <div className="mb-4 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-neutral-500">
                  <Bot className="h-3.5 w-3.5" />
                  Agent session
                </div>
                <div className="space-y-3">
                  <div className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm leading-6">
                    今天我完成了一次产品测试，发现等待回复太久会影响体验。
                  </div>
                  <div className="rounded-md border border-neutral-200 bg-black px-3 py-2 text-sm leading-6 text-white">
                    这不是普通的测试记录。你的行动是把一个模糊体验问题推进成可验证的产品改进。
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    {["行动", "情绪", "意义"].map((label, index) => (
                      <div key={label} className="rounded-md border border-neutral-200 p-3">
                        <div className="text-xs text-neutral-500">0{index + 1}</div>
                        <div className="mt-6 text-sm font-medium">{label}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="bg-neutral-950 p-5 text-white">
                <div className="mb-4 text-xs font-medium uppercase tracking-[0.16em] text-neutral-400">
                  Generated medal
                </div>
                <div className="flex min-h-[280px] flex-col items-center justify-center rounded-md border border-white/10 bg-[radial-gradient(circle_at_top,#2a2a2a,transparent_42%),#0a0a0a] p-5">
                  <div className="flex h-36 w-36 items-center justify-center rounded-full border border-white/15 bg-white/5">
                    <div className="flex h-24 w-24 flex-col items-center justify-center rounded-full border border-white/20 bg-white text-center text-black">
                      <Medal className="h-7 w-7" />
                      <span className="mt-1 text-[11px] font-semibold">产品校准者</span>
                    </div>
                  </div>
                  <p className="mt-5 max-w-xs text-center text-sm leading-6 text-neutral-300">
                    发现体验阻塞点，并推动它成为一次明确的产品优化。
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="mx-auto mt-8 grid w-full max-w-5xl gap-2 text-xs text-neutral-500 sm:grid-cols-4">
            {examples.map((item) => (
              <div key={item} className="rounded-md border border-neutral-200 bg-white px-3 py-2">
                {item}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <div className="grid gap-4 md:grid-cols-3">
          {process.map((item, index) => (
            <div key={item.title} className="rounded-lg border border-neutral-200 bg-white p-5">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-neutral-500">0{index + 1}</span>
                <CheckCircle2 className="h-4 w-4 text-neutral-500" />
              </div>
              <h2 className="mt-14 text-xl font-semibold tracking-[-0.02em]">{item.title}</h2>
              <p className="mt-3 text-sm leading-6 text-neutral-600">{item.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-y border-neutral-200 bg-neutral-50">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <div className="font-mono text-xs uppercase tracking-[0.18em] text-neutral-500">
              Product surface
            </div>
            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
              介绍页讲清产品，首页继续承载社交流。
            </h2>
            <p className="mt-5 text-sm leading-7 text-neutral-600">
              这个页面只负责介绍产品价值和使用方式。真正进入产品后，用户仍然回到首页的信息流、
              创建经历、个人主页和通知体系。
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {features.map((item) => (
              <div key={item.title} className="rounded-lg border border-neutral-200 bg-white p-5">
                <item.icon className="h-5 w-5" />
                <h3 className="mt-8 text-base font-semibold">{item.title}</h3>
                <p className="mt-3 text-sm leading-6 text-neutral-600">{item.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <div className="rounded-lg border border-black bg-black p-6 text-white sm:p-8">
          <div className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
            <div>
              <div className="font-mono text-xs uppercase tracking-[0.18em] text-neutral-400">
                Build next
              </div>
              <h2 className="mt-5 max-w-3xl text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
                下一步，把 Agent 生成的奖章变成完整可保存的产品闭环。
              </h2>
            </div>
            <Button asChild size="lg" className="h-11 rounded-md bg-white px-5 text-black hover:bg-neutral-200">
              <Link to="/create">
                进入创建页
                <ChevronRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>

          <div className="mt-8 grid gap-3 border-t border-white/15 pt-6 text-sm text-neutral-300 md:grid-cols-3">
            <div className="flex items-center gap-3">
              <Mic className="h-4 w-4" />
              语音输入进入经历创建流程
            </div>
            <div className="flex items-center gap-3">
              <Medal className="h-4 w-4" />
              结构化奖章标题、摘要和详情
            </div>
            <div className="flex items-center gap-3">
              <Share2 className="h-4 w-4" />
              进入个人主页和社交流展示
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
