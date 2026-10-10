"""Listener. In production this is Azure AI Speech transcribing the commentary feed with the squad names as its phrase list. Locally it
reads the generator's commentary lines. Either way its output is the same: a player was named at this match time."""


class Listener:
    def __init__(self, meta):
        self.names = {nm.lower(): pid for pid, nm in meta["names"].items()}
        self.counts = {}
        for nm in self.names:
            self.counts[nm] = self.counts.get(nm, 0) + 1

    def mentions(self, text):
        low = text.lower()
        return [pid for nm, pid in self.names.items() if nm in low.replace(",", " ").replace(".", " ").split() and self.counts[nm] == 1]

    @staticmethod
    def already_said(text, numbers):
        """If the commentator has just said the number we were holding, showing it adds nothing."""
        return any(str(n) in text for n in numbers)
