// Written by `tempo types` from tempo/pipeline/schema.py. Do not edit: change the schema and run it again.

export interface Proof {
  icon: string;
  fact_id: string;
  title: string;
  value: string;
  note: string;
}

export interface StakeCardPayload {
  player: string;
  level: 0 | 1 | 2;
  chance: number;
  stake: string;
}

export interface TagPayload {
  player: string;
  text: string;
  note: string;
  value: number;
  unit: string;
  usual: number;
  rare: number;
}

export interface DuelPayload {
  defender: string;
  attacker: string;
  defender_won: number;
  attacker_won: number;
}

export interface FormCardPayload {
  player: string;
  per_minute: number;
  usual_percentile: number;
  top_speed: number;
  heard: string;
}

export interface LabelPayload {
  text: string;
}

export interface PressurePayload {
  team: 0 | 1;
  now: number;
  before: number;
  window_min: number;
  won_high: number;
}

export interface SceneCamera {
  behind: string;
}

export interface ScenePayload {
  type: 'closest_attempt' | 'plain';
  camera: SceneCamera;
  goal_frame: number | null;
  light: string[];
  earlier_frame: number | null;
  label: string;
}

export interface PhoneLine {
  lang: 'en' | 'ar';
  text: string;
  how: string;
  numbers: number[];
  names: string[];
  proof: Proof[];
}

export interface DeskLine {
  text: string;
  claims: string[];
}

export interface KickoffMarkPayload {
  mark: 'channels' | 'zone' | 'window';
  zone: string | null;
  subject: string;
  text: string;
}

export interface DangerWindowPayload {
  from_minute: number;
  to_minute: number;
  subject: string;
}

export interface IntervalCard {
  title: string;
  text: string;
  mark: string | null;
}

export interface HalftimePayload {
  cards: IntervalCard[];
}

export interface Pin {
  kind: 'goal' | 'booking' | 'pressure';
  t: number;
  minute: number;
  text: string;
  play: number[];
}

export interface CallPoint {
  frame: number;
  inside: boolean;
  x?: number;
  y?: number;
  goal?: boolean;
}

export interface Call {
  mark: 'channels' | 'zone' | 'window';
  said: string;
  came_true: boolean | null;
  line: string;
  detail: string;
  value: number[];
  points: CallPoint[];
  zone?: string;
  window?: number[];
  before?: number;
  after?: number;
  player?: string;
}

export interface FulltimePayload {
  pins: Pin[];
  calls: Call[];
}

export interface CueBase {
  id: string;
  frame: number;
  t: number;
  when: 'now' | 'next_pause' | 'next_replay';
  valid_for: number;
  priority: number;
  status: 'live' | 'withdrawn';
}

export interface StakeCardCue {
  id: string;
  frame: number;
  t: number;
  when: 'now' | 'next_pause' | 'next_replay';
  valid_for: number;
  priority: number;
  status: 'live' | 'withdrawn';
  form: 'stake_card';
  screen: 'tv';
  payload: StakeCardPayload;
}

export interface TagCue {
  id: string;
  frame: number;
  t: number;
  when: 'now' | 'next_pause' | 'next_replay';
  valid_for: number;
  priority: number;
  status: 'live' | 'withdrawn';
  form: 'tag';
  screen: 'tv';
  payload: TagPayload;
}

export interface DuelCue {
  id: string;
  frame: number;
  t: number;
  when: 'now' | 'next_pause' | 'next_replay';
  valid_for: number;
  priority: number;
  status: 'live' | 'withdrawn';
  form: 'duel';
  screen: 'tv';
  payload: DuelPayload;
}

export interface FormCardCue {
  id: string;
  frame: number;
  t: number;
  when: 'now' | 'next_pause' | 'next_replay';
  valid_for: number;
  priority: number;
  status: 'live' | 'withdrawn';
  form: 'form_card';
  screen: 'tv';
  payload: FormCardPayload;
}

export interface LabelCue {
  id: string;
  frame: number;
  t: number;
  when: 'now' | 'next_pause' | 'next_replay';
  valid_for: number;
  priority: number;
  status: 'live' | 'withdrawn';
  form: 'label';
  screen: 'tv';
  payload: LabelPayload;
}

export interface PressureCue {
  id: string;
  frame: number;
  t: number;
  when: 'now' | 'next_pause' | 'next_replay';
  valid_for: number;
  priority: number;
  status: 'live' | 'withdrawn';
  form: 'pressure';
  screen: 'tv';
  payload: PressurePayload;
}

export interface SceneCue {
  id: string;
  frame: number;
  t: number;
  when: 'now' | 'next_pause' | 'next_replay';
  valid_for: number;
  priority: number;
  status: 'live' | 'withdrawn';
  form: 'scene';
  screen: 'tv';
  payload: ScenePayload;
}

export interface PhoneSentenceCue {
  id: string;
  frame: number;
  t: number;
  when: 'now' | 'next_pause' | 'next_replay';
  valid_for: number;
  priority: number;
  status: 'live' | 'withdrawn';
  form: 'sentence';
  screen: 'phone';
  payload: PhoneLine;
}

