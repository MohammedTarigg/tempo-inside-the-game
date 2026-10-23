"""The shape of what a run hands the site: match.json and scenes.json. This is the one definition. `tempo types` writes
the site's TypeScript from it (web/src/types/run.ts), and a test holds the demo run to it, so the pipeline and the site
cannot drift apart without a check failing."""

from typing import Literal, NotRequired, TypedDict

# ---- cues: one record type for each form, told apart by `form` ----


class Proof(TypedDict):
    icon: str
    fact_id: str
    title: str
    value: str
    note: str


class StakeCardPayload(TypedDict):
    player: str
    level: Literal[0, 1, 2]
    chance: float
    stake: str


class TagPayload(TypedDict):
    player: str
    text: str
    note: str
    value: float
    unit: str
    usual: float
    rare: float


class DuelPayload(TypedDict):
    defender: str
    attacker: str
    defender_won: int
    attacker_won: int


class FormCardPayload(TypedDict):
    player: str
    per_minute: float
    usual_percentile: float
    top_speed: float
    heard: str


class LabelPayload(TypedDict):
    text: str


class PressurePayload(TypedDict):
    team: Literal[0, 1]
    now: int
    before: int
    window_min: int
    won_high: int


class SceneCamera(TypedDict):
    behind: str


class ScenePayload(TypedDict):
    type: Literal["closest_attempt", "plain"]
    camera: SceneCamera
    goal_frame: int | None
    light: list[str]
    earlier_frame: int | None
    label: str


class PhoneLine(TypedDict):
    lang: Literal["en", "ar"]
    text: str
    how: str
    numbers: list[float]
    names: list[str]
    proof: list[Proof]


class DeskLine(TypedDict):
    text: str
    claims: list[str]


class KickoffMarkPayload(TypedDict):
    mark: Literal["channels", "zone", "window"]
    zone: str | None
    subject: str
    text: str


class DangerWindowPayload(TypedDict):
    from_minute: int
    to_minute: int
    subject: str


class IntervalCard(TypedDict):
    title: str
    text: str
    mark: str | None


class HalftimePayload(TypedDict):
    cards: list[IntervalCard]


class Pin(TypedDict):
    kind: Literal["goal", "booking", "pressure"]
    t: float
    minute: int
    text: str
    play: list[float]


class CallPoint(TypedDict):
    frame: int
    inside: bool
    x: NotRequired[float]
    y: NotRequired[float]
    goal: NotRequired[bool]


class Call(TypedDict):
    mark: Literal["channels", "zone", "window"]
    said: str
    came_true: bool | None
    line: str
    detail: str
    value: list[int]
    points: list[CallPoint]
    zone: NotRequired[str]
    window: NotRequired[list[int]]
    before: NotRequired[int]
    after: NotRequired[int]
    player: NotRequired[str]


class FulltimePayload(TypedDict):
    pins: list[Pin]
    calls: list[Call]


class CueBase(TypedDict):
    id: str
    frame: int
    t: float
    when: Literal["now", "next_pause", "next_replay"]
    valid_for: float
    priority: int
    status: Literal["live", "withdrawn"]


class StakeCardCue(CueBase):
    form: Literal["stake_card"]
    screen: Literal["tv"]
    payload: StakeCardPayload


class TagCue(CueBase):
    form: Literal["tag"]
    screen: Literal["tv"]
    payload: TagPayload


class DuelCue(CueBase):
    form: Literal["duel"]
    screen: Literal["tv"]
    payload: DuelPayload


class FormCardCue(CueBase):
    form: Literal["form_card"]
    screen: Literal["tv"]
    payload: FormCardPayload


class LabelCue(CueBase):
    form: Literal["label"]
    screen: Literal["tv"]
    payload: LabelPayload


class PressureCue(CueBase):
    form: Literal["pressure"]
    screen: Literal["tv"]
    payload: PressurePayload


class SceneCue(CueBase):
    form: Literal["scene"]
    screen: Literal["tv"]
    payload: ScenePayload


class PhoneSentenceCue(CueBase):
    form: Literal["sentence"]
    screen: Literal["phone"]
    payload: PhoneLine


