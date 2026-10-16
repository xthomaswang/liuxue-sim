// 毕业后五年的轨道内容（docs/24 §4.4）。图册按轨道分组列出“五年后”的结局。

import { LIFE_TRACKS } from "../content";
import { LIFE_TRACK_ORDER } from "../engine/constants";
import type { LifeTrackContent } from "../engine";

/** 图册里的顺序：读博、留美工作、回国工作、过渡期、离校之后。 */
export const LIFE_TRACK_LIST: readonly LifeTrackContent[] = LIFE_TRACK_ORDER.map((track) => LIFE_TRACKS[track]);