export interface DeskSentenceCue {
  id: string;
  frame: number;
  t: number;
  when: 'now' | 'next_pause' | 'next_replay';
  valid_for: number;
  priority: number;
  status: 'live' | 'withdrawn';
  form: 'sentence';
  screen: 'desk';
  payload: DeskLine;
}

export interface KickoffMarkCue {
  id: string;
  frame: number;
  t: number;
  when: 'now' | 'next_pause' | 'next_replay';
  valid_for: number;
  priority: number;
  status: 'live' | 'withdrawn';
  form: 'kickoff_mark';
  screen: 'tv';
  payload: KickoffMarkPayload;
}

export interface DangerWindowCue {
  id: string;
  frame: number;
  t: number;
  when: 'now' | 'next_pause' | 'next_replay';
  valid_for: number;
  priority: number;
  status: 'live' | 'withdrawn';
  form: 'danger_window';
  screen: 'tv';
  payload: DangerWindowPayload;
}

export interface HalftimeCue {
  id: string;
  frame: number;
  t: number;
  when: 'now' | 'next_pause' | 'next_replay';
  valid_for: number;
  priority: number;
  status: 'live' | 'withdrawn';
  form: 'halftime_card';
  screen: 'tv';
  payload: HalftimePayload;
}

export interface FulltimeCue {
  id: string;
  frame: number;
  t: number;
  when: 'now' | 'next_pause' | 'next_replay';
  valid_for: number;
  priority: number;
  status: 'live' | 'withdrawn';
  form: 'fulltime_card';
  screen: 'tv';
  payload: FulltimePayload;
}

export type Cue =
  | StakeCardCue
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
  | FulltimeCue;

export interface Period {
  period: number;
  first: number;
  last: number;
  clock0: number;
  home_attacks: number;
}

export interface ReasonEarlier {
  player: string;
  by_m: number;
  minute: number;
}

export interface ReasonGhost {
  player: string;
  off_m: number;
}

export interface ReasonBooked {
  player: string;
  minute: number;
}

export interface Reason {
  frame: number;
  minute: number;
  scorer: string;
  agreed: boolean;
  earlier: ReasonEarlier | null;
  ghost: ReasonGhost | null;
  booked: ReasonBooked | null;
}

export interface Action {
  kind: 'pass' | 'shot' | 'tackle' | 'foul' | 'interception' | 'clearance' | 'save' | 'down';
  player: number;
  frame: number;
  outcome?: number;
  other?: number;
  seconds?: number;
}

export interface Goal {
  frame: number;
  score: number[];
  player: string;
  minute: number;
}

export interface Booking {
  frame: number;
  player: string;
  colour: string;
  minute: number;
}

export interface Ledgers {
  frames: number[];
  dist: number[][];
  top: number[][];
  passes: number[][][];
}

export interface DeskRow {
  frame: number;
  form: string;
  status: 'shown' | 'template' | 'held' | 'withdrawn' | 'rejected';
  what: string;
  why?: string;
}

export interface Club {
  short: string;
  name: string;
  name_ar: string;
}

export interface StakeLevels {
  faint: number;
  full: number;
}

export interface MatchView {
  match_id: string;
  fps: number;
  frames: number;
  row: number;
  unit: string;
  periods: Period[];
  reasons: Reason[];
  live0: boolean;
  live_flips: number[];
  actions: Action[];
  cues: (StakeCardCue | TagCue | DuelCue | FormCardCue | LabelCue | PressureCue | SceneCue | PhoneSentenceCue | DeskSentenceCue | KickoffMarkCue | DangerWindowCue | HalftimeCue | FulltimeCue)[];
  goals: Goal[];
  cards: Booking[];
  ledgers: Ledgers;
  momentum: number[][];
  event_frames: number[];
  shown: number;
  held: number;
  desk: DeskRow[];
  ids: string[];
  numbers: number[];
  names: Record<string, string>;
  team: number[];
  names_ar: Record<string, string>;
  home: Club;
  away: Club;
  stake: StakeLevels;
}

export interface ClipAction {
  kind: 'pass' | 'shot' | 'tackle';
  player: number;
  frame: number;
}

export interface Clip {
  start_offset: number;
  shot_offset: number;
  minute: number;
  clock: number;
  pos: (((number | null)[])[])[];
  ball: number[][];
  actions: ClipAction[];
}

export interface SceneClips {
  goal: Clip;
  earlier: Clip;
}

export interface ReplayScene {
  cue_id: string;
  fps: number;
  label: string;
  scorer: string;
  differing_player: string;
  differing_by_m: number;
  parting_s: number;
  gap_m: number;
  booked_minute: number | null;
  ids: string[];
  numbers: number[];
  names: Record<string, string>;
  team: number[];
  home: string;
  away: string;
  home_name: string;
  away_name: string;
  clips: SceneClips;
}