class DeskSentenceCue(CueBase):
    form: Literal["sentence"]
    screen: Literal["desk"]
    payload: DeskLine


class KickoffMarkCue(CueBase):
    form: Literal["kickoff_mark"]
    screen: Literal["tv"]
    payload: KickoffMarkPayload


class DangerWindowCue(CueBase):
    form: Literal["danger_window"]
    screen: Literal["tv"]
    payload: DangerWindowPayload


class HalftimeCue(CueBase):
    form: Literal["halftime_card"]
    screen: Literal["tv"]
    payload: HalftimePayload


class FulltimeCue(CueBase):
    form: Literal["fulltime_card"]
    screen: Literal["tv"]
    payload: FulltimePayload


Cue = (
    StakeCardCue
    | TagCue
    | DuelCue
    | FormCardCue
    | LabelCue
    | PressureCue
    | SceneCue
    | PhoneSentenceCue
    | DeskSentenceCue
    | KickoffMarkCue
    | DangerWindowCue
    | HalftimeCue
    | FulltimeCue
)

# ---- match.json ----


class Period(TypedDict):
    period: int
    first: int
    last: int
    clock0: float
    home_attacks: float


class ReasonEarlier(TypedDict):
    player: str
    by_m: float
    minute: int


class ReasonGhost(TypedDict):
    player: str
    off_m: float


class ReasonBooked(TypedDict):
    player: str
    minute: int


class Reason(TypedDict):
    frame: int
    minute: int
    scorer: str
    agreed: bool
    earlier: ReasonEarlier | None
    ghost: ReasonGhost | None
    booked: ReasonBooked | None


class Action(TypedDict):
    kind: Literal["pass", "shot", "tackle", "foul", "interception", "clearance", "save", "down"]
    player: int
    frame: int
    outcome: NotRequired[int]
    other: NotRequired[int]
    seconds: NotRequired[float]


class Goal(TypedDict):
    frame: int
    score: list[int]
    player: str
    minute: int


class Booking(TypedDict):
    frame: int
    player: str
    colour: str
    minute: int


class Ledgers(TypedDict):
    frames: list[int]
    dist: list[list[int]]
    top: list[list[float]]
    passes: list[list[list[int]]]


class DeskRow(TypedDict):
    frame: int
    form: str
    status: Literal["shown", "template", "held", "withdrawn", "rejected"]
    what: str
    why: NotRequired[str]


class Club(TypedDict):
    short: str
    name: str
    name_ar: str


class StakeLevels(TypedDict):
    faint: float
    full: float


class MatchView(TypedDict):
    match_id: str
    fps: int
    frames: int
    row: int
    unit: str
    periods: list[Period]
    reasons: list[Reason]
    live0: bool
    live_flips: list[int]
    actions: list[Action]
    cues: list[Cue]
    goals: list[Goal]
    cards: list[Booking]
    ledgers: Ledgers
    momentum: list[list[float]]
    event_frames: list[int]
    shown: int
    held: int
    desk: list[DeskRow]
    ids: list[str]
    numbers: list[int]
    names: dict[str, str]
    team: list[int]
    names_ar: dict[str, str]
    home: Club
    away: Club
    stake: StakeLevels


# ---- scenes.json: one entry for each replay scene ----


class ClipAction(TypedDict):
    kind: Literal["pass", "shot", "tackle"]
    player: int
    frame: int


class Clip(TypedDict):
    start_offset: int
    shot_offset: int
    minute: int
    clock: float
    pos: list[list[list[float | None]]]
    ball: list[list[float]]
    actions: list[ClipAction]


class SceneClips(TypedDict):
    goal: Clip
    earlier: Clip


class ReplayScene(TypedDict):
    cue_id: str
    fps: int
    label: str
    scorer: str
    differing_player: str
    differing_by_m: float
    parting_s: float
    gap_m: float
    booked_minute: int | None
    ids: list[str]
    numbers: list[int]
    names: dict[str, str]
    team: list[int]
    home: str
    away: str
    home_name: str
    away_name: str
    clips: SceneClips


ROOTS = {"MatchView": MatchView, "ReplayScene": ReplayScene}
