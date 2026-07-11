-- Phase3-开工计划.md 决策 J（拆库）：迁移 0003 把只读角色的连库授权写死成
-- `GRANT CONNECT ON DATABASE postgres`。这在只有一个 `postgres` 库时没问题，
-- 但 P3 拆出独立测试库 `pmeverything_test` 后，同一套迁移在测试库上跑时，
-- 0003 仍只给 `postgres` 库授 CONNECT，graph_readonly 连不上测试库，
-- readonly-role.test.ts 直接失败。
--
-- 这里改成对 current_database() 授权——迁移在哪个库上跑，就给哪个库授
-- CONNECT。对已有的 dev 主库是幂等重授（无副作用），对测试库补上缺的那一条。
-- 表级 SELECT / 默认权限（0003 的其余部分）本就作用于 current schema，无需重复。
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO graph_readonly', current_database());
END
$$;
