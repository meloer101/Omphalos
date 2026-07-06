-- P2 语义索引（Phase2-开工计划.md 2.1）：给 nodes.embedding 建向量索引，
-- 让追溯检索的"向量定位入口节点"这一步能走索引而不是全表扫。
--
-- 用 cosine 距离（vector_cosine_ops）对齐 lib/retrieval/search.ts 里的
-- `<=>` 查询——OpenAI 兼容 embedding 是归一化向量，cosine 是标准选择。
-- HNSW 而非 ivfflat：不需要预先有数据训练聚类中心（冷启动导入前表可能
-- 是空的），且召回质量对"哇时刻"更重要，团队级数据量（年几千~几万节点）
-- 的写入开销可接受。
--
-- embedding 可空（Phase 0 不填、异步补索引期间也为空）——向量索引对
-- NULL 行天然跳过，不影响这些行的存在与其它查询。
CREATE INDEX IF NOT EXISTS nodes_embedding_hnsw
  ON nodes USING hnsw (embedding vector_cosine_ops);
