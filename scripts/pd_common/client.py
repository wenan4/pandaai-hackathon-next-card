"""Panda Data 登录封装。

账号密码只从环境变量或仓库根目录的 .env 读取：
优先 PANDA_USER / PANDA_PASS，回退到 SDK 默认的 DEFAULT_USERNAME / DEFAULT_PASSWORD。
任何情况下都不打印账号、密码或 token。
"""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[2]


def _credentials() -> tuple[str, str]:
    load_dotenv(REPO_ROOT / ".env")
    user = os.getenv("PANDA_USER") or os.getenv("DEFAULT_USERNAME")
    password = os.getenv("PANDA_PASS") or os.getenv("DEFAULT_PASSWORD")
    if not user or not password:
        raise SystemExit("缺少 Panda Data 账号：请在 .env 里设置 PANDA_USER / PANDA_PASS（见 .env.example）")
    return user, password


def login():
    """登录并返回 panda_data 模块。token 由 SDK 管理，这里不读取也不输出。"""
    import panda_data

    user, password = _credentials()
    panda_data.init_token(username=user, password=password)
    return panda_data
