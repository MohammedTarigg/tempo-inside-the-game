"""A replay after a failure must give every fact and cue the ID it had the first time, so these are written out."""

from tempo.contracts import cue, event, fact, stable_id


def test_fact_id():
    f = fact("m_test", 2831.26, "card", "p_har_6", "yellow")
    assert f["fact_id"] == "f_afc0d3abafab"
    assert f["fact_id"] == stable_id("f", "m_test", "card", "p_har_6", 2831.3)
    assert f["match_time"] == 2831.26
    # the value is not part of the ID, and a tenth of a second is as fine as it looks
    assert fact("m_test", 2831.34, "card", "p_har_6", "red")["fact_id"] == f["fact_id"]
    assert fact("m_test", 2831.26, "card", "p_har_7", "yellow")["fact_id"] != f["fact_id"]


def test_cue_id():
    en = cue("m_test", 2831.26, "sentence", "phone", dict(lang="en", text="x"), ["f_afc0d3abafab"])
    ar = cue("m_test", 2831.26, "sentence", "phone", dict(lang="ar", text="x"), ["f_afc0d3abafab"])
    assert en["cue_id"] == "c_12c811e4eb5e"
    assert ar["cue_id"] == "c_46e4e280cdc1"
    # the wording is not part of the ID, so the same cue written again is the same cue
    again = cue("m_test", 2831.26, "sentence", "phone", dict(lang="en", text="y"), ["f_afc0d3abafab"])
    assert again["cue_id"] == en["cue_id"]
    assert en["status"] == "live"


def test_fact_order_does_not_change_a_cue_id():
    a = cue("m_test", 10.0, "stake_card", "tv", dict(player="p_har_6", level=1), ["f_b", "f_a"])
    b = cue("m_test", 10.0, "stake_card", "tv", dict(player="p_har_6", level=1), ["f_a", "f_b"])
    assert a["cue_id"] == b["cue_id"]


def test_event_id():
    e = event("m_test", 12, "pass", 1, 61.239, "t_nor", "p_nor_10", 50, 50)
    assert e["id"] == "e_7466cc131927"
    assert (e["typeId"], e["timeMin"], e["timeSec"], e["matchTime"]) == (1, 1, 1, 61.24)
