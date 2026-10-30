"""高負荷処理の条件（throttle.py）のテスト

電源と無操作時間は、代役の OS 連携（FakePlatform）の値を変えて試します。
時計は、テストの中で進められる関数（FakeClock）を使います。
"""

import pytest

from pip0 import throttle
from pip0.platform_fake import FakePlatform

NOW = 1_793_250_000.0


class FakeClock:
    """呼ぶと今の時刻を返す、手で進められる時計"""

    def __init__(self, start=NOW):
        self.value = start

    def __call__(self):
        return self.value

    def advance(self, seconds):
        self.value += seconds


class CountingPlatform(FakePlatform):
    """OS に問い合わせた回数を数える代役"""

    def __init__(self, **options):
        super().__init__(**options)
        self.queries = 0

    def get_idle_seconds(self):
        self.queries += 1
        return super().get_idle_seconds()


class BrokenPlatform(FakePlatform):
    """電源と無操作時間の読み取りが、OS のエラーで失敗する代役"""

    def get_idle_seconds(self):
        raise OSError("GetLastInputInfo に失敗")

    def get_power_source(self):
        raise OSError("GetSystemPowerStatus に失敗")


# ---------------------------------------------------------------------- check()


def test_ac_power_and_three_minutes_idle_is_allowed(env):
    result = throttle.check(FakePlatform(idle_seconds=180, power="ac"), env, now=NOW)
    assert result["allowed"] is True
    assert result["power"] == "ac"
    assert result["idle_seconds"] == 180
    assert "電源接続中" in result["reason"]
    assert result["checked_at"] == NOW


def test_179_seconds_is_not_enough(env):
    result = throttle.check(FakePlatform(idle_seconds=179, power="ac"), env, now=NOW)
    assert result["allowed"] is False
    assert "操作中" in result["reason"] and "179" in result["reason"]


def test_battery_is_not_allowed_even_when_idle(env):
    result = throttle.check(FakePlatform(idle_seconds=3600, power="battery"), env, now=NOW)
    assert result["allowed"] is False
    assert result["power"] == "battery"
    assert "バッテリー" in result["reason"]


@pytest.mark.parametrize("power", ["unknown", None, "AC", ""])
def test_unknown_power_is_never_treated_as_ac(env, power):
    result = throttle.check(FakePlatform(idle_seconds=3600, power=power), env, now=NOW)
    assert result["allowed"] is False
    assert result["power"] == "unknown"
    assert "電源の状態を取得できません" in result["reason"]


def test_unknown_idle_time_is_never_treated_as_idle(env):
    result = throttle.check(FakePlatform(idle_seconds=None, power="ac"), env, now=NOW)
    assert result["allowed"] is False
    assert result["idle_seconds"] is None
    assert "無操作の時間を取得できません" in result["reason"]


def test_negative_idle_time_is_treated_as_unknown(env):
    result = throttle.check(FakePlatform(idle_seconds=-5, power="ac"), env, now=NOW)
    assert result["allowed"] is False
    assert result["idle_seconds"] is None


def test_os_errors_are_not_allowed(env):
    result = throttle.check(BrokenPlatform(), env, now=NOW)
    assert result["allowed"] is False
    assert result["power"] == "unknown" and result["idle_seconds"] is None


def test_both_problems_are_explained(env):
    result = throttle.check(FakePlatform(idle_seconds=10, power="battery"), env, now=NOW)
    assert "バッテリー" in result["reason"] and "操作中" in result["reason"]


def test_idle_threshold_comes_from_config(env):
    platform = FakePlatform(idle_seconds=60, power="ac")
    assert throttle.check(platform, dict(env, HEAVY_IDLE_SECONDS=60), now=NOW)["allowed"] is True
    assert throttle.check(platform, env, now=NOW)["allowed"] is False


# ---------------------------------------------------------------------- HeavyGate


