import type { Metadata } from "next";
import Link from "next/link";

import { requirePermission } from "@/server/auth/rbac";

import { PrintButton } from "./PrintButton";

export const metadata: Metadata = {
  title: "Operations manual",
  robots: { index: false, follow: false },
};

/**
 * Staff-facing order-handling manual, written in Chinese for the operations
 * team. Deliberately omits bank payout details: settlement account data is
 * shared only in the private WhatsApp conversation, never in stored pages.
 */

function StatusPill({
  tone,
  children,
}: {
  tone: "neutral" | "blue" | "green" | "amber" | "red";
  children: React.ReactNode;
}) {
  const tones = {
    neutral: "bg-ink-900/[0.06] text-muted",
    blue: "bg-sky-100 text-sky-800",
    green: "bg-emerald-100 text-emerald-800",
    amber: "bg-amber-100 text-amber-800",
    red: "bg-red-100 text-red-800",
  } as const;
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 font-mono text-xs font-semibold ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

function Callout({
  tone,
  label,
  children,
}: {
  tone: "danger" | "warn" | "tip";
  label: string;
  children: React.ReactNode;
}) {
  const tones = {
    danger: "border-red-600 bg-red-50 [&>strong]:text-red-700",
    warn: "border-amber-600 bg-amber-50 [&>strong]:text-amber-800",
    tip: "border-sage-600 bg-sage-50 [&>strong]:text-sage-700",
  } as const;
  return (
    <div className={`rounded-lg border-l-4 px-5 py-4 text-sm ${tones[tone]}`}>
      <strong className="mb-1 block">{label}</strong>
      <div className="text-ink-900/80">{children}</div>
    </div>
  );
}

const FLOW_STEPS = [
  "客户下单",
  "客户 WhatsApp 联系并汇款",
  "① 后台确认收到钱",
  "② 创建发货单",
  "③ 填物流单号",
  "④ 签收完成",
] as const;

const SHIPMENT_TRANSITIONS = [
  { from: "DRAFT(草稿)", fromTone: "neutral", to: "已出单 / 已在途 / 取消" },
  { from: "LABEL_CREATED(已出单)", fromTone: "blue", to: "已在途 / 取消" },
  { from: "IN_TRANSIT(运输中)", fromTone: "blue", to: "已签收 / 异常 / 退回" },
  { from: "EXCEPTION(异常)", fromTone: "amber", to: "恢复在途 / 已签收 / 退回" },
  { from: "DELIVERED(已签收)", fromTone: "green", to: "退回(仅客户退货时)" },
] as const;

const ORDER_STATUSES = [
  {
    status: "PENDING_PAYMENT",
    tone: "amber",
    meaning: "已下单,还没确认收款",
    action: "等客户汇款,到账后批准",
  },
  {
    status: "CONFIRMED",
    tone: "green",
    meaning: "付款已确认",
    action: "安排发货",
  },
  {
    status: "PROCESSING",
    tone: "blue",
    meaning: "发货处理中",
    action: "跟进物流",
  },
  {
    status: "COMPLETED",
    tone: "green",
    meaning: "已完成",
    action: "无需处理",
  },
  { status: "CANCELED", tone: "red", meaning: "已取消", action: "无需处理" },
] as const;

const PAYMENT_STATUSES = [
  { status: "UNPAID", tone: "neutral", meaning: "未付款" },
  {
    status: "PENDING / REVIEW_REQUIRED",
    tone: "amber",
    meaning: "客户提交了付款信息,等我们核对",
  },
  { status: "PAID", tone: "green", meaning: "已收到全款" },
  {
    status: "PARTIALLY_PAID",
    tone: "amber",
    meaning: "只收到部分款项,联系客户补齐",
  },
  {
    status: "PARTIALLY_REFUNDED / REFUNDED",
    tone: "red",
    meaning: "已退部分 / 全部款项(正常显示,不是报错)",
  },
] as const;

export default async function AdminManualPage() {
  await requirePermission("orders.read", "/admin/manual");

  return (
    <section className="section-y bg-surface-warm print:bg-white">
      <div className="container-x max-w-4xl space-y-12">
        <header className="space-y-4">
          <Link
            href="/admin"
            className="text-sm font-semibold text-sage-700 print:hidden"
          >
            ← Administration
          </Link>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="font-mono text-eyebrow uppercase text-sage-600">
                内部资料 · 请勿外传
              </p>
              <h1 className="mt-3 text-h2 text-strong">订单处理操作手册</h1>
              <p className="mt-2 text-sm text-muted">
                适用对象:后台运营人员 · 更新日期 2026-07-25 ·
                如流程有变更以负责人通知为准
              </p>
            </div>
            <PrintButton />
          </div>
        </header>

        <div className="space-y-3 rounded-xl border border-ink-900/10 bg-white p-6">
          <h2 className="text-h4 text-strong">一张图看懂整个流程</h2>
          <p className="text-body">
            客户在网站下单后<strong>不会自动付款</strong>
            ——目前只收手工电汇(Wire Transfer),客户通过 WhatsApp
            联系我们获取收款账号。每一单都需要人工处理,主线只有四步:
          </p>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {FLOW_STEPS.map((step, index) => (
              <span key={step} className="flex items-center gap-2">
                {index > 0 ? <span className="text-muted">→</span> : null}
                <span className="rounded-md bg-sage-50 px-3 py-1 font-semibold text-sage-700">
                  {step}
                </span>
              </span>
            ))}
          </div>
          <dl className="mt-4 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="font-semibold text-strong">公司 WhatsApp</dt>
            <dd>
              +81 80 4051 5888(客户付款页上的按钮直接跳到这个号码)
            </dd>
            <dt className="font-semibold text-strong">订单号格式</dt>
            <dd>
              <code className="rounded bg-ink-900/[0.06] px-1.5 py-0.5 font-mono text-xs">
                FM-日期-随机码
              </code>
              ,例如 FM-20260725-8K3QZ2。客户在 WhatsApp 里报的就是这个号。
            </dd>
            <dt className="font-semibold text-strong">运费规则</dt>
            <dd>
              1–4 盒收 $90;之后每多 1–4 盒加 $15(如 5–8 盒 $105,9–12 盒
              $120)。系统结账时自动算好,无需手工计算。
            </dd>
          </dl>
        </div>

        <div className="space-y-4">
          <h2 className="text-h3 text-strong">登录后台</h2>
          <ol className="list-decimal space-y-2 pl-6 text-body">
            <li>
              打开 flintmarrow.com/admin,用自己的管理员账号登录。
            </li>
            <li>
              没有账号或提示无权限?找负责人开通——普通注册账号进不了后台,必须由管理员单独授权。
            </li>
            <li>
              登录后看到的第一页是 Overview(总览),上面的数字卡片就是待办事项。
            </li>
          </ol>
          <Callout tone="tip" label="提示:前台和后台是两个界面">
            如果点着点着跳到了商城前台,点后台顶部导航右侧的 Storefront
            入口旁的返回,或直接在地址栏输入 /admin 即可回来。
          </Callout>
        </div>

        <div className="space-y-4">
          <h2 className="text-h3 text-strong">第 1 步 · 发现新订单</h2>
          <p className="text-body">
            每天上班第一件事:看 Overview 页的{" "}
            <strong>Payment review(付款审核)</strong>卡片。数字不是
            0,就说明有客户在等确认。
          </p>
          <ul className="list-disc space-y-2 pl-6 text-body">
            <li>点卡片进入订单列表,列表已自动筛出「等待付款审核」的订单。</li>
            <li>
              也可以进 Orders(订单)菜单看全部订单;刚下的新单显示为{" "}
              <StatusPill tone="amber">PENDING_PAYMENT</StatusPill>(待付款)。
            </li>
            <li>点订单号进入订单详情页——后面所有操作都在详情页里完成。</li>
          </ul>
          <p className="text-body">
            详情页需要核对的信息:商品和数量、金额(商品小计 +
            运费)、收货地址(只支持美国地址)、客户留言。
          </p>
        </div>

        <div className="space-y-4">
          <h2 className="text-h3 text-strong">
            第 2 步 · 核对并确认付款(最关键的一步)
          </h2>
          <p className="text-body">
            客户会通过 WhatsApp 发来汇款回执。此时你要做的是:
          </p>
          <ol className="list-decimal space-y-2 pl-6 text-body">
            <li>
              <strong>先查银行账户,确认钱真的到账了。</strong>
              核对三样:金额是否等于订单总额(含运费)、汇款人姓名、订单号。
            </li>
            <li>
              回到订单详情页,找到付款审核区域,选择{" "}
              <strong>批准(Approve)</strong>。
            </li>
            <li>
              批准后订单自动变为{" "}
              <StatusPill tone="green">CONFIRMED / PAID</StatusPill>
              ,可以安排发货了。
            </li>
          </ol>
          <Callout tone="danger" label="红线:截图不等于到账">
            汇款截图、转账凭证、客户口头承诺,
            <strong>都不能作为确认依据</strong>
            。必须在银行账户里看到这笔钱,才能点批准。金额不符、查无此款的,选择拒绝(Reject)并在
            WhatsApp 里跟客户说明。
          </Callout>
          <Callout tone="warn" label="收款账号只在 WhatsApp 私聊里发">
            银行账号不放在网站上。客户问怎么付款,在 WhatsApp
            里把收款信息发给他,并让他汇款时备注订单号。
          </Callout>
        </div>

        <div className="space-y-4">
          <h2 className="text-h3 text-strong">
            第 3 步 · 创建发货单、填写物流
          </h2>
          <p className="text-body">
            只有<strong>已确认付款</strong>
            的订单才能正常发货(系统也会拦:没付款的订单,发货单只能取消,不能推进)。
          </p>
          <ol className="list-decimal space-y-2 pl-6 text-body">
            <li>
              进入 Fulfillment(发货)菜单,找到对应订单,点 Create
              shipment(创建发货单)。
            </li>
            <li>
              选择承运商(Carrier)。第一次用某家快递(如
              USPS、FedEx)时先在发货模块里把它建好,以后直接选。
            </li>
            <li>
              仓库打包、贴单后,把物流单号(Tracking
              number)填进发货单,状态改为{" "}
              <StatusPill tone="blue">LABEL_CREATED</StatusPill>(已出单)或直接{" "}
              <StatusPill tone="blue">IN_TRANSIT</StatusPill>(已交给快递)。
            </li>
          </ol>
          <Callout tone="tip" label="一单可以拆多个包裹">
            盒数多需要分箱时,可以在同一个发货单里添加多个包裹(Package),也可以创建多个发货单,各自有自己的单号。
          </Callout>
        </div>

        <div className="space-y-4">
          <h2 className="text-h3 text-strong">
            第 4 步 · 更新物流状态直到签收
          </h2>
          <p className="text-body">
            目前是手工录入物流进度:在发货单里添加跟踪事件(Tracking
            event)或直接改状态。状态只能按下面的方向走,不能跳回去:
          </p>
          <div className="overflow-x-auto rounded-lg border border-ink-900/10">
            <table className="w-full bg-white text-sm">
              <thead>
                <tr className="bg-surface-warm text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-2.5">当前状态</th>
                  <th className="px-4 py-2.5">可以改成</th>
                </tr>
              </thead>
              <tbody>
                {SHIPMENT_TRANSITIONS.map((row) => (
                  <tr
                    key={row.from}
                    className="border-t border-ink-900/[0.06]"
                  >
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <StatusPill tone={row.fromTone}>{row.from}</StatusPill>
                    </td>
                    <td className="px-4 py-2.5">{row.to}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="list-disc space-y-2 pl-6 text-body">
            <li>
              包裹显示妥投后,把发货单改为{" "}
              <StatusPill tone="green">DELIVERED</StatusPill>
              ,订单随之完成。
            </li>
            <li>
              快递出问题(地址错误、包裹滞留)时改为{" "}
              <StatusPill tone="amber">EXCEPTION</StatusPill>
              ,处理好再改回在途。
            </li>
          </ul>
        </div>

        <div className="space-y-4">
          <h2 className="text-h3 text-strong">退款处理</h2>
          <p className="text-body">
            客户要求退款、或多汇了钱需要退差额时:
          </p>
          <ol className="list-decimal space-y-2 pl-6 text-body">
            <li>
              先在 WhatsApp 里和客户确认退款金额和退回方式,
              <strong>并经负责人同意</strong>。
            </li>
            <li>
              银行实际打款后,在订单详情页的退款区域记录这笔退款(可部分退、可全额退)。
            </li>
            <li>
              记录后订单付款状态会显示{" "}
              <StatusPill tone="red">PARTIALLY_REFUNDED</StatusPill> 或{" "}
              <StatusPill tone="red">REFUNDED</StatusPill>
              ——这是正常显示,不是报错。
            </li>
          </ol>
          <Callout tone="warn" label="先打款,后记录">
            和确认收款一样的原则:系统里的记录反映的是
            <strong>已经发生的银行动作</strong>
            。没实际退钱之前,不要在系统里记退款。
          </Callout>
        </div>

        <div className="space-y-4">
          <h2 className="text-h3 text-strong">状态速查表</h2>
          <h3 className="text-h4 text-strong">订单状态(Order status)</h3>
          <div className="overflow-x-auto rounded-lg border border-ink-900/10">
            <table className="w-full bg-white text-sm">
              <thead>
                <tr className="bg-surface-warm text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-2.5">状态</th>
                  <th className="px-4 py-2.5">意思</th>
                  <th className="px-4 py-2.5">你要做什么</th>
                </tr>
              </thead>
              <tbody>
                {ORDER_STATUSES.map((row) => (
                  <tr
                    key={row.status}
                    className="border-t border-ink-900/[0.06]"
                  >
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <StatusPill tone={row.tone}>{row.status}</StatusPill>
                    </td>
                    <td className="px-4 py-2.5">{row.meaning}</td>
                    <td className="px-4 py-2.5">{row.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3 className="text-h4 text-strong">付款状态(Payment status)</h3>
          <div className="overflow-x-auto rounded-lg border border-ink-900/10">
            <table className="w-full bg-white text-sm">
              <thead>
                <tr className="bg-surface-warm text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-2.5">状态</th>
                  <th className="px-4 py-2.5">意思</th>
                </tr>
              </thead>
              <tbody>
                {PAYMENT_STATUSES.map((row) => (
                  <tr
                    key={row.status}
                    className="border-t border-ink-900/[0.06]"
                  >
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <StatusPill tone={row.tone}>{row.status}</StatusPill>
                    </td>
                    <td className="px-4 py-2.5">{row.meaning}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-4">
          <h2 className="text-h3 text-strong">红线与注意事项</h2>
          <ul className="list-disc space-y-2 pl-6 text-body">
            <li>
              <strong>没到账不发货。</strong>
              任何理由都不行,包括老客户、加急件。
            </li>
            <li>
              <strong>收款账号不发到 WhatsApp 之外的任何地方</strong>
              ,不写进网站、商品页或邮件群发。
            </li>
            <li>
              <strong>只发美国地址。</strong>
              系统只接受美国收货地址;客户要求发其他国家的,礼貌拒绝。
            </li>
            <li>
              <strong>不要替客户改订单内容。</strong>
              客户要加减商品,让他取消重下,或找负责人处理。
            </li>
            <li>
              <strong>拿不准就问。</strong>
              金额对不上、客户催单施压、要求走特殊流程的,一律先找负责人,不要自行操作。
            </li>
            <li>
              后台的每一步操作都有审计记录,批准付款、记录退款前请再核对一遍。
            </li>
          </ul>
        </div>

        <footer className="border-t border-ink-900/10 pt-4 text-sm text-muted">
          Flintmarrow 内部操作手册 · 遇到系统报错请截图发给负责人
        </footer>
      </div>
    </section>
  );
}
