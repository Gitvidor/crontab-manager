# tests/test_response.py - 统一响应格式测试
# 测试: api_success / api_error 返回格式一致性
# 运行: python -m pytest tests/test_response.py -v

import unittest
import json
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from flask import Flask
from core.response import api_success, api_error


class TestApiResponse(unittest.TestCase):
    """测试统一 API 响应"""

    def setUp(self):
        self.app = Flask(__name__)
        self.app.config['TESTING'] = True

    def test_success_empty(self):
        with self.app.app_context():
            resp = api_success()
            data = json.loads(resp.get_data())
            self.assertTrue(data['success'])
            self.assertEqual(len(data), 1)  # 仅 success

    def test_success_with_data(self):
        with self.app.app_context():
            resp = api_success(tasks=[1, 2, 3], total=3)
            data = json.loads(resp.get_data())
            self.assertTrue(data['success'])
            self.assertEqual(data['tasks'], [1, 2, 3])
            self.assertEqual(data['total'], 3)

    def test_success_with_message(self):
        with self.app.app_context():
            resp = api_success(message='操作成功')
            data = json.loads(resp.get_data())
            self.assertTrue(data['success'])
            self.assertEqual(data['message'], '操作成功')

    def test_error_default_400(self):
        with self.app.app_context():
            resp, status = api_error('参数不合法')
            data = json.loads(resp.get_data())
            self.assertFalse(data['success'])
            self.assertEqual(data['error'], '参数不合法')
            self.assertEqual(status, 400)

    def test_error_custom_status(self):
        with self.app.app_context():
            resp, status = api_error('未找到', 404)
            data = json.loads(resp.get_data())
            self.assertFalse(data['success'])
            self.assertEqual(data['error'], '未找到')
            self.assertEqual(status, 404)

    def test_error_403(self):
        with self.app.app_context():
            resp, status = api_error('Permission denied', 403)
            data = json.loads(resp.get_data())
            self.assertFalse(data['success'])
            self.assertEqual(status, 403)

    def test_success_always_has_success_field(self):
        """所有成功响应必须包含 success: true"""
        with self.app.app_context():
            for kwargs in [
                {},
                {'tasks': []},
                {'users': [{'name': 'admin'}]},
                {'content': 'hello', 'machine_id': 'local'},
            ]:
                resp = api_success(**kwargs)
                data = json.loads(resp.get_data())
                self.assertIn('success', data)
                self.assertTrue(data['success'])

    def test_error_always_has_error_field(self):
        """所有错误响应必须包含 success: false 和 error"""
        with self.app.app_context():
            for msg in ['bad request', '参数不合法', 'Not found']:
                resp, _ = api_error(msg)
                data = json.loads(resp.get_data())
                self.assertIn('success', data)
                self.assertFalse(data['success'])
                self.assertIn('error', data)


if __name__ == '__main__':
    unittest.main()
