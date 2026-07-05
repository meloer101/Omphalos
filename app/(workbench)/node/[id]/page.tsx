/**
 * 节点详情页：中央变形栏。打开的节点类型/内容决定这里渲染成
 * 文档编辑器、任务详情还是原型占位——这是"工具即视图"的落地点。
 * Next.js 16：params 是 Promise，必须 await（此前版本是同步对象）。
 */
export default async function NodePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="p-6">
      <h1 className="text-lg font-medium mb-4">节点 {id}</h1>
      <p className="text-sm text-black/50 dark:text-white/50">
        正文 / 关联边 / 出处 tabs —— 待接入图内核（Phase 0.2）。
      </p>
    </div>
  );
}
