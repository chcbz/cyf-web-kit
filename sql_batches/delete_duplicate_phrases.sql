-- =====================================================
-- mat_phrase 表删除重复内容SQL
-- 执行前请务必备份数据！
-- =====================================================
-- 备份命令：
-- mysqldump -u root -p jia mat_phrase > backup_mat_phrase_$(date +%Y%m%d_%H%M%S).sql
-- =====================================================

-- 开始事务以便回滚
START TRANSACTION;

-- 查看将要删除的记录
SELECT '即将删除以下重复记录:' AS '';
SELECT id, content FROM mat_phrase WHERE id IN (271, 212, 560, 394, 263, 195, 673, 417, 739, 1396, 2713, 2190, 2372, 1554, 1579, 731, 2027, 1044, 1170, 175) ORDER BY id;

-- 查看将保留的记录
SELECT '以下记录将被保留:' AS '';
SELECT id, content FROM mat_phrase WHERE id IN (161, 114, 168, 138, 154, 159, 203, 174, 408, 530, 1081, 42, 795, 1039, 796, 2, 1916, 910) ORDER BY id;

-- =====================================================
-- 删除重复记录
-- =====================================================

-- 组1: 删除ID 271 (与ID 161重复)
DELETE FROM mat_phrase WHERE id = 271;

-- 组2: 删除ID 212 (与ID 114重复)
DELETE FROM mat_phrase WHERE id = 212;

-- 组3: 删除ID 560 (与ID 168重复)
DELETE FROM mat_phrase WHERE id = 560;

-- 组4: 删除ID 394 (与ID 138重复且有错别字"装o点")
DELETE FROM mat_phrase WHERE id = 394;

-- 组5: 删除ID 263 (与ID 154重复)
DELETE FROM mat_phrase WHERE id = 263;

-- 组6: 删除ID 195 (与ID 159重复)
DELETE FROM mat_phrase WHERE id = 195;

-- 组7: 删除ID 673 (与ID 203重复)
DELETE FROM mat_phrase WHERE id = 673;

-- 组8: 删除ID 417 (与ID 174重复)
DELETE FROM mat_phrase WHERE id = 417;

-- 组9: 删除ID 739 (与ID 408重复)
DELETE FROM mat_phrase WHERE id = 739;

-- 组10: 删除ID 1396 (与ID 530重复)
DELETE FROM mat_phrase WHERE id = 1396;

-- 组11: 删除ID 2713 (与ID 1081重复)
DELETE FROM mat_phrase WHERE id = 2713;

-- 组12: 删除ID 2190 (与ID 42重复)
DELETE FROM mat_phrase WHERE id = 2190;

-- 组13: 删除ID 2372 (与ID 795重复)
DELETE FROM mat_phrase WHERE id = 2372;

-- 组14: 删除ID 1554 (与ID 1039重复)
DELETE FROM mat_phrase WHERE id = 1554;

-- 组15: 删除ID 1579 (与ID 796重复)
DELETE FROM mat_phrase WHERE id = 1579;

-- 组16: 删除ID 731 (与ID 2重复)
DELETE FROM mat_phrase WHERE id = 731;

-- 组17: 删除ID 2027 (与ID 1916重复)
DELETE FROM mat_phrase WHERE id = 2027;

-- 组18: 删除ID 1044 (与ID 910重复)
DELETE FROM mat_phrase WHERE id = 1044;

-- 组19: 删除ID 1170 (与ID 910重复)
DELETE FROM mat_phrase WHERE id = 1170;

-- 组20: 删除ID 175 (数据损坏)
DELETE FROM mat_phrase WHERE id = 175;

-- =====================================================
-- 验证删除结果
-- =====================================================
SELECT '删除后的记录统计:' AS '';
SELECT COUNT(*) AS remaining_records FROM mat_phrase;

-- 提交事务
-- 如果确认无误，取消下面这行的注释来提交
-- COMMIT;

-- 如果需要回滚，取消下面这行的注释
-- ROLLBACK;

-- =====================================================
-- 使用说明：
-- 1. 先执行 SELECT 语句查看将要删除和保留的记录
-- 2. 确认无误后，取消 COMMIT 的注释并执行
-- 3. 如需回滚，执行 ROLLBACK
-- =====================================================
