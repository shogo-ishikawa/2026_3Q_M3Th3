"""OS の TZ 切替に依存せず、日時の単体テストに現地時刻を与える。

Windows には time.tzset がないので、テストで使う datetime の現地時刻変換だけを
明示したタイムゾーンへ差し替える。timeutil の期間計算と変換失敗時の処理は本物を通す。
OS 自身の現地時刻変換は test_base.py の差し替えないテストで別に確かめる。
"""

from contextlib import contextmanager
from contextvars import ContextVar
from datetime import datetime as SystemDatetime, timedelta, timezone
import time

import pytest

from pip0 import timeutil

TOKYO = timezone(timedelta(hours=9), "JST")
_local_zone = ContextVar("test_local_zone", default=timezone.utc)


class LocalDatetime(SystemDatetime):
    """タイムゾーンなしの日時を、テストで指定した現地時刻として扱う datetime。"""

    @classmethod
    def fromtimestamp(cls, ts, tz=None):
        value = super().fromtimestamp(ts, tz=tz or _local_zone.get())
        return value.replace(tzinfo=None) if tz is None else value

    @classmethod
    def now(cls, tz=None):
        return cls.fromtimestamp(time.time(), tz)

    def timestamp(self):
        value = self if self.tzinfo is not None else self.replace(tzinfo=_local_zone.get())
        return SystemDatetime.timestamp(value)

    def astimezone(self, tz=None):
        value = self if self.tzinfo is not None else self.replace(tzinfo=_local_zone.get())
        return SystemDatetime.astimezone(value, tz or _local_zone.get())


@contextmanager
def in_timezone(zone):
    """この範囲の日時テストだけを指定した地域で動かし、終了時には必ず元へ戻す。"""
    token = _local_zone.set(zone)
    try:
        with pytest.MonkeyPatch.context() as patch:
            patch.setattr(timeutil, "datetime", LocalDatetime)
            yield
    finally:
        _local_zone.reset(token)
