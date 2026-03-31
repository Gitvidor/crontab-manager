# core/response.py - 统一 API 响应格式
# 功能: 提供 api_success / api_error 辅助函数，确保所有 API 返回一致的 JSON 结构
# 成功: {"success": true, ...extra_fields}
# 失败: {"success": false, "error": "message"}

from flask import jsonify


def api_success(**kwargs):
    """
    统一成功响应

    用法:
        return api_success(tasks=[...])
        return api_success(message='操作成功')
        return api_success()  # 仅返回 {success: true}
    """
    resp = {'success': True}
    resp.update(kwargs)
    return jsonify(resp)


def api_error(error, status_code=400):
    """
    统一错误响应

    用法:
        return api_error('参数不合法')
        return api_error('未找到', 404)
        return api_error('无权限', 403)
    """
    return jsonify({'success': False, 'error': error}), status_code
