"""The stake network and the two-level card logic. One implementation, used in training, evaluation and the live service."""
import json
import os
import numpy as np
import torch

from .features import LAGS, N_FEAT

ARTIFACTS = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "artifacts")


class Net(torch.nn.Module):
    def __init__(self):
        super().__init__()
        self.c = torch.nn.Sequential(torch.nn.Conv1d(N_FEAT, 64, 3, padding=1), torch.nn.ReLU(),
                                     torch.nn.Conv1d(64, 64, 3, padding=1), torch.nn.ReLU())
        self.f = torch.nn.Sequential(torch.nn.Linear(64 * len(LAGS), 128), torch.nn.ReLU(), torch.nn.Linear(128, 1))

    def forward(self, x):
        return self.f(self.c(x).flatten(1)).squeeze(1)


class StakeModel:
    """Loads the trained network with its input scaling and thresholds."""

    def __init__(self, path=None):
        path = path or ARTIFACTS
        self.meta = json.load(open(os.path.join(path, "stake_meta.json")))
        self.mu = np.array(self.meta["mu"], np.float32).reshape(1, N_FEAT, 1)
        self.sd = np.array(self.meta["sd"], np.float32).reshape(1, N_FEAT, 1)
        self.net = Net()
        self.net.load_state_dict(torch.load(os.path.join(path, "stake_model.pt"), map_location="cpu"))
        self.net.eval()
        self.faint = self.meta["faint_threshold"]
        self.full = self.meta["full_threshold"]

    def score(self, feats):
        if len(feats) == 0:
            return np.zeros(0, np.float32)
        with torch.no_grad():
            return torch.sigmoid(self.net(torch.from_numpy((feats - self.mu) / self.sd))).numpy()


class CardState:
    """The card on one player: 0 none, 1 faint, 2 full. Fed one score at a time, in time order.

    Faint comes on when the score passes `faint` and stays until the score has been under faint/3 for `hold` seconds,
    or he has been out of the play for `absent` seconds. Full comes on when two scores in a row pass `full`, is held at
    least `min_full` seconds, and drops back to faint when the score falls under `full` * 0.5."""

    def __init__(self, faint, full, hold=2.0, absent=1.0, min_full=1.2):
        self.faint, self.full, self.hold, self.absent, self.min_full = faint, full, hold, absent, min_full
        self.level = 0
        self.since = None           # when the current appearance began
        self._below = None
        self._last_t = None
        self._prev_hi = False
        self._full_since = None

    def update(self, t, score):
        """score is None when he is not near a live ball at time t. Returns the level."""
        if score is None:
            if self.level and self._last_t is not None and t - self._last_t > self.absent:
                self._reset()
            return self.level
        if self.level and self._last_t is not None and t - self._last_t > self.absent:
            self._reset()
        self._last_t = t
        if self.level == 0:
            if score >= self.faint:
                self.level, self.since, self._below = 1, t, None
        else:
            if score < self.faint / 3.0:
                self._below = self._below if self._below is not None else t
                if t - self._below >= self.hold and not (self.level == 2 and t - self._full_since < self.min_full):
                    self._reset()
                    return 0
            else:
                self._below = None
        if self.level >= 1:
            hi = score >= self.full
            if self.level == 1 and hi and self._prev_hi:
                self.level, self._full_since = 2, t
            elif self.level == 2 and score < self.full * 0.5 and t - self._full_since >= self.min_full:
                self.level = 1
            self._prev_hi = hi
        return self.level

    def _reset(self):
        self.level, self.since, self._below, self._prev_hi, self._full_since = 0, None, None, False, None
