-- 物理只读数据库凭证，给检索合同用（Agent架构设计.md 5.2:
-- "数据库凭证物理只读——安全靠构造，不靠模型自觉"）。P1 建好待用，
-- P2 接入检索合同前不会有消费方。
--
-- 本地开发密码——跟已经提交在 .env.example 里的 postgres/postgres 一个
-- 性质：自部署单实例本地开发凭证，不是生产密钥。
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'graph_readonly') THEN
    CREATE ROLE graph_readonly WITH LOGIN PASSWORD 'graph_readonly_dev_only';
  END IF;
END
$$;

GRANT CONNECT ON DATABASE postgres TO graph_readonly;
GRANT USAGE ON SCHEMA public TO graph_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO graph_readonly;

-- 以后新加的表也自动可读，不用每次都补一条 GRANT。
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO graph_readonly;

-- 纵深防御：显式 REVOKE，防止以后某次迁移不小心用 GRANT ALL 把权限撑大。
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM graph_readonly;