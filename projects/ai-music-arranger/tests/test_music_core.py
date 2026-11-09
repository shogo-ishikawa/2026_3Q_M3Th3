"""生成結果の音楽的な条件と、音声・MIDI保存前の整合性を確認します。"""

from dataclasses import replace
import sys
from pathlib import Path

import numpy as np
import pretty_midi
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import music_core as core


def source(seconds=1.1):
    time = np.arange(round(seconds * core.SAMPLE_RATE)) / core.SAMPLE_RATE
    return 0.1 * np.sin(2 * np.pi * 440 * time)


def without_parts(**changes):
    return replace(
        core.ArrangementConfig(),
        add_chords=False,
        add_drums=False,
        add_melody=False,
        **changes,
    )


def test_scale_changes_the_third_of_the_tonic_chord():
    assert core.chord_pitches("C", "major", 0) == [48, 52, 55]
    assert core.chord_pitches("C", "natural_minor", 0) == [48, 51, 55]
    assert core.chord_pitches("D", "major", 0) == [50, 54, 57]


def test_generated_minor_chords_use_only_selected_scale():
    config = replace(
        core.ArrangementConfig(),
        root="C",
        scale="natural_minor",
        add_drums=False,
        add_melody=False,
        humanise=0,
    )
    result = core.arrange(source(5), core.SAMPLE_RATE, config, melody_notes=[])
    allowed = set(core.SCALE_DEFS["natural_minor"])
    assert result["notes"]["chords"]
    assert all(note.pitch % 12 in allowed for note in result["notes"]["chords"])


def test_melody_at_the_end_of_the_recording_is_kept():
    notes = core.pitches_to_notes(
        np.full(5, 440.0), np.ones(5, dtype=bool), 1000, 100, 0.5
    )
    assert len(notes) == 1
    assert notes[0].pitch == 69
    assert notes[0].start == pytest.approx(0)
    assert notes[0].end == pytest.approx(0.5)


def test_unvoiced_gap_is_a_rest_instead_of_a_sustained_note():
    notes = core.pitches_to_notes(
        np.array([440, 440, np.nan, np.nan, 440, 440]),
        np.array([True, True, False, False, True, True]),
        1000,
        100,
        0.6,
    )
    assert len(notes) == 2
    assert notes[0].end <= 0.2 + 1e-9
    assert notes[1].start >= 0.4 - 1e-9
    assert notes[-1].end == pytest.approx(0.6)


def test_original_only_mix_preserves_entire_recording():
    audio = source(1.37)
    result = core.arrange(audio, core.SAMPLE_RATE, without_parts(original_gain=0.7))
    assert len(result["mixed"]) == len(audio)
    assert len(result["accompaniment"]) == len(audio)
    np.testing.assert_allclose(result["mixed"], audio * 0.7, atol=1e-7)
    assert not np.any(result["accompaniment"])


def test_zero_gains_really_mute_audio_and_midi():
    config = replace(
        core.ArrangementConfig(),
        original_gain=0,
        chord_gain=0,
        drum_gain=0,
        melody_gain=0,
    )
    result = core.arrange(
        source(),
        core.SAMPLE_RATE,
        config,
        melody_notes=[core.Note(69, 0, 0.8, 90)],
    )
    assert not np.any(result["mixed"])
    assert not np.any(result["accompaniment"])
    assert all(not instrument.notes for instrument in result["midi"].instruments)


def test_midi_tempo_survives_file_round_trip(tmp_path):
    config = replace(core.ArrangementConfig(), bpm=87.5, add_melody=False)
    result = core.arrange(source(), core.SAMPLE_RATE, config, melody_notes=[])
    path = tmp_path / "arrangement.mid"
    result["midi"].write(str(path))
    recovered = pretty_midi.PrettyMIDI(str(path))
    times, tempi = recovered.get_tempo_changes()
    assert times[0] == 0
    assert tempi[0] == pytest.approx(87.5, abs=0.001)


def test_drum_only_arrangement_is_audible_and_marked_as_percussion():
    config = replace(
        core.ArrangementConfig(),
        add_chords=False,
        add_melody=False,
        original_gain=0,
    )
    result = core.arrange(source(), core.SAMPLE_RATE, config, melody_notes=[])
    assert np.max(np.abs(result["mixed"])) > 0.01
    assert any(instrument.is_drum and instrument.notes for instrument in result["midi"].instruments)


def test_seed_makes_humanised_arrangement_reproducible():
    config = replace(core.ArrangementConfig(), humanise=0.5, add_melody=False, seed=17)
    first = core.arrange(source(), core.SAMPLE_RATE, config, melody_notes=[])
    second = core.arrange(source(), core.SAMPLE_RATE, config, melody_notes=[])
    np.testing.assert_array_equal(first["mixed"], second["mixed"])


def test_all_note_boundaries_stay_inside_audio_even_with_humanisation():
    audio = source(0.31)
    config = replace(core.ArrangementConfig(), humanise=1, bpm=220)
    result = core.arrange(
        audio,
        core.SAMPLE_RATE,
        config,
        melody_notes=[core.Note(69, 0, len(audio) / core.SAMPLE_RATE)],
    )
    duration = len(audio) / core.SAMPLE_RATE
    for instrument in result["midi"].instruments:
        for note in instrument.notes:
            assert 0 <= note.start < note.end <= duration + 1e-9
            assert 1 <= note.velocity <= 127


@pytest.mark.parametrize(
    "changes",
    [
        {"bpm": 0},
        {"bpm": float("nan")},
        {"root": "not-a-key"},
        {"scale": "not-a-scale"},
        {"original_gain": -1},
        {"humanise": -0.1},
    ],
)
def test_invalid_configuration_is_rejected(changes):
    with pytest.raises(ValueError):
        config = replace(core.ArrangementConfig(), **changes)
        core.arrange(source(), core.SAMPLE_RATE, config, melody_notes=[])


@pytest.mark.parametrize("audio", [np.array([]), np.array([0, np.nan]), np.array([np.inf, 0])])
def test_invalid_waveform_is_rejected(audio):
    with pytest.raises(ValueError):
        core.arrange(audio, core.SAMPLE_RATE, without_parts())


def test_silent_analysis_does_not_claim_a_known_key():
    result = core.analyse_audio(np.zeros(core.SAMPLE_RATE), core.SAMPLE_RATE)
    assert np.isfinite(result["bpm"])
    assert result["confidence"] == 0
    assert result["note"]
    assert core.extract_melody(np.zeros(core.SAMPLE_RATE), core.SAMPLE_RATE) == []


def test_real_pitch_analysis_recognises_a_simple_a_note():
    time = np.arange(core.SAMPLE_RATE) / core.SAMPLE_RATE
    audio = 0.4 * np.sin(2 * np.pi * 440 * time) + 0.15 * np.sin(2 * np.pi * 880 * time)
    notes = core.extract_melody(audio, core.SAMPLE_RATE)
    assert notes
    assert np.median([note.pitch for note in notes]) == 69
    assert sum(note.end - note.start for note in notes) >= 0.7

