-- 修正 0001 的信任账本守卫：低风险边（重复/阻塞/标签）本来就"不进信任
-- 账本"（Agent架构设计.md 决策点 9、db/enums.ts 对 blocks 的注释），
-- 应该"自动生效可撤销"——但 0001 写的 guard_confirmed_edges 没有区分
-- risk，把所有已确认边（不论高低风险）都锁成永久不可删除。P0 阶段没
-- 暴露是因为 P0 只有人工手动确认；P1 捕获 Agent 开始自动把低风险边
-- 写成 confirmed 后（Phase1-开工计划.md 决策 C），这个疏漏变成一个
-- 真实的阻塞——审批 tab 的"撤销"功能需要能删掉一条误判的边。
--
-- 只放开低风险边；高风险边（支撑/因为/验证/证伪）的信任账本约束原样
-- 保留——那些边一旦确认，永远不可删除、不可退回提议态。
CREATE OR REPLACE FUNCTION guard_confirmed_edges() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'confirmed' AND OLD.risk = 'high' THEN
      RAISE EXCEPTION 'confirmed high-risk edges cannot be deleted — they are the trust ledger';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'confirmed' THEN
    IF NEW.type IS DISTINCT FROM OLD.type
      OR NEW.src_id IS DISTINCT FROM OLD.src_id
      OR NEW.dst_id IS DISTINCT FROM OLD.dst_id
      OR NEW.project_id IS DISTINCT FROM OLD.project_id
    THEN
      RAISE EXCEPTION 'confirmed edges are immutable except for status transitions';
    END IF;
    IF NEW.status = 'proposed' AND OLD.risk = 'high' THEN
      RAISE EXCEPTION 'a confirmed high-risk edge cannot be reverted to proposed';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;