# tests/test_crontab_parse.py - Crontab 解析逻辑单元测试
# 测试: parse_crontab 分组规则、任务识别、注释处理
# 运行: python -m pytest tests/test_crontab_parse.py -v

import unittest
from unittest.mock import patch

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from core.crontab import (
    is_cron_task_line,
    validate_cron_field,
    validate_cron_schedule,
    validate_crontab_line,
    validate_crontab_content,
)


class TestIsCronTaskLine(unittest.TestCase):
    """测试 is_cron_task_line 任务行识别"""

    def test_enabled_task(self):
        self.assertTrue(is_cron_task_line('0 3 * * * /cleanup.sh'))
        self.assertTrue(is_cron_task_line('*/5 * * * * /monitor.sh'))
        self.assertTrue(is_cron_task_line('0 0 1 * * /monthly.sh'))

    def test_disabled_task(self):
        self.assertTrue(is_cron_task_line('#0 3 * * * /cleanup.sh'))
        self.assertTrue(is_cron_task_line('#*/5 * * * * /monitor.sh'))

    def test_not_task_line(self):
        self.assertFalse(is_cron_task_line('# 这是一个注释'))
        self.assertFalse(is_cron_task_line(''))
        self.assertFalse(is_cron_task_line('PATH=/usr/bin'))
        self.assertFalse(is_cron_task_line('# some comment'))

    def test_env_var_not_task(self):
        self.assertFalse(is_cron_task_line('SHELL=/bin/bash'))
        self.assertFalse(is_cron_task_line('MAILTO=admin@example.com'))


class TestValidateCronField(unittest.TestCase):
    """测试单个 cron 字段验证"""

    def test_wildcard(self):
        self.assertTrue(validate_cron_field('*', 0, 59))

    def test_step(self):
        self.assertTrue(validate_cron_field('*/5', 0, 59))
        self.assertTrue(validate_cron_field('*/1', 0, 59))
        self.assertFalse(validate_cron_field('*/0', 0, 59))
        self.assertFalse(validate_cron_field('*/60', 0, 59))

    def test_single_value(self):
        self.assertTrue(validate_cron_field('0', 0, 59))
        self.assertTrue(validate_cron_field('59', 0, 59))
        self.assertFalse(validate_cron_field('60', 0, 59))
        self.assertFalse(validate_cron_field('-1', 0, 59))

    def test_range(self):
        self.assertTrue(validate_cron_field('1-5', 0, 59))
        self.assertTrue(validate_cron_field('0-59', 0, 59))
        self.assertFalse(validate_cron_field('5-1', 0, 59))  # 逆序无效
        self.assertFalse(validate_cron_field('0-60', 0, 59))

    def test_list(self):
        self.assertTrue(validate_cron_field('1,3,5', 0, 59))
        self.assertTrue(validate_cron_field('0,30', 0, 59))
        self.assertFalse(validate_cron_field('1,60', 0, 59))

    def test_range_with_step(self):
        self.assertTrue(validate_cron_field('1-5/2', 0, 59))

    def test_invalid_format(self):
        self.assertFalse(validate_cron_field('abc', 0, 59))
        self.assertFalse(validate_cron_field('*/abc', 0, 59))


class TestValidateCronSchedule(unittest.TestCase):
    """测试 cron 表达式验证"""

    def test_valid_expressions(self):
        valid_cases = [
            '* * * * *',
            '0 0 * * *',
            '*/5 * * * *',
            '0 3 * * 0',
            '30 2 1 * *',
            '0 0 1 1 *',
            '0,30 * * * *',
            '0 0 * * 0,6',
        ]
        for expr in valid_cases:
            ok, err = validate_cron_schedule(expr)
            self.assertTrue(ok, f'{expr} should be valid, got: {err}')

    def test_invalid_expressions(self):
        invalid_cases = [
            ('', 'empty'),
            ('* * *', 'too few fields'),
            ('* * * * * *', 'too many fields'),
            ('60 * * * *', 'minute out of range'),
            ('* 24 * * *', 'hour out of range'),
            ('* * 32 * *', 'day out of range'),
            ('* * * 13 *', 'month out of range'),
            ('* * * * 8', 'weekday out of range'),
        ]
        for expr, desc in invalid_cases:
            ok, err = validate_cron_schedule(expr)
            self.assertFalse(ok, f'{expr} ({desc}) should be invalid')

    def test_weekday_7_valid(self):
        """0 和 7 都表示周日"""
        ok, _ = validate_cron_schedule('0 0 * * 7')
        self.assertTrue(ok)
        ok, _ = validate_cron_schedule('0 0 * * 0')
        self.assertTrue(ok)


class TestValidateCrontabLine(unittest.TestCase):
    """测试单行 crontab 验证"""

    def test_empty_line(self):
        ok, _ = validate_crontab_line('')
        self.assertTrue(ok)

    def test_comment_line(self):
        ok, _ = validate_crontab_line('# this is a comment')
        self.assertTrue(ok)

    def test_env_var_line(self):
        ok, _ = validate_crontab_line('PATH=/usr/bin:/bin')
        self.assertTrue(ok)
        ok, _ = validate_crontab_line('SHELL=/bin/bash')
        self.assertTrue(ok)

    def test_valid_cron_line(self):
        ok, _ = validate_crontab_line('0 3 * * * /usr/bin/cleanup.sh')
        self.assertTrue(ok)

    def test_invalid_cron_line(self):
        ok, _ = validate_crontab_line('0 3 * * * ')  # 空命令
        self.assertFalse(ok)

    def test_missing_command(self):
        ok, err = validate_crontab_line('0 3 * *')
        self.assertFalse(ok)


