# executor.py - Crontab 执行器抽象层
# 功能: 统一本地和远程 crontab 操作接口
# 认证: SSH 密钥认证
# 用法: executor = get_executor(machine_config); executor.get_crontab(linux_user)

from abc import ABC, abstractmethod
import subprocess
from typing import Tuple, Optional

try:
    import paramiko
    HAS_PARAMIKO = True
except ImportError:
    HAS_PARAMIKO = False


class CrontabExecutor(ABC):
    """Crontab 执行器抽象基类"""

    @abstractmethod
    def get_crontab(self, linux_user: str = '') -> str:
        """获取指定 Linux 用户的 crontab"""
        pass

    @abstractmethod
    def save_crontab(self, content: str, linux_user: str = '') -> Tuple[bool, str]:
        """保存 crontab 内容，返回 (成功, 错误信息)"""
        pass

    @abstractmethod
    def test_connection(self) -> Tuple[bool, str]:
        """测试连接是否可用，返回 (成功, 消息)"""
        pass

    @abstractmethod
    def run_command(self, command: str) -> Tuple[int, str, str]:
        """运行命令，返回 (返回码, stdout, stderr)"""
        pass

    def close(self):
        """关闭连接（如有）"""
        pass


class LocalExecutor(CrontabExecutor):
    """本地 crontab 执行器"""

    def get_crontab(self, linux_user: str = '') -> str:
        """获取本地 crontab"""
        cmd = ['crontab', '-u', linux_user, '-l'] if linux_user else ['crontab', '-l']
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode == 0:
            return result.stdout
        # crontab -l 返回非0可能是没有 crontab，返回空字符串
        return ''

    def save_crontab(self, content: str, linux_user: str = '') -> Tuple[bool, str]:
        """保存本地 crontab"""
        cmd = ['crontab', '-u', linux_user, '-'] if linux_user else ['crontab', '-']
        process = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )
        stdout, stderr = process.communicate(content)
        return process.returncode == 0, stderr

    def test_connection(self) -> Tuple[bool, str]:
        """本地连接始终成功"""
        return True, 'localhost'

    def run_command(self, command: str) -> Tuple[int, str, str]:
        """运行本地命令"""
        result = subprocess.run(
            command,
            shell=True,
            capture_output=True,
            text=True,
            timeout=120
        )
        return result.returncode, result.stdout, result.stderr


class SSHExecutor(CrontabExecutor):
    """SSH 远程 crontab 执行器"""

    def __init__(self, host: str, port: int, ssh_user: str, ssh_key: str):
        if not HAS_PARAMIKO:
            raise ImportError('paramiko is required for SSH connections. Install with: pip install paramiko')
        self.host = host
        self.port = port
        self.ssh_user = ssh_user
        self.ssh_key = ssh_key
        self._client: Optional[paramiko.SSHClient] = None

    def _get_client(self) -> 'paramiko.SSHClient':
        """获取或创建 SSH 客户端"""
        if self._client is None or not self._client.get_transport() or not self._client.get_transport().is_active():
            self._client = paramiko.SSHClient()
            self._client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            self._client.connect(
                hostname=self.host,
                port=self.port,
                username=self.ssh_user,
                key_filename=self.ssh_key,
                timeout=10
            )
        return self._client

    def get_crontab(self, linux_user: str = '') -> str:
        """获取远程 crontab"""
        client = self._get_client()
        cmd = f'crontab -u {linux_user} -l' if linux_user else 'crontab -l'
        stdin, stdout, stderr = client.exec_command(cmd)
        exit_status = stdout.channel.recv_exit_status()
        if exit_status == 0:
            return stdout.read().decode('utf-8')
        return ''

    def save_crontab(self, content: str, linux_user: str = '') -> Tuple[bool, str]:
        """保存远程 crontab"""
        client = self._get_client()
        cmd = f'crontab -u {linux_user} -' if linux_user else 'crontab -'
        stdin, stdout, stderr = client.exec_command(cmd)
        stdin.write(content)
        stdin.channel.shutdown_write()
        exit_status = stdout.channel.recv_exit_status()
        return exit_status == 0, stderr.read().decode('utf-8')

    def test_connection(self) -> Tuple[bool, str]:
        """测试 SSH 连接"""
        try:
            client = self._get_client()
            stdin, stdout, stderr = client.exec_command('echo ok')
            result = stdout.read().decode().strip()
            return result == 'ok', f'{self.host}:{self.port}'
        except Exception as e:
            return False, str(e)

    def run_command(self, command: str) -> Tuple[int, str, str]:
        """运行远程命令"""
        client = self._get_client()
        stdin, stdout, stderr = client.exec_command(command, timeout=120)
        exit_status = stdout.channel.recv_exit_status()
        return exit_status, stdout.read().decode('utf-8'), stderr.read().decode('utf-8')

    def close(self):
        """关闭 SSH 连接"""
        if self._client:
            self._client.close()
            self._client = None


def get_executor(machine_config: dict) -> CrontabExecutor:
    """工厂函数：根据配置创建对应的执行器"""
    machine_type = machine_config.get('type', 'local')
    if machine_type == 'ssh':
        return SSHExecutor(
            host=machine_config['host'],
            port=machine_config.get('port', 22),
            ssh_user=machine_config['ssh_user'],
            ssh_key=machine_config['ssh_key']
        )
    return LocalExecutor()
