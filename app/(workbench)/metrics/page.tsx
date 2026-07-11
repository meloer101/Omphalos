import { allMetrics, type Metric } from "@/lib/metrics/rollup";

/**
 * dogfooding 指标面板（Phase3-开工计划.md 3.2，决策 K/L）。内部用、够看即可
 * ——五张数字卡 + 一个追溯计数，对 P3 出口目标线着色（达标绿 / 未达标红 /
 * 无样本灰）。三个硬门槛（接受率 ≥70%、错连率 <5%、周追溯 ≥10）标了「门槛」。
 *
 * 数据全部来自本地 events + audit_log（不外发）。两列窗口：本周 / 全时段。
 */
export const dynamic = "force-dynamic";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// 近 7 天窗口起点。抽成独立函数：本页是每请求跑一次的 async Server Component，
// 用当前时间是对的，但 React 编译器的"render 期禁调 impure 函数"规则不区分
// server/client，直接在组件体里调 Date.now 会误报——挪到组件外即可。
function weekAgoStart(): Date {
  return new Date(Date.now() - WEEK_MS);
}

type Verdict = "pass" | "fail" | "na";

function pct(m: Metric): string {
  return m.value === null ? "—" : `${(m.value * 100).toFixed(0)}%`;
}

function verdictClass(v: Verdict): string {
  if (v === "pass") return "text-green-600 dark:text-green-400";
  if (v === "fail") return "text-red-600 dark:text-red-400";
  return "text-black/30 dark:text-white/30";
}

/** value 达标判断：dir='gte' 越高越好，'lt' 越低越好。无样本=na。 */
function checkRate(m: Metric, target: number, dir: "gte" | "lt"): Verdict {
  if (m.value === null) return "na";
  return (dir === "gte" ? m.value >= target : m.value < target) ? "pass" : "fail";
}

function Card({
  label,
  value,
  sub,
  verdict,
  gate,
}: {
  label: string;
  value: string;
  sub: string;
  verdict: Verdict;
  gate?: string;
}) {
  return (
    <div className="border border-black/10 dark:border-white/10 rounded-lg p-4">
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-xs text-black/50 dark:text-white/50">{label}</span>
        {gate && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10 text-black/50 dark:text-white/50">
            门槛 {gate}
          </span>
        )}
      </div>
      <div className={`text-2xl font-semibold tabular-nums ${verdictClass(verdict)}`}>
        {value}
      </div>
      <div className="text-xs text-black/40 dark:text-white/40 mt-1">{sub}</div>
    </div>
  );
}

export default async function MetricsPage() {
  const since = weekAgoStart();
  const [week, all] = await Promise.all([allMetrics(since), allMetrics()]);

  // 本周窗口做达标判断（P3 出口看的是持续的周指标）。
  const acceptV = checkRate(week.acceptRate, 0.7, "gte");
  const miswireV = checkRate(week.miswireRate, 0.05, "lt");
  const retrievalV: Verdict =
    all.retrievals === 0 ? "na" : week.retrievals >= 10 ? "pass" : "fail";

  const approvalMin =
    week.approvalMs.value === null
      ? "—"
      : `${(week.approvalMs.value / 60000).toFixed(1)} 分`;
  const approvalV: Verdict =
    week.approvalMs.value === null
      ? "na"
      : week.approvalMs.value < 5 * 60000
        ? "pass"
        : "fail";

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-lg font-medium mb-1">Dogfooding 指标</h1>
      <p className="text-xs text-black/40 dark:text-white/40 mb-6">
        本周窗口（近 7 天）着色对照 P3 出口目标；数字全部来自本地埋点，不外发。
        三个「门槛」是 Go/No-Go 硬指标——全绿才找首个外部团队。
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <Card
          label="捕获接受率"
          gate="≥70%"
          value={pct(week.acceptRate)}
          verdict={acceptV}
          sub={`本周 ${week.acceptRate.numerator}/${week.acceptRate.denominator} · 全时段 ${pct(all.acceptRate)}`}
        />
        <Card
          label="高风险边错连率"
          gate="<5%"
          value={pct(week.miswireRate)}
          verdict={miswireV}
          sub={`本周被拒 ${week.miswireRate.numerator}/${week.miswireRate.denominator} · 全时段 ${pct(all.miswireRate)}`}
        />
        <Card
          label="周追溯查询数"
          gate="≥10"
          value={String(week.retrievals)}
          verdict={retrievalV}
          sub={`全时段累计 ${all.retrievals} 次`}
        />
        <Card
          label="引用点击率"
          value={pct(week.clickRate)}
          verdict={checkRate(week.clickRate, 0.3, "gte")}
          sub={`本周点击 ${week.clickRate.numerator}/答案 ${week.clickRate.denominator} · 全时段 ${pct(all.clickRate)}`}
        />
        <Card
          label="拒答占比"
          value={pct(week.noRecord)}
          verdict="na"
          sub={`本周 ${week.noRecord.numerator}/${week.noRecord.denominator}（随图变满应下降）`}
        />
        <Card
          label="日均审批耗时"
          value={approvalMin}
          verdict={approvalV}
          sub={`本周 ${week.approvalMs.denominator} 次会话 · 目标 <5 分`}
        />
      </div>

      <p className="text-[11px] text-black/30 dark:text-white/30 mt-6">
        无样本时显示「—」并置灰，不当作 0。着色只在本周窗口生效；全时段仅作趋势参照。
      </p>
    </div>
  );
}
