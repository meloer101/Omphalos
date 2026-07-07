-- P2 embedding 维度 1536 → 1024（Phase2-开工计划.md 决策 E 修订：改用本地
-- bge-m3，1024 维，贴合自部署/数据敏感定位，OQ3）。
--
-- 安全前提：切换时 nodes.embedding 全为 NULL（demo 前的 embed job 因当时无
-- 可用 embedding 模型全部失败，没写进任何向量），因此改维度不丢数据、无需
-- 转换旧向量。若将来带数据换维度，需先清空 embedding 再改型再重跑 embed。
--
-- 顺序：先删旧索引（否则 ALTER TYPE 会被索引挡住）→ 改列维度 → 重建 HNSW。
DROP INDEX IF EXISTS nodes_embedding_hnsw;

ALTER TABLE nodes ALTER COLUMN embedding TYPE vector(1024);

CREATE INDEX IF NOT EXISTS nodes_embedding_hnsw
  ON nodes USING hnsw (embedding vector_cosine_ops);