class TestValidateCrontabContent(unittest.TestCase):
    """测试整个 crontab 内容验证"""

    def test_valid_content(self):
        content = """# 系统维护
0 3 * * * /cleanup.sh
# 备份
0 2 * * * /backup.sh
"""
        ok, errors = validate_crontab_content(content)
        self.assertTrue(ok)
        self.assertEqual(errors, [])

    def test_invalid_content(self):
        content = """0 3 * * * /cleanup.sh
60 * * * * /bad.sh
"""
        ok, errors = validate_crontab_content(content)
        self.assertFalse(ok)
        self.assertEqual(len(errors), 1)
        self.assertIn('Line 2', errors[0])

    def test_commented_cron_validated(self):
        """被注释的 cron 行也应验证"""
        content = "#60 * * * * /bad.sh\n"
        ok, errors = validate_crontab_content(content)
        self.assertFalse(ok)

    def test_env_vars_pass(self):
        content = """SHELL=/bin/bash
PATH=/usr/bin
0 * * * * /job.sh
"""
        ok, errors = validate_crontab_content(content)
        self.assertTrue(ok)

    def test_empty_content(self):
        ok, errors = validate_crontab_content('')
        self.assertTrue(ok)


class TestParseCrontab(unittest.TestCase):
    """测试 parse_crontab 分组解析（需要 mock executor）"""

    @patch('core.crontab.get_crontab_raw')
    def test_single_group(self, mock_raw):
        from core.crontab import parse_crontab
        mock_raw.return_value = """# 系统维护
0 3 * * * /cleanup.sh
0 0 * * 0 /logrotate.sh
"""
        groups = parse_crontab('local', 'root')
        self.assertEqual(len(groups), 1)
        self.assertEqual(groups[0]['title'], '系统维护')
        self.assertEqual(len(groups[0]['tasks']), 2)

    @patch('core.crontab.get_crontab_raw')
    def test_multiple_groups(self, mock_raw):
        from core.crontab import parse_crontab
        mock_raw.return_value = """# 系统维护
0 3 * * * /cleanup.sh

# 备份任务
0 2 * * * /backup.sh
"""
        groups = parse_crontab('local', 'root')
        self.assertEqual(len(groups), 2)
        self.assertEqual(groups[0]['title'], '系统维护')
        self.assertEqual(groups[1]['title'], '备份任务')

    @patch('core.crontab.get_crontab_raw')
    def test_disabled_task(self, mock_raw):
        from core.crontab import parse_crontab
        mock_raw.return_value = """# 监控
#*/5 * * * * /monitor.sh
"""
        groups = parse_crontab('local', 'root')
        self.assertEqual(len(groups), 1)
        self.assertEqual(len(groups[0]['tasks']), 1)
        self.assertFalse(groups[0]['tasks'][0]['enabled'])
        self.assertEqual(groups[0]['tasks'][0]['schedule'], '*/5 * * * *')

    @patch('core.crontab.get_crontab_raw')
    def test_task_with_name(self, mock_raw):
        from core.crontab import parse_crontab
        mock_raw.return_value = """# 系统维护
# 清理临时文件
0 3 * * * /cleanup.sh
"""
        groups = parse_crontab('local', 'root')
        self.assertEqual(len(groups), 1)
        task = groups[0]['tasks'][0]
        self.assertEqual(task.get('name'), '清理临时文件')

    @patch('core.crontab.get_crontab_raw')
    def test_empty_crontab(self, mock_raw):
        from core.crontab import parse_crontab
        mock_raw.return_value = ''
        groups = parse_crontab('local', 'root')
        self.assertEqual(groups, [])

    @patch('core.crontab.get_crontab_raw')
    def test_task_ids_sequential(self, mock_raw):
        from core.crontab import parse_crontab
        mock_raw.return_value = """# Group 1
0 1 * * * /job1.sh
0 2 * * * /job2.sh

# Group 2
0 3 * * * /job3.sh
"""
        groups = parse_crontab('local', 'root')
        all_ids = [t['id'] for g in groups for t in g['tasks']]
        self.assertEqual(all_ids, [0, 1, 2])

    @patch('core.crontab.get_crontab_raw')
    def test_multiline_comment_group(self, mock_raw):
        """多行注释: 倒数第二行=组名, 最后一行=任务名"""
        from core.crontab import parse_crontab
        mock_raw.return_value = """# 组名称
# 任务名称
0 3 * * * /job.sh
"""
        groups = parse_crontab('local', 'root')
        self.assertEqual(len(groups), 1)
        self.assertEqual(groups[0]['title'], '组名称')
        self.assertEqual(groups[0]['tasks'][0].get('name'), '任务名称')


if __name__ == '__main__':
    unittest.main()
