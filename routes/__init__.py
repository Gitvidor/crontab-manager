# routes/__init__.py - 蓝图注册
# 功能: 集中注册所有 Flask 蓝图


def register_blueprints(app):
    """注册所有路由蓝图"""
    from routes.auth import bp as auth_bp
    from routes.crontab import bp as crontab_bp
    from routes.at_jobs import bp as at_jobs_bp
    from routes.query import bp as query_bp

    app.register_blueprint(auth_bp)
    app.register_blueprint(crontab_bp)
    app.register_blueprint(at_jobs_bp)
    app.register_blueprint(query_bp)
