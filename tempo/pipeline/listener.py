"""Listener: which players the commentator just named. Its input is a commentary line, {matchTime, text}. On Azure
the lines come from AI Speech transcribing the commentary feed with both squads as its phrase list
(tempo/azure/speech.py), published to the bus by the listener service. Locally they are the generator's commentary lines.
Either way the output is the same: a player was named at this match time."""

import re

# a recognizer writes punctuation and possessives: "Skoles," "Skoles!" "Skoles's"
WORD = re.compile(r"[^\W\d_]+(?:['’][^\W\d_]+)*")


class Listener:
    def __init__(self, meta):
        self.names = {nm.lower(): pid for pid, nm in meta["names"].items()}
        self.counts = {}
        for nm in self.names:
            self.counts[nm] = self.counts.get(nm, 0) + 1

    @staticmethod
    def phrases(meta):
        """What the recognizer is told to expect: every player's name and both clubs' names."""
        return [*meta["names"].values(), meta["home"]["name"], meta["away"]["name"]]

    def mentions(self, text):
        said = {re.sub(r"['’]s$", "", w) for w in WORD.findall(text.lower())}
        return [pid for nm, pid in self.names.items() if nm in said and self.counts[nm] == 1]

    @staticmethod
    def already_said(text, numbers):
        """If the commentator has just said the number we were holding, showing it adds nothing."""
        return any(str(n) in text for n in numbers)