def test_should_continue_pauses_on_input_and_recovers(env):
    platform = FakePlatform(idle_seconds=200, power="ac")
    clock = FakeClock()
    gate = throttle.HeavyGate(platform, env, clock=clock)
    assert gate.may_run() is True
    assert gate.should_continue() is True

    platform.idle_seconds = 0  # ユーザーがマウスを動かした
    clock.advance(0.6)
    assert gate.should_continue() is False
    assert gate.state["allowed"] is False

    platform.idle_seconds = 185  # 再び3分以上操作がない
    clock.advance(0.6)
    assert gate.should_continue() is True


def test_should_continue_pauses_on_battery_and_recovers(env):
    platform = FakePlatform(idle_seconds=500, power="ac")
    clock = FakeClock()
    gate = throttle.HeavyGate(platform, env, clock=clock)
    platform.power = "battery"  # 電源を抜いた
    clock.advance(0.5)
    assert gate.should_continue() is False
    platform.power = "ac"
    clock.advance(0.5)
    assert gate.should_continue() is True


def test_should_continue_rechecks_at_most_every_half_second(env):
    platform = CountingPlatform(idle_seconds=200, power="ac")
    clock = FakeClock()
    gate = throttle.HeavyGate(platform, env, clock=clock)
    assert platform.queries == 1  # 作ったときに1回調べる
    for _ in range(100):
        assert gate.should_continue() is True
    assert platform.queries == 1  # 時計が進まなければ、問い合わせ直さない
    platform.idle_seconds = 0
    clock.advance(0.4)
    assert gate.should_continue() is True  # 0.5秒たっていないので、前の結果のまま
    clock.advance(0.1)
    assert gate.should_continue() is False
    assert platform.queries == 2


def test_may_run_uses_the_cached_state_between_checks(env):
    platform = CountingPlatform(idle_seconds=200, power="ac")
    clock = FakeClock()
    gate = throttle.HeavyGate(platform, env, clock=clock)
    platform.idle_seconds = 0
    clock.advance(env["THROTTLE_CHECK_SECONDS"] - 1)
    assert gate.may_run() is True  # まだ調べ直す時刻ではない
    assert platform.queries == 1
    clock.advance(1)
    assert gate.may_run() is False
    assert platform.queries == 2


def test_clock_going_backwards_forces_a_recheck(env):
    platform = FakePlatform(idle_seconds=200, power="ac")
    clock = FakeClock()
    gate = throttle.HeavyGate(platform, env, clock=clock)
    platform.idle_seconds = 0
    clock.advance(-3600)  # PC の時刻が1時間戻された
    assert gate.should_continue() is False
    assert gate.may_run() is False


def test_extra_stop_stops_immediately(env):
    platform = FakePlatform(idle_seconds=500, power="ac")
    stop = {"requested": False}
    gate = throttle.HeavyGate(platform, env, clock=FakeClock(), extra_stop=lambda: stop["requested"])
    assert gate.should_continue() is True
    stop["requested"] = True  # キルスイッチや終了の依頼
    assert gate.should_continue() is False
    assert gate.may_run() is False
    stop["requested"] = False
    assert gate.should_continue() is True


def test_unknown_values_never_open_the_gate(env):
    gate = throttle.HeavyGate(FakePlatform(idle_seconds=None, power="unknown"), env, clock=FakeClock())
    assert gate.may_run() is False
    assert gate.should_continue() is False
    assert gate.state["power"] == "unknown"


def test_history_records_only_changes(env):
    platform = FakePlatform(idle_seconds=0, power="ac")
    clock = FakeClock()
    gate = throttle.HeavyGate(platform, env, clock=clock)
    for idle in [0, 200, 200, 0, 0, 300]:
        platform.idle_seconds = idle
        clock.advance(1)
        gate.should_continue()
    assert [entry["allowed"] for entry in gate.history] == [False, True, False, True]
    assert gate.history[1]["at"] == NOW + 2
    assert all(entry["reason"] for entry in gate.history)


def test_history_is_kept_short(env):
    platform = FakePlatform(idle_seconds=0, power="ac")
    clock = FakeClock()
    gate = throttle.HeavyGate(platform, env, clock=clock)
    for step in range(30):
        platform.idle_seconds = 300 if step % 2 == 0 else 0
        clock.advance(1)
        gate.should_continue()
    assert len(gate.history) == throttle.HISTORY_LENGTH
    assert gate.history[-1]["at"] == clock.value
